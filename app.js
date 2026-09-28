/**
 * 豆趣 · 拼豆图纸制作器 - 核心算法
 * 改造点：
 * 1. 真实 MARD 221 色板（替换自造色）
 * 2. CIE Lab 空间颜色匹配（替换 RGB 距离）
 * 3. 格内平均色 / 主导色两种像素化（替换单像素取样）
 * 4. K-Means++ 颜色量化（限制用色数时）
 * 5. Floyd-Steinberg 抖动
 * 6. 去孤立杂点
 * 7. PNG 透明区域处理
 * 8. 亮度自动判断文字颜色（替换硬编码索引）
 * 9. 每5格加粗定位线
 */

// ========== 色彩空间转换 ==========

/** sRGB → 线性 RGB（逆 Gamma 校正） */
function srgbToLinear(c) {
  c = c / 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

/** 线性 RGB → XYZ（D65 白点） */
function rgbToXyz(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return [
    (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) * 100,
    (lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750) * 100,
    (lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041) * 100
  ];
}

/** XYZ → CIE Lab */
function xyzToLab(x, y, z) {
  const Xn = 95.047, Yn = 100.0, Zn = 108.883;
  const fx = labF(x / Xn);
  const fy = labF(y / Yn);
  const fz = labF(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** RGB → Lab 一步转换 */
function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

/** hex → [r, g, b] */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ========== 色板预处理 ==========

/** 把 MARD 色板转成 {code, hex, rgb, lab} 并预计算 Lab 值 */
const PALETTE = MARD_PALETTE.map(item => {
  const rgb = hexToRgb(item.hex);
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  return { code: item.code, hex: item.hex, rgb, lab };
});

// ========== 颜色匹配 ==========

const matchCache = new Map();

/** 在 Lab 空间找最接近的色号（CIE76 欧氏距离） */
function nearestColor(rgb) {
  const key = rgb[0] + '_' + rgb[1] + '_' + rgb[2];
  if (matchCache.has(key)) return matchCache.get(key);

  const [L, a, b] = rgbToLab(rgb[0], rgb[1], rgb[2]);
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    const dL = L - p.lab[0];
    const dA = a - p.lab[1];
    const dB = b - p.lab[2];
    const dist = dL * dL + dA * dA + dB * dB;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  matchCache.set(key, best);
  return best;
}

// ========== 像素化：格内平均色 ==========

/**
 * 格内平均色：先把图放大到 scale 倍，再按格子求平均
 * 相当于抗锯齿，比直接缩小取单像素效果好很多
 */
function sampleAverage(img, gridSize, scale = 4) {
  const workSize = gridSize * scale;
  const t = document.createElement('canvas');
  t.width = t.height = workSize;
  const tc = t.getContext('2d');
  // 等比缩放填满（cover 模式）
  const iw = img.width, ih = img.height;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2, sy = (ih - side) / 2;
  tc.drawImage(img, sx, sy, side, side, 0, 0, workSize, workSize);
  const data = tc.getImageData(0, 0, workSize, workSize).data;

  const result = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const idx = (py * workSize + px) * 4;
          const alpha = data[idx + 3];
          if (alpha < 128) { a++; continue; } // 透明像素跳过
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }
      if (count === 0) {
        result.push(null); // 全透明格
      } else {
        result.push([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
      }
    }
  }
  return result;
}

// ========== 像素化：主导色提取 ==========

/**
 * 主导色提取：每个格子里出现频率最高的颜色
 * 边界清晰，不会出现平均色导致的灰色毛边，适合卡通图
 */
function sampleDominant(img, gridSize, scale = 4) {
  const workSize = gridSize * scale;
  const t = document.createElement('canvas');
  t.width = t.height = workSize;
  const tc = t.getContext('2d');
  const iw = img.width, ih = img.height;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2, sy = (ih - side) / 2;
  tc.drawImage(img, sx, sy, side, side, 0, 0, workSize, workSize);
  const data = tc.getImageData(0, 0, workSize, workSize).data;

  const result = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const freq = {};
      let transparent = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const idx = (py * workSize + px) * 4;
          if (data[idx + 3] < 128) { transparent++; continue; }
          // 量化到 32 级减少颜色数量
          const r = data[idx] >> 3 << 3;
          const g = data[idx + 1] >> 3 << 3;
          const b = data[idx + 2] >> 3 << 3;
          const key = r + '_' + g + '_' + b;
          freq[key] = (freq[key] || 0) + 1;
        }
      }
      const total = scale * scale;
      if (transparent > total / 2) {
        result.push(null);
      } else {
        let bestKey = null, bestCount = 0;
        for (const k in freq) {
          if (freq[k] > bestCount) { bestCount = freq[k]; bestKey = k; }
        }
        const [r, g, b] = bestKey.split('_').map(Number);
        result.push([r, g, b]);
      }
    }
  }
  return result;
}

// ========== K-Means++ 颜色量化 ==========

/**
 * 当用户限制颜色数量时，先用 K-Means++ 聚类选出代表色
 * 再把每个像素匹配到最近的聚类中心
 */
function kmeansQuantize(pixels, k, maxIter = 12) {
  const validPixels = pixels.filter(p => p !== null);
  if (validPixels.length === 0) return pixels;

  // 转 Lab（带缓存）
  const labCache = {};
  const labs = validPixels.map(p => {
    const key = p[0] + '_' + p[1] + '_' + p[2];
    if (!labCache[key]) labCache[key] = rgbToLab(p[0], p[1], p[2]);
    return labCache[key];
  });

  // K-Means++ 初始化
  const centers = [labs[Math.floor(Math.random() * labs.length)].slice()];
  while (centers.length < k) {
    const dists = labs.map(lab => {
      let minD = Infinity;
      for (const c of centers) {
        const d = (lab[0]-c[0])**2 + (lab[1]-c[1])**2 + (lab[2]-c[2])**2;
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { idx = i; break; }
    }
    centers.push(labs[idx].slice());
  }

  // 迭代聚类
  const assignments = new Array(labs.length);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < labs.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = (labs[i][0]-centers[c][0])**2 + (labs[i][1]-centers[c][1])**2 + (labs[i][2]-centers[c][2])**2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    // 更新中心
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < labs.length; i++) {
      const c = assignments[i];
      sums[c][0] += labs[i][0];
      sums[c][1] += labs[i][1];
      sums[c][2] += labs[i][2];
      sums[c][3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0]/sums[c][3], sums[c][1]/sums[c][3], sums[c][2]/sums[c][3]];
      }
    }
    if (!changed) break;
  }

  // 把聚类中心转回 RGB，再匹配到色板
  const centerRgb = centers.map(c => {
    // Lab → XYZ → RGB（简化：直接用聚类中心在 Lab 空间匹配色板）
    let best = 0, bestD = Infinity;
    for (let i = 0; i < PALETTE.length; i++) {
      const d = (c[0]-PALETTE[i].lab[0])**2 + (c[1]-PALETTE[i].lab[1])**2 + (c[2]-PALETTE[i].lab[2])**2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return PALETTE[best].rgb;
  });

  // 每个像素分配到最近的聚类中心对应的色板颜色
  let vi = 0;
  return pixels.map(p => {
    if (p === null) return null;
    const c = assignments[vi++];
    return centerRgb[c];
  });
}

// ========== Floyd-Steinberg 抖动 ==========

/**
 * 误差扩散抖动：当前像素匹配误差按比例分给周围像素
 * 用两色交错模拟中间色，缓解渐变区域的色带问题
 */
function floydSteinbergDither(grid, gridSize) {
  const buf = grid.map(p => p ? [p[0], p[1], p[2]] : null);
  const result = new Array(grid.length);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (buf[idx] === null) { result[idx] = null; continue; }

      const oldR = buf[idx][0], oldG = buf[idx][1], oldB = buf[idx][2];
      const pi = nearestColor([oldR, oldG, oldB]);
      const matched = PALETTE[pi].rgb;
      result[idx] = pi;

      const errR = oldR - matched[0];
      const errG = oldG - matched[1];
      const errB = oldB - matched[2];

      // 右 7/16
      if (x + 1 < gridSize && buf[idx + 1]) {
        buf[idx + 1][0] = clamp(buf[idx + 1][0] + errR * 7 / 16);
        buf[idx + 1][1] = clamp(buf[idx + 1][1] + errG * 7 / 16);
        buf[idx + 1][2] = clamp(buf[idx + 1][2] + errB * 7 / 16);
      }
      // 左下 3/16
      if (x > 0 && y + 1 < gridSize && buf[idx + gridSize - 1]) {
        buf[idx + gridSize - 1][0] = clamp(buf[idx + gridSize - 1][0] + errR * 3 / 16);
        buf[idx + gridSize - 1][1] = clamp(buf[idx + gridSize - 1][1] + errG * 3 / 16);
        buf[idx + gridSize - 1][2] = clamp(buf[idx + gridSize - 1][2] + errB * 3 / 16);
      }
      // 正下 5/16
      if (y + 1 < gridSize && buf[idx + gridSize]) {
        buf[idx + gridSize][0] = clamp(buf[idx + gridSize][0] + errR * 5 / 16);
        buf[idx + gridSize][1] = clamp(buf[idx + gridSize][1] + errG * 5 / 16);
        buf[idx + gridSize][2] = clamp(buf[idx + gridSize][2] + errB * 5 / 16);
      }
      // 右下 1/16
      if (x + 1 < gridSize && y + 1 < gridSize && buf[idx + gridSize + 1]) {
        buf[idx + gridSize + 1][0] = clamp(buf[idx + gridSize + 1][0] + errR * 1 / 16);
        buf[idx + gridSize + 1][1] = clamp(buf[idx + gridSize + 1][1] + errG * 1 / 16);
        buf[idx + gridSize + 1][2] = clamp(buf[idx + gridSize + 1][2] + errB * 1 / 16);
      }
    }
  }
  return result;
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

// ========== 去孤立杂点 ==========

/** 如果一个格子四邻域颜色都不同，替换成周围出现最多的颜色 */
function removeSpeckles(grid, gridSize) {
  const result = grid.slice();
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (result[idx] === null) continue;

      const neighbors = [];
      if (y > 0 && result[idx - gridSize] !== null) neighbors.push(result[idx - gridSize]);
      if (y < gridSize - 1 && result[idx + gridSize] !== null) neighbors.push(result[idx + gridSize]);
      if (x > 0 && result[idx - 1] !== null) neighbors.push(result[idx - 1]);
      if (x < gridSize - 1 && result[idx + 1] !== null) neighbors.push(result[idx + 1]);

      if (neighbors.length >= 3 && neighbors.every(n => n !== result[idx])) {
        const freq = {};
        for (const n of neighbors) freq[n] = (freq[n] || 0) + 1;
        let best = result[idx], bestCount = 0;
        for (const k in freq) {
          if (freq[k] > bestCount) { bestCount = freq[k]; best = Number(k); }
        }
        result[idx] = best;
      }
    }
  }
  return result;
}

// ========== 主处理流程 ==========

function processImage(img, opts) {
  const { gridSize, sampleMode, colorLimit, useDither, useDespeckle } = opts;

  matchCache.clear();

  // 1. 像素化
  let pixels = sampleMode === 'dominant'
    ? sampleDominant(img, gridSize)
    : sampleAverage(img, gridSize);

  // 2. 颜色量化（限制用色数时）
  if (colorLimit && colorLimit < PALETTE.length) {
    pixels = kmeansQuantize(pixels, colorLimit);
  }

  // 3. 色卡匹配 + 抖动
  let grid;
  if (useDither) {
    grid = floydSteinbergDither(pixels, gridSize);
  } else {
    grid = pixels.map(p => p === null ? null : nearestColor(p));
  }

  // 4. 去孤立杂点
  if (useDespeckle) {
    grid = removeSpeckles(grid, gridSize);
  }

  return grid;
}

// ========== Canvas 渲染 ==========

function renderPattern(canvas, grid, gridSize, opts) {
  const { showGrid, showLabels, cellSize = 20 } = opts;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.height = gridSize * cellSize;

  // 1. 填色块
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (grid[idx] === null) continue; // 透明格不填色
      const color = PALETTE[grid[idx]];
      ctx.fillStyle = color.hex;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  // 2. 色号标注
  if (showLabels) {
    ctx.font = '600 ' + Math.max(7, Math.floor(cellSize * 0.38)) + 'px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        if (grid[idx] === null) continue;
        const color = PALETTE[grid[idx]];
        const [r, g, b] = color.rgb;
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        ctx.fillStyle = brightness > 140 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
        ctx.fillText(color.code, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
      }
    }
  }

  // 3. 网格线
  if (showGrid) {
    // 细网格线
    ctx.strokeStyle = 'rgba(32,34,31,0.18)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= gridSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, gridSize * cellSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(gridSize * cellSize, i * cellSize);
      ctx.stroke();
    }
    // 每5格加粗定位线（对应拼豆板刻度）
    ctx.strokeStyle = 'rgba(32,34,31,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= gridSize; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, gridSize * cellSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(gridSize * cellSize, i * cellSize);
      ctx.stroke();
    }
  }
}

// ========== 材料清单 ==========

function buildMaterialList(grid) {
  const count = {};
  let total = 0;
  for (const idx of grid) {
    if (idx === null) continue;
    count[idx] = (count[idx] || 0) + 1;
    total++;
  }
  const list = Object.entries(count)
    .map(([idx, qty]) => ({ idx: Number(idx), qty }))
    .sort((a, b) => b.qty - a.qty);
  return { list, total };
}

// ========== UI 绑定 ==========

const $ = s => document.querySelector(s);
const fileInput = $('#fileInput');
const canvas = $('#beadCanvas');
const empty = $('#canvasEmpty');

let img = null;
let zoom = 100;
let showGrid = true;
let showLabels = true;
let sampleMode = 'average'; // average | dominant
let useDither = false;
let useDespeckle = true;

function getOptions() {
  return {
    gridSize: +$('#sizeRange').value,
    sampleMode,
    colorLimit: +$('#paletteRange').value,
    useDither,
    useDespeckle,
    showGrid,
    showLabels
  };
}

function draw() {
  if (!img) return;
  const opts = getOptions();
  const grid = processImage(img, opts);
  renderPattern(canvas, grid, opts.gridSize, opts);

  canvas.style.display = 'block';
  empty.style.display = 'none';
  canvas.style.transform = 'scale(' + (zoom / 100) + ')';

  const { list, total } = buildMaterialList(grid);
  $('#totalBeads').textContent = total.toLocaleString();
  $('#materialGrid').innerHTML = list.map(item => {
    const c = PALETTE[item.idx];
    return '<div class="material-item">' +
      '<i class="material-color" style="background:' + c.hex + '"></i>' +
      '<div class="material-meta"><b>' + c.code + '</b><span>MARD 色号</span></div>' +
      '<strong class="material-qty">' + item.qty + '</strong>' +
      '</div>';
  }).join('');
}

function updateSwatches() {
  // 显示当前色板的前 N 个颜色预览
  const n = Math.min(+$('#paletteRange').value, 36);
  $('#swatches').innerHTML = PALETTE.slice(0, n).map(c =>
    '<i style="background:' + c.hex + '" title="' + c.code + '"></i>'
  ).join('');
}

// 文件上传
fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const i = new Image();
  i.onload = () => { img = i; draw(); };
  i.src = URL.createObjectURL(f);
});

// 尺寸滑块
$('#sizeRange').addEventListener('input', e => {
  $('#sizeValue').textContent = e.target.value + ' × ' + e.target.value;
  draw();
});

// 色数滑块
$('#paletteRange').addEventListener('input', e => {
  const v = +e.target.value;
  $('#paletteValue').textContent = v >= 221 ? '全 221 色' : v + ' 色';
  updateSwatches();
  draw();
});

// 采样模式
$('#sampleAverage').addEventListener('click', () => {
  sampleMode = 'average';
  $('#sampleAverage').classList.add('active');
  $('#sampleDominant').classList.remove('active');
  draw();
});
$('#sampleDominant').addEventListener('click', () => {
  sampleMode = 'dominant';
  $('#sampleDominant').classList.add('active');
  $('#sampleAverage').classList.remove('active');
  draw();
});

// 抖动开关
$('#ditherToggle').addEventListener('click', () => {
  useDither = !useDither;
  $('#ditherToggle').classList.toggle('active', useDither);
  draw();
});

// 网格开关
$('#gridToggle').addEventListener('click', () => {
  showGrid = !showGrid;
  $('#gridToggle').classList.toggle('active', showGrid);
  draw();
});

// 色号开关
$('#labelToggle').addEventListener('click', () => {
  showLabels = !showLabels;
  $('#labelToggle').classList.toggle('active', showLabels);
  draw();
});

// 缩放
$('#zoomIn').addEventListener('click', () => {
  zoom = Math.min(150, zoom + 10);
  $('#zoomValue').textContent = zoom + '%';
  draw();
});
$('#zoomOut').addEventListener('click', () => {
  zoom = Math.max(60, zoom - 10);
  $('#zoomValue').textContent = zoom + '%';
  draw();
});

// 重置
$('#resetBtn').addEventListener('click', () => location.reload());

// 导出
$('#downloadBtn').addEventListener('click', () => {
  if (!img) return;
  const a = document.createElement('a');
  a.download = '豆趣-拼豆图纸.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});

// 初始化
updateSwatches();
