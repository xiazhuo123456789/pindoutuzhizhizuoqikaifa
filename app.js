/**
 * 豆趣 · 拼豆图纸制作器 - 核心算法
 * 改造点：
 * 1. 真实 MARD 221 色板（替换自造色）
 * 2. CIE Lab 空间颜色匹配（替换 RGB 距离）
 * 3. 格内平均色 / 主导色两种像素化（替换单像素取样）
 * 4. 先全色匹配再合并到 N 色（替换 K-Means，避免灰色聚类中心）
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

/** 在 Lab 空间找最接近的色号（CIE76 欧氏距离），支持限定色板子集 */
function nearestColor(rgb, allowedIndices) {
  const key = rgb[0] + '_' + rgb[1] + '_' + rgb[2] + (allowedIndices ? '_s' + allowedIndices.length : '');
  if (matchCache.has(key)) return matchCache.get(key);

  const [L, a, b] = rgbToLab(rgb[0], rgb[1], rgb[2]);
  let best = 0, bestDist = Infinity;
  if (allowedIndices) {
    for (const i of allowedIndices) {
      const p = PALETTE[i];
      const dL = L - p.lab[0], dA = a - p.lab[1], dB = b - p.lab[2];
      const dist = dL * dL + dA * dA + dB * dB;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
  } else {
    for (let i = 0; i < PALETTE.length; i++) {
      const p = PALETTE[i];
      const dL = L - p.lab[0], dA = a - p.lab[1], dB = b - p.lab[2];
      const dist = dL * dL + dA * dA + dB * dB;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
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
 * 主导色提取 v2：scale=8更稳定、16级量化、深色轮廓保护
 */
function sampleDominant(img, gridSize, scale = 8) {
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
      let darkPixels = 0;
      let darkestR = 255, darkestG = 255, darkestB = 255, darkestBright = 255;

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const idx = (py * workSize + px) * 4;
          if (data[idx + 3] < 128) { transparent++; continue; }

          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          const brightness = r * 0.299 + g * 0.587 + b * 0.114;
          if (brightness < 90) {
            darkPixels++;
            if (brightness < darkestBright) {
              darkestBright = brightness;
              darkestR = r; darkestG = g; darkestB = b;
            }
          }

          // 量化到 16 级（更粗，更容易找到主导色）
          const qr = r >> 4 << 4;
          const qg = g >> 4 << 4;
          const qb = b >> 4 << 4;
          const key = qr + '_' + qg + '_' + qb;
          freq[key] = (freq[key] || 0) + 1;
        }
      }

      const total = scale * scale;
      if (transparent > total / 2) {
        result.push(null);
        continue;
      }

      // 轮廓保护：深色像素占比超过20%，直接用最深的颜色
      if (darkPixels >= total * 0.2) {
        result.push([darkestR, darkestG, darkestB]);
        continue;
      }

      // 取出现频率最高的颜色
      let bestKey = null, bestCount = 0;
      for (const k in freq) {
        if (freq[k] > bestCount) { bestCount = freq[k]; bestKey = k; }
      }
      const [r, g, b] = bestKey.split('_').map(Number);
      result.push([r, g, b]);
    }
  }
  return result;
}

// ========== 颜色合并：先全色匹配再合并到 N 色 ==========

/**
 * 先统计图纸中实际用到的色号，再按 Lab 相似度贪心合并到 targetN 色
 * v2：增加亮度差异约束（亮度差>30不合并），降低深色保护权重
 */
function mergeToNColors(grid, targetN) {
  const count = {};
  for (const idx of grid) {
    if (idx === null) continue;
    count[idx] = (count[idx] || 0) + 1;
  }
  const used = Object.keys(count).map(Number);
  if (used.length <= targetN) return { grid, allowedIndices: used };

  // 颜色重要性权重：适度保护深色和高饱和度色
  function colorWeight(idx) {
    const p = PALETTE[idx];
    const L = p.lab[0], a = p.lab[1], b = p.lab[2];
    const darkness = (100 - L) / 100;
    const saturation = Math.sqrt(a * a + b * b) / 100;
    return 1 + darkness * 1.5 + saturation * 1.0;
  }

  const kept = new Set(used);
  const mergeMap = {};

  while (kept.size > targetN) {
    // 找重要性最低的色号
    let victim = -1, minScore = Infinity;
    for (const idx of kept) {
      const score = count[idx] / colorWeight(idx);
      if (score < minScore) { minScore = score; victim = idx; }
    }
    // 找最相似的保留色号（亮度差不能超过30，防止白和深合并）
    let target = -1, bestDist = Infinity;
    const victimL = PALETTE[victim].lab[0];
    for (const idx of kept) {
      if (idx === victim) continue;
      const p1 = PALETTE[victim], p2 = PALETTE[idx];
      const dL = p1.lab[0] - p2.lab[0];
      // 亮度差超过30，跳过（防止白色和深色合并）
      if (Math.abs(dL) > 30) continue;
      const dA = p1.lab[1] - p2.lab[1];
      const dB = p1.lab[2] - p2.lab[2];
      const dist = dL * dL + dA * dA + dB * dB;
      if (dist < bestDist) { bestDist = dist; target = idx; }
    }
    // 如果找不到亮度接近的，放宽约束找最相似的
    if (target === -1) {
      for (const idx of kept) {
        if (idx === victim) continue;
        const p1 = PALETTE[victim], p2 = PALETTE[idx];
        const dL = p1.lab[0] - p2.lab[0];
        const dA = p1.lab[1] - p2.lab[1];
        const dB = p1.lab[2] - p2.lab[2];
        const dist = dL * dL + dA * dA + dB * dB;
        if (dist < bestDist) { bestDist = dist; target = idx; }
      }
    }
    if (target === -1) break;
    mergeMap[victim] = target;
    count[target] += count[victim];
    kept.delete(victim);
  }

  const newGrid = grid.map(idx => idx === null ? null : (mergeMap[idx] || idx));
  return { grid: newGrid, allowedIndices: Array.from(kept) };
}

// ========== Floyd-Steinberg 抖动 ==========

/**
 * 误差扩散抖动：当前像素匹配误差按比例分给周围像素
 * 用两色交错模拟中间色，缓解渐变区域的色带问题
 * 支持限定色板子集（限制用色数时）
 */
function floydSteinbergDither(grid, gridSize, allowedIndices) {
  const buf = grid.map(p => p ? [p[0], p[1], p[2]] : null);
  const result = new Array(grid.length);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (buf[idx] === null) { result[idx] = null; continue; }

      const oldR = buf[idx][0], oldG = buf[idx][1], oldB = buf[idx][2];
      const pi = nearestColor([oldR, oldG, oldB], allowedIndices);
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

// ========== 轮廓增强 ==========

/**
 * 轮廓增强：浅色被深色包围时，用更深的邻居替换，让轮廓更清晰
 * 特别适合小尺寸图纸，避免轮廓线被平均掉
 */
function enhanceEdges(grid, gridSize) {
  const result = grid.slice();
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (result[idx] === null) continue;
      const curL = PALETTE[result[idx]].lab[0];
      if (curL < 50) continue; // 已经是深色，跳过

      // 收集四邻域的深色邻居
      const darkNeighbors = [];
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dy, dx] of dirs) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= gridSize || nx < 0 || nx >= gridSize) continue;
        const nidx = ny * gridSize + nx;
        if (result[nidx] === null) continue;
        const nL = PALETTE[result[nidx]].lab[0];
        if (nL < curL - 20) darkNeighbors.push(result[nidx]);
      }

      // 有2个以上深色邻居，说明这是轮廓边缘的浅色点，用最深的邻居替换
      if (darkNeighbors.length >= 2) {
        let darkest = darkNeighbors[0], minL = PALETTE[darkest].lab[0];
        for (const n of darkNeighbors) {
          if (PALETTE[n].lab[0] < minL) { minL = PALETTE[n].lab[0]; darkest = n; }
        }
        result[idx] = darkest;
      }
    }
  }
  return result;
}

// ========== 主处理流程 ==========

function processImage(img, opts) {
  const { gridSize, sampleMode, colorLimit, useDither, useDespeckle, useEdgeEnhance } = opts;

  matchCache.clear();

  // 1. 像素化
  const pixels = sampleMode === 'dominant'
    ? sampleDominant(img, gridSize)
    : sampleAverage(img, gridSize);

  // 2. 如果限制颜色数量，先全色匹配统计，再合并到 N 色，得到允许的色号子集
  let allowedIndices = null;
  if (colorLimit && colorLimit < PALETTE.length) {
    const preGrid = pixels.map(p => p === null ? null : nearestColor(p));
    const merged = mergeToNColors(preGrid, colorLimit);
    allowedIndices = merged.allowedIndices;
  }

  // 3. 色卡匹配 + 抖动（都在允许的色号子集里做）
  let grid;
  if (useDither) {
    grid = floydSteinbergDither(pixels, gridSize, allowedIndices);
  } else {
    grid = pixels.map(p => p === null ? null : nearestColor(p, allowedIndices));
  }

  // 4. 去孤立杂点
  if (useDespeckle) {
    grid = removeSpeckles(grid, gridSize);
  }

  // 5. 轮廓增强
  if (useEdgeEnhance) {
    grid = enhanceEdges(grid, gridSize);
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
let sampleMode = 'dominant'; // average | dominant，卡通图默认主导色
let useDither = false;
let useDespeckle = true;
let useEdgeEnhance = false; // 轮廓增强默认关闭，容易过度加深

function getOptions() {
  return {
    gridSize: +$('#sizeRange').value,
    sampleMode,
    colorLimit: +$('#paletteRange').value,
    useDither,
    useDespeckle,
    useEdgeEnhance,
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
