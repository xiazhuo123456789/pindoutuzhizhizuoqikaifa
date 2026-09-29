/**
 * 豆趣 · 拼豆图纸制作器 - 核心算法（微信小程序版，无DOM依赖）
 * 
 * 包含：
 * 1. RGB → CIE Lab 色彩空间转换
 * 2. MARD 221 色板匹配（CIE76）
 * 3. 格内平均色 / 主导色提取（从像素数据采样）
 * 4. 先全色匹配再合并到 N 色（亮度约束）
 * 5. Floyd-Steinberg 抖动
 * 6. 去孤立杂点
 * 7. 轮廓增强
 * 8. 材料清单统计
 */

// ========== MARD 221 色板 ==========

const MARD_PALETTE = [
  // A 系 - 黄橙系 26色
  { code: 'A1',  hex: '#F9F0CD' }, { code: 'A2',  hex: '#FBFBD4' },
  { code: 'A3',  hex: '#FAFC9F' }, { code: 'A4',  hex: '#FFE953' },
  { code: 'A5',  hex: '#F4D738' }, { code: 'A6',  hex: '#FDAD49' },
  { code: 'A7',  hex: '#FF7C2F' }, { code: 'A8',  hex: '#EACA49' },
  { code: 'A9',  hex: '#FF995A' }, { code: 'A10', hex: '#FF9D55' },
  { code: 'A11', hex: '#FFDD99' }, { code: 'A12', hex: '#FCB58F' },
  { code: 'A13', hex: '#FFBB59' }, { code: 'A14', hex: '#FF6D40' },
  { code: 'A15', hex: '#FDFF44' }, { code: 'A16', hex: '#FEF9AE' },
  { code: 'A17', hex: '#FFE36E' }, { code: 'A18', hex: '#FECF98' },
  { code: 'A19', hex: '#FD7B72' }, { code: 'A20', hex: '#EFCD67' },
  { code: 'A21', hex: '#FFE395' }, { code: 'A22', hex: '#FFF3A4' },
  { code: 'A23', hex: '#F3D5BF' }, { code: 'A24', hex: '#FBF8C9' },
  { code: 'A25', hex: '#FFD67D' }, { code: 'A26', hex: '#FFBB27' },
  // B 系 - 绿系 32色
  { code: 'B1',  hex: '#E6EE32' }, { code: 'B2',  hex: '#5BE419' },
  { code: 'B3',  hex: '#7CEE9D' }, { code: 'B4',  hex: '#1EF942' },
  { code: 'B5',  hex: '#00BD35' }, { code: 'B6',  hex: '#5AE8BA' },
  { code: 'B7',  hex: '#03AC88' }, { code: 'B8',  hex: '#029D26' },
  { code: 'B9',  hex: '#26523A' }, { code: 'B10', hex: '#95D3C2' },
  { code: 'B11', hex: '#5D722A' }, { code: 'B12', hex: '#156F40' },
  { code: 'B13', hex: '#D9F794' }, { code: 'B14', hex: '#ADE945' },
  { code: 'B15', hex: '#2E5132' }, { code: 'B16', hex: '#C6ED9C' },
  { code: 'B17', hex: '#9BB13A' }, { code: 'B18', hex: '#E6EE49' },
  { code: 'B19', hex: '#25B88C' }, { code: 'B20', hex: '#C2F0CC' },
  { code: 'B21', hex: '#146A6B' }, { code: 'B22', hex: '#0B3C43' },
  { code: 'B23', hex: '#303921' }, { code: 'B24', hex: '#EEFCA5' },
  { code: 'B25', hex: '#4E846D' }, { code: 'B26', hex: '#8C7A36' },
  { code: 'B27', hex: '#D1DCC1' }, { code: 'B28', hex: '#9EE5B9' },
  { code: 'B29', hex: '#C5E254' }, { code: 'B30', hex: '#ECFBD0' },
  { code: 'B31', hex: '#C4E6B5' }, { code: 'B32', hex: '#9BAB5A' },
  // C 系 - 蓝系 29色
  { code: 'C1',  hex: '#E8FFE7' }, { code: 'C2',  hex: '#BCF9F6' },
  { code: 'C3',  hex: '#A0E2FB' }, { code: 'C4',  hex: '#42CCFF' },
  { code: 'C5',  hex: '#01ACEB' }, { code: 'C6',  hex: '#50A9F0' },
  { code: 'C7',  hex: '#0188D3' }, { code: 'C8',  hex: '#1054C0' },
  { code: 'C9',  hex: '#314BCA' }, { code: 'C10', hex: '#3EBCE2' },
  { code: 'C11', hex: '#03B9B9' }, { code: 'C12', hex: '#1C334D' },
  { code: 'C13', hex: '#CDE8FF' }, { code: 'C14', hex: '#D5FDFF' },
  { code: 'C15', hex: '#23C4C6' }, { code: 'C16', hex: '#1757A8' },
  { code: 'C17', hex: '#50D3EC' }, { code: 'C18', hex: '#1C3344' },
  { code: 'C19', hex: '#1787A2' }, { code: 'C20', hex: '#0082BE' },
  { code: 'C21', hex: '#BEDDFF' }, { code: 'C22', hex: '#67B4BE' },
  { code: 'C23', hex: '#C2DCEB' }, { code: 'C24', hex: '#7DC4FF' },
  { code: 'C25', hex: '#A9E5E5' }, { code: 'C26', hex: '#2F99B3' },
  { code: 'C27', hex: '#EBF5FC' }, { code: 'C28', hex: '#BBCFED' },
  { code: 'C29', hex: '#4B5BA3' },
  // D 系 - 蓝紫系 26色
  { code: 'D1',  hex: '#AEB4F2' }, { code: 'D2',  hex: '#858EDD' },
  { code: 'D3',  hex: '#3054AF' }, { code: 'D4',  hex: '#182A84' },
  { code: 'D5',  hex: '#B843C5' }, { code: 'D6',  hex: '#AC7BDE' },
  { code: 'D7',  hex: '#6E399A' }, { code: 'D8',  hex: '#E2D3FF' },
  { code: 'D9',  hex: '#D5B9F8' }, { code: 'D10', hex: '#361B50' },
  { code: 'D11', hex: '#B9BAE1' }, { code: 'D12', hex: '#DE9AD4' },
  { code: 'D13', hex: '#B90295' }, { code: 'D14', hex: '#8B279B' },
  { code: 'D15', hex: '#2F1F90' }, { code: 'D16', hex: '#E2E1EE' },
  { code: 'D17', hex: '#C4D4F6' }, { code: 'D18', hex: '#A45EC7' },
  { code: 'D19', hex: '#D8C3D7' }, { code: 'D20', hex: '#9C32B2' },
  { code: 'D21', hex: '#9A009B' }, { code: 'D22', hex: '#333995' },
  { code: 'D23', hex: '#EADAFC' }, { code: 'D24', hex: '#7786E5' },
  { code: 'D25', hex: '#484FC7' }, { code: 'D26', hex: '#E9C3F6' },
  // E 系 - 粉玫系 24色
  { code: 'E1',  hex: '#FDD3CC' }, { code: 'E2',  hex: '#FECDDF' },
  { code: 'E3',  hex: '#FF97C3' }, { code: 'E4',  hex: '#E8649E' },
  { code: 'E5',  hex: '#F551A2' }, { code: 'E6',  hex: '#FF346B' },
  { code: 'E7',  hex: '#C63578' }, { code: 'E8',  hex: '#FFDBE9' },
  { code: 'E9',  hex: '#E970CC' }, { code: 'E10', hex: '#D33893' },
  { code: 'E11', hex: '#FCDDD2' }, { code: 'E12', hex: '#FFA1C5' },
  { code: 'E13', hex: '#B6006D' }, { code: 'E14', hex: '#FFD1BA' },
  { code: 'E15', hex: '#F2CFD0' }, { code: 'E16', hex: '#FFECDE' },
  { code: 'E17', hex: '#FFE2EA' }, { code: 'E18', hex: '#FFC9D6' },
  { code: 'E19', hex: '#FFD2E7' }, { code: 'E20', hex: '#D8C7D1' },
  { code: 'E21', hex: '#BD9DA1' }, { code: 'E22', hex: '#CC78A7' },
  { code: 'E23', hex: '#937A8D' }, { code: 'E24', hex: '#F6E4F9' },
  // F 系 - 红色系 25色
  { code: 'F1',  hex: '#FD957B' }, { code: 'F2',  hex: '#FC3D45' },
  { code: 'F3',  hex: '#F74941' }, { code: 'F4',  hex: '#FC283C' },
  { code: 'F5',  hex: '#D80127' }, { code: 'F6',  hex: '#B0443D' },
  { code: 'F7',  hex: '#971937' }, { code: 'F8',  hex: '#BC0127' },
  { code: 'F9',  hex: '#E2677A' }, { code: 'F10', hex: '#A74D22' },
  { code: 'F11', hex: '#6F201F' }, { code: 'F12', hex: '#FD4D6A' },
  { code: 'F13', hex: '#DD422F' }, { code: 'F14', hex: '#FFA9AD' },
  { code: 'F15', hex: '#C80020' }, { code: 'F16', hex: '#FFD9C8' },
  { code: 'F17', hex: '#F79B71' }, { code: 'F18', hex: '#D37C46' },
  { code: 'F19', hex: '#C1444A' }, { code: 'F20', hex: '#CD9391' },
  { code: 'F21', hex: '#F4B1B4' }, { code: 'F22', hex: '#FFD0CB' },
  { code: 'F23', hex: '#F57E66' }, { code: 'F24', hex: '#FCC1C4' },
  { code: 'F25', hex: '#E54B4F' },
  // G 系 - 棕肤系 21色
  { code: 'G1',  hex: '#FFE2CE' }, { code: 'G2',  hex: '#FFCAAA' },
  { code: 'G3',  hex: '#F4C3A5' }, { code: 'G4',  hex: '#E1B383' },
  { code: 'G5',  hex: '#ED9435' }, { code: 'G6',  hex: '#F59734' },
  { code: 'G7',  hex: '#9D5B3E' }, { code: 'G8',  hex: '#592A21' },
  { code: 'G9',  hex: '#E6B483' }, { code: 'G10', hex: '#C88135' },
  { code: 'G11', hex: '#E0C593' }, { code: 'G12', hex: '#EBBB83' },
  { code: 'G13', hex: '#B7714A' }, { code: 'G14', hex: '#8D614C' },
  { code: 'G15', hex: '#FCF9E0' }, { code: 'G16', hex: '#F2D9BA' },
  { code: 'G17', hex: '#56403C' }, { code: 'G18', hex: '#FFE4CC' },
  { code: 'G19', hex: '#E1943A' }, { code: 'G20', hex: '#A94023' },
  { code: 'G21', hex: '#CB8E77' },
  // H 系 - 黑白灰系 23色
  { code: 'H1',  hex: '#E2E2E2' }, { code: 'H2',  hex: '#FFFFFF' },
  { code: 'H3',  hex: '#B3B3B3' }, { code: 'H4',  hex: '#868686' },
  { code: 'H5',  hex: '#474747' }, { code: 'H6',  hex: '#2C2C2C' },
  { code: 'H7',  hex: '#000000' }, { code: 'H8',  hex: '#E7D6DB' },
  { code: 'H9',  hex: '#E4E7E3' }, { code: 'H10', hex: '#EEE9EA' },
  { code: 'H11', hex: '#CECDD5' }, { code: 'H12', hex: '#FFF5ED' },
  { code: 'H13', hex: '#F3E1C9' }, { code: 'H14', hex: '#CFD7D3' },
  { code: 'H15', hex: '#98A6A8' }, { code: 'H16', hex: '#3B2F23' },
  { code: 'H17', hex: '#F1EDED' }, { code: 'H18', hex: '#FFFDF0' },
  { code: 'H19', hex: '#F6EFE2' }, { code: 'H20', hex: '#949FA3' },
  { code: 'H21', hex: '#F7F3E4' }, { code: 'H22', hex: '#CACAD5' },
  { code: 'H23', hex: '#9A9D94' },
  // M 系 - 大地系 15色
  { code: 'M1',  hex: '#BCC6B8' }, { code: 'M2',  hex: '#8AA385' },
  { code: 'M3',  hex: '#697D80' }, { code: 'M4',  hex: '#DACEBE' },
  { code: 'M5',  hex: '#D0CCAA' }, { code: 'M6',  hex: '#B0A782' },
  { code: 'M7',  hex: '#B4A497' }, { code: 'M8',  hex: '#B38281' },
  { code: 'M9',  hex: '#A58767' }, { code: 'M10', hex: '#C5B1BC' },
  { code: 'M11', hex: '#9F7494' }, { code: 'M12', hex: '#644749' },
  { code: 'M13', hex: '#D19066' }, { code: 'M14', hex: '#C77361' },
  { code: 'M15', hex: '#757D7B' }
];

// ========== 色彩空间转换 ==========

function srgbToLinear(c) {
  c = c / 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

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

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ========== 色板预处理 ==========

const PALETTE = MARD_PALETTE.map(item => {
  const rgb = hexToRgb(item.hex);
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  return { code: item.code, hex: item.hex, rgb, lab };
});

// ========== 颜色匹配 ==========

const matchCache = new Map();

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

function clearMatchCache() {
  matchCache.clear();
}

// ========== 像素化：从像素数据采样 ==========

/**
 * 从已缩放的像素数据中采样（平均色模式）
 * @param {Uint8ClampedArray} data - workSize × workSize 的像素数据
 * @param {number} gridSize - 目标格数
 * @param {number} scale - workSize / gridSize
 */
function sampleAverage(data, gridSize, scale) {
  const workSize = gridSize * scale;
  const result = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const idx = (py * workSize + px) * 4;
          const alpha = data[idx + 3];
          if (alpha < 128) continue;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }
      if (count === 0) {
        result.push(null);
      } else {
        result.push([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
      }
    }
  }
  return result;
}

/**
 * 从已缩放的像素数据中采样（主导色模式 v2）
 * scale=8更稳定、16级量化、深色轮廓保护
 */
function sampleDominant(data, gridSize, scale) {
  const workSize = gridSize * scale;
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

      if (darkPixels >= total * 0.35) {
        result.push([darkestR, darkestG, darkestB]);
        continue;
      }

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

// ========== 颜色合并 ==========

function mergeToNColors(grid, targetN) {
  const count = {};
  for (const idx of grid) {
    if (idx === null) continue;
    count[idx] = (count[idx] || 0) + 1;
  }
  const used = Object.keys(count).map(Number);
  if (used.length <= targetN) return { grid, allowedIndices: used };

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
    let victim = -1, minScore = Infinity;
    for (const idx of kept) {
      const score = count[idx] / colorWeight(idx);
      if (score < minScore) { minScore = score; victim = idx; }
    }
    let target = -1, bestDist = Infinity;
    for (const idx of kept) {
      if (idx === victim) continue;
      const p1 = PALETTE[victim], p2 = PALETTE[idx];
      const dL = p1.lab[0] - p2.lab[0];
      if (Math.abs(dL) > 20) continue;
      const dA = p1.lab[1] - p2.lab[1];
      const dB = p1.lab[2] - p2.lab[2];
      const dist = dL * dL + dA * dA + dB * dB;
      if (dist < bestDist) { bestDist = dist; target = idx; }
    }
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

      if (x + 1 < gridSize && buf[idx + 1]) {
        buf[idx + 1][0] = clamp(buf[idx + 1][0] + errR * 7 / 16);
        buf[idx + 1][1] = clamp(buf[idx + 1][1] + errG * 7 / 16);
        buf[idx + 1][2] = clamp(buf[idx + 1][2] + errB * 7 / 16);
      }
      if (x > 0 && y + 1 < gridSize && buf[idx + gridSize - 1]) {
        buf[idx + gridSize - 1][0] = clamp(buf[idx + gridSize - 1][0] + errR * 3 / 16);
        buf[idx + gridSize - 1][1] = clamp(buf[idx + gridSize - 1][1] + errG * 3 / 16);
        buf[idx + gridSize - 1][2] = clamp(buf[idx + gridSize - 1][2] + errB * 3 / 16);
      }
      if (y + 1 < gridSize && buf[idx + gridSize]) {
        buf[idx + gridSize][0] = clamp(buf[idx + gridSize][0] + errR * 5 / 16);
        buf[idx + gridSize][1] = clamp(buf[idx + gridSize][1] + errG * 5 / 16);
        buf[idx + gridSize][2] = clamp(buf[idx + gridSize][2] + errB * 5 / 16);
      }
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

function removeSpeckles(grid, gridSize) {
  let result = grid.slice();
  // 运行3次去杂点，逐步清理
  for (let pass = 0; pass < 3; pass++) {
    const next = result.slice();
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        if (result[idx] === null) continue;

        // 收集8个邻居
        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dy === 0 && dx === 0) continue;
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= gridSize || nx < 0 || nx >= gridSize) continue;
            const nidx = ny * gridSize + nx;
            if (result[nidx] !== null) neighbors.push(result[nidx]);
          }
        }

        if (neighbors.length < 5) continue;

        const curL = PALETTE[result[idx]].lab[0];
        const freq = {};
        for (const n of neighbors) freq[n] = (freq[n] || 0) + 1;
        let best = result[idx], bestCount = 0;
        for (const k in freq) {
          if (freq[k] > bestCount) { bestCount = freq[k]; best = Number(k); }
        }

        // 深色孤立点：周围8个邻居中至少6个是浅色且不同
        if (curL < 50 && bestCount >= 6 && best !== result[idx]) {
          next[idx] = best;
          continue;
        }

        // 普通杂点：所有邻居都不同
        if (neighbors.every(n => n !== result[idx])) {
          next[idx] = best;
        }
      }
    }
    result = next;
  }
  return result;
}

// ========== 轮廓增强 ==========

function enhanceEdges(grid, gridSize) {
  const result = grid.slice();
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      if (result[idx] === null) continue;
      const curL = PALETTE[result[idx]].lab[0];
      if (curL < 50) continue;

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

/**
 * 处理像素数组，生成拼豆图纸网格
 * @param {Array} pixels - 像素数组，每个元素 [r,g,b] 或 null
 * @param {Object} opts - 配置项
 */
function processGrid(pixels, opts) {
  const { gridSize, sampleMode, colorLimit, useDither, useDespeckle, useEdgeEnhance } = opts;

  clearMatchCache();

  let allowedIndices = null;
  if (colorLimit && colorLimit < PALETTE.length) {
    const preGrid = pixels.map(p => p === null ? null : nearestColor(p));
    const merged = mergeToNColors(preGrid, colorLimit);
    allowedIndices = merged.allowedIndices;
  }

  let grid;
  if (useDither) {
    grid = floydSteinbergDither(pixels, gridSize, allowedIndices);
  } else {
    grid = pixels.map(p => p === null ? null : nearestColor(p, allowedIndices));
  }

  if (useDespeckle) {
    grid = removeSpeckles(grid, gridSize);
  }

  if (useEdgeEnhance) {
    grid = enhanceEdges(grid, gridSize);
  }

  return grid;
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

// ========== 导出 ==========

module.exports = {
  PALETTE,
  MARD_PALETTE,
  nearestColor,
  clearMatchCache,
  sampleAverage,
  sampleDominant,
  mergeToNColors,
  floydSteinbergDither,
  removeSpeckles,
  enhanceEdges,
  processGrid,
  buildMaterialList,
  rgbToLab,
  hexToRgb
};
