const beadCore = require('../../utils/beadCore.js');
const { PALETTE, sampleAverage, sampleDominant, processGrid, buildMaterialList } = beadCore;

Page({
  data: {
    imagePath: '',
    imgWidth: 0,
    imgHeight: 0,
    gridSize: 48,
    colorLimit: 16,
    sampleMode: 'dominant',
    useDither: false,
    useDespeckle: true,
    useEdgeEnhance: false,
    showGrid: true,
    showLabels: true,
    hasResult: false,
    materialList: [],
    totalBeads: 0,
    canvasDisplaySize: 320,
    canvasRenderSize: 640,
    isProcessing: false
  },

  // 用普通变量保存grid数据，不走setData（避免大数据序列化丢失）
  currentGrid: null,

  onLoad() {
    // 计算canvas显示尺寸（屏幕宽度的90%）
    const sysInfo = wx.getSystemInfoSync();
    const displaySize = Math.floor(sysInfo.windowWidth * 0.9);
    // 实际渲染尺寸用2倍，保证清晰度
    const renderSize = displaySize * 2;
    this.setData({
      canvasDisplaySize: displaySize,
      canvasRenderSize: renderSize
    });
  },

  // 选择图片
  chooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFilePaths[0];
        wx.getImageInfo({
          src: tempPath,
          success: (info) => {
            this.setData({
              imagePath: tempPath,
              imgWidth: info.width,
              imgHeight: info.height,
              hasResult: false,
              materialList: [],
              totalBeads: 0
            });
            this.processAndRender();
          }
        });
      }
    });
  },

  // 尺寸变化
  onSizeChange(e) {
    this.setData({ gridSize: e.detail.value });
    this.processAndRender();
  },

  // 色数变化
  onColorChange(e) {
    this.setData({ colorLimit: e.detail.value });
    this.processAndRender();
  },

  // 采样方式切换
  onSampleModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ sampleMode: mode });
    this.processAndRender();
  },

  // 抖动开关
  onDitherToggle() {
    this.setData({ useDither: !this.data.useDither });
    this.processAndRender();
  },

  // 网格开关
  onGridToggle() {
    this.setData({ showGrid: !this.data.showGrid });
    this.processAndRender();
  },

  // 色号开关
  onLabelToggle() {
    this.setData({ showLabels: !this.data.showLabels });
    this.processAndRender();
  },

  // 主处理流程
  processAndRender() {
    if (!this.data.imagePath || this.data.isProcessing) return;
    this.setData({ isProcessing: true });

    const { gridSize, sampleMode, imagePath, imgWidth, imgHeight } = this.data;
    const scale = 8;
    const workSize = gridSize * scale;

    // 用隐藏canvas绘制图片并获取像素数据
    const ctx = wx.createCanvasContext('hiddenCanvas');

    // cover模式裁剪：取正方形中心区域
    const side = Math.min(imgWidth, imgHeight);
    const sx = (imgWidth - side) / 2;
    const sy = (imgHeight - side) / 2;

    ctx.clearRect(0, 0, 3000, 3500);
    ctx.drawImage(imagePath, sx, sy, side, side, 0, 0, workSize, workSize);

    ctx.draw(false, () => {
      wx.canvasGetImageData({
        canvasId: 'hiddenCanvas',
        x: 0,
        y: 0,
        width: workSize,
        height: workSize,
        success: (res) => {
          const data = res.data;

          // 1. 像素化采样
          const pixels = sampleMode === 'dominant'
            ? sampleDominant(data, gridSize, scale)
            : sampleAverage(data, gridSize, scale);

          // 2. 颜色处理
          const grid = processGrid(pixels, {
            gridSize,
            sampleMode,
            colorLimit: this.data.colorLimit,
            useDither: this.data.useDither,
            useDespeckle: this.data.useDespeckle,
            useEdgeEnhance: this.data.useEdgeEnhance
          });

          // 3. 渲染到canvas
          this.renderToCanvas(grid, gridSize);

          // 4. 材料清单
          const { list, total } = buildMaterialList(grid);
          const materialList = list.map(item => ({
            idx: item.idx,
            qty: item.qty,
            code: PALETTE[item.idx].code,
            hex: PALETTE[item.idx].hex
          }));

          // 保存grid数据到普通变量（不走setData，避免大数据序列化丢失）
          this.currentGrid = grid;

          // 调试信息
          const nonNull = grid.filter(v => v !== null && v !== undefined).length;
          console.log('grid生成完成:', {
            length: grid.length,
            expected: gridSize * gridSize,
            nonNull: nonNull,
            nullCount: grid.length - nonNull,
            gridSize: gridSize
          });

          this.setData({
            hasResult: true,
            materialList,
            totalBeads: total,
            isProcessing: false
          });
        },
        fail: (err) => {
          console.error('获取像素数据失败', err);
          this.setData({ isProcessing: false });
          wx.showToast({ title: '处理失败', icon: 'none' });
        }
      });
    });
  },

  // 计算浅色背景（颜色和白色混合）
  getLightColor(rgb, ratio) {
    const r = Math.round(rgb[0] * ratio + 255 * (1 - ratio));
    const g = Math.round(rgb[1] * ratio + 255 * (1 - ratio));
    const b = Math.round(rgb[2] * ratio + 255 * (1 - ratio));
    return `rgb(${r},${g},${b})`;
  },

  // 渲染图纸到canvas（预览区只显示图纸，不带坐标）
  renderToCanvas(grid, gridSize) {
    const { canvasRenderSize, showGrid, showLabels } = this.data;
    const ctx = wx.createCanvasContext('beadCanvas');

    // 预览区用整个canvas大小显示图纸，不带坐标
    const cellSize = canvasRenderSize / gridSize;

    // 清空 + 背景
    ctx.clearRect(0, 0, canvasRenderSize, canvasRenderSize);
    ctx.setFillStyle('#FFFFFF');
    ctx.fillRect(0, 0, canvasRenderSize, canvasRenderSize);

    // ===== 1. 填色块（浅色背景模式） =====
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        if (grid[idx] === null) {
          ctx.setFillStyle('#FAFAFA');
        } else {
          const color = PALETTE[grid[idx]];
          const [r, g, b] = color.rgb;
          const brightness = r * 0.299 + g * 0.587 + b * 0.114;
          // 深色用原色，浅色用和白色混合后的浅色
          if (brightness < 100) {
            ctx.setFillStyle(color.hex);
          } else {
            ctx.setFillStyle(this.getLightColor(color.rgb, 0.35));
          }
        }
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    // ===== 2. 色号标注（格子够大才显示） =====
    if (showLabels && cellSize >= 12) {
      const fontSize = Math.max(7, Math.floor(cellSize * 0.35));
      ctx.setFontSize(fontSize);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('middle');
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const idx = y * gridSize + x;
          if (grid[idx] === null) continue;
          const color = PALETTE[grid[idx]];
          const [r, g, b] = color.rgb;
          const brightness = r * 0.299 + g * 0.587 + b * 0.114;
          // 深色背景白字，浅色背景黑字
          ctx.setFillStyle(brightness < 100 ? '#FFFFFF' : '#333333');
          ctx.fillText(color.code, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
        }
      }
    }

    // ===== 3. 网格线 =====
    if (showGrid) {
      // 细网格线
      ctx.setStrokeStyle('rgba(0,0,0,0.12)');
      ctx.setLineWidth(0.8);
      for (let i = 0; i <= gridSize; i++) {
        const pos = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, canvasRenderSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(canvasRenderSize, pos);
        ctx.stroke();
      }
      // 每5格红色加粗定位线
      ctx.setStrokeStyle('#E74C3C');
      ctx.setLineWidth(2);
      for (let i = 0; i <= gridSize; i += 5) {
        const pos = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, canvasRenderSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(canvasRenderSize, pos);
        ctx.stroke();
      }
    }

    ctx.draw();
  },

  // 导出图片到相册（完整大图：坐标+图纸+材料清单+像素总数）
  exportImage() {
    if (!this.data.hasResult) return;

    // 校验grid数据，并从数据本身推断gridSize（避免滑块拖动时的竞态问题）
    const grid = this.currentGrid;
    if (!grid || grid.length === 0) {
      wx.showToast({ title: '请先生成图纸', icon: 'none' });
      return;
    }
    const gridSize = Math.round(Math.sqrt(grid.length));
    if (gridSize * gridSize !== grid.length) {
      wx.showToast({ title: '数据异常，请重新生成', icon: 'none' });
      console.error('grid长度不是完全平方数:', { length: grid.length });
      return;
    }

    wx.showLoading({ title: '生成图纸中...' });

    const { materialList } = this.data;
    const ctx = wx.createCanvasContext('hiddenCanvas');

    // 导出尺寸计算
    const coordSize = 50;
    const maxWidth = 2900;
    const cellSize = Math.max(10, Math.floor((maxWidth - coordSize) / gridSize));
    const patternWidth = gridSize * cellSize;
    const patternHeight = gridSize * cellSize;
    // 材料清单高度动态计算
    const itemSize = 60;
    const itemGap = 20;
    const itemsPerRow = Math.floor((coordSize + patternWidth - 60) / (itemSize + itemGap));
    const materialRows = Math.ceil(materialList.length / Math.max(1, itemsPerRow));
    const materialHeight = 60 + materialRows * 90 + 40;
    const totalWidth = coordSize + patternWidth;
    const totalHeight = coordSize + patternHeight + materialHeight;

    // 清空
    ctx.clearRect(0, 0, 3000, 3500);
    ctx.setFillStyle('#FFFFFF');
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // ===== 1. 顶部列号 =====
    ctx.setFillStyle('#F0F0F0');
    ctx.fillRect(coordSize, 0, patternWidth, coordSize);
    ctx.setFontSize(Math.max(12, Math.floor(coordSize * 0.4)));
    ctx.setTextAlign('center');
    ctx.setTextBaseline('middle');
    ctx.setFillStyle('#333333');
    for (let x = 0; x < gridSize; x++) {
      ctx.fillText(String(x + 1), coordSize + x * cellSize + cellSize / 2, coordSize / 2);
    }

    // ===== 2. 左侧行号 =====
    ctx.setFillStyle('#F0F0F0');
    ctx.fillRect(0, coordSize, coordSize, patternHeight);
    for (let y = 0; y < gridSize; y++) {
      ctx.fillText(String(y + 1), coordSize / 2, coordSize + y * cellSize + cellSize / 2);
    }

    // ===== 3. 填色块（浅色背景模式） =====
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        const colorIdx = grid[idx];
        if (colorIdx === null || colorIdx === undefined || colorIdx < 0) {
          ctx.setFillStyle('#FAFAFA');
        } else {
          const color = PALETTE[colorIdx];
          if (color) {
            const [r, g, b] = color.rgb;
            const brightness = r * 0.299 + g * 0.587 + b * 0.114;
            if (brightness < 100) {
              ctx.setFillStyle(color.hex);
            } else {
              ctx.setFillStyle(this.getLightColor(color.rgb, 0.35));
            }
          } else {
            ctx.setFillStyle('#FAFAFA');
          }
        }
        ctx.fillRect(coordSize + x * cellSize, coordSize + y * cellSize, cellSize, cellSize);
      }
    }

    // ===== 4. 色号标注 =====
    const fontSize = Math.max(8, Math.floor(cellSize * 0.3));
    ctx.setFontSize(fontSize);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('middle');
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        const colorIdx = grid[idx];
        if (colorIdx === null || colorIdx === undefined || colorIdx < 0) continue;
        const color = PALETTE[colorIdx];
        if (!color) continue;
        const [r, g, b] = color.rgb;
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        ctx.setFillStyle(brightness < 100 ? '#FFFFFF' : '#333333');
        ctx.fillText(color.code, coordSize + x * cellSize + cellSize / 2, coordSize + y * cellSize + cellSize / 2);
      }
    }

    // ===== 5. 网格线 =====
    ctx.setStrokeStyle('rgba(0,0,0,0.12)');
    ctx.setLineWidth(1);
    for (let i = 0; i <= gridSize; i++) {
      const pos = coordSize + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, coordSize);
      ctx.lineTo(pos, coordSize + patternHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(coordSize, pos);
      ctx.lineTo(coordSize + patternWidth, pos);
      ctx.stroke();
    }
    // 每5格红色加粗定位线
    ctx.setStrokeStyle('#E74C3C');
    ctx.setLineWidth(2.5);
    for (let i = 0; i <= gridSize; i += 5) {
      const pos = coordSize + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, coordSize);
      ctx.lineTo(pos, coordSize + patternHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(coordSize, pos);
      ctx.lineTo(coordSize + patternWidth, pos);
      ctx.stroke();
    }

    // ===== 6. 底部材料清单 =====
    const materialY = coordSize + patternHeight + 30;
    ctx.setFillStyle('#20221F');
    ctx.setFontSize(32);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('top');
    ctx.fillText('物料清单', 30, materialY);

    // 彩色方块+色号+数量
    materialList.forEach((item, i) => {
      const row = Math.floor(i / itemsPerRow);
      const col = i % itemsPerRow;
      const ix = 30 + col * (itemSize + itemGap);
      const iy = materialY + 55 + row * 90;

      // 彩色方块
      ctx.setFillStyle(item.hex);
      ctx.fillRect(ix, iy, itemSize, itemSize);
      // 色号文字
      const [r, g, b] = this.hexToRgb(item.hex);
      const brightness = r * 0.299 + g * 0.587 + b * 0.114;
      ctx.setFillStyle(brightness < 120 ? '#FFFFFF' : '#20221F');
      ctx.setFontSize(20);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('middle');
      ctx.fillText(item.code, ix + itemSize / 2, iy + itemSize / 2);
      // 数量
      ctx.setFillStyle('#666666');
      ctx.setFontSize(18);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('top');
      ctx.fillText('x' + item.qty, ix + itemSize / 2, iy + itemSize + 6);
    });

    // ===== 7. 像素总数（右下角） =====
    ctx.setFillStyle('#999999');
    ctx.setFontSize(24);
    ctx.setTextAlign('right');
    ctx.setTextBaseline('bottom');
    ctx.fillText('像素总数量: ' + (gridSize * gridSize), totalWidth - 30, totalHeight - 20);

    ctx.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: 'hiddenCanvas',
        x: 0,
        y: 0,
        width: totalWidth,
        height: totalHeight,
        destWidth: totalWidth,
        destHeight: totalHeight,
        success: (res) => {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => {
              wx.hideLoading();
              wx.showToast({ title: '已保存到相册', icon: 'success' });
            },
            fail: (err) => {
              wx.hideLoading();
              if (err.errMsg.indexOf('auth deny') > -1) {
                wx.showModal({
                  title: '需要相册权限',
                  content: '请在设置中开启相册权限',
                  confirmText: '去设置',
                  success: (modalRes) => {
                    if (modalRes.confirm) {
                      wx.openSetting();
                    }
                  }
                });
              } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
              }
            }
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      });
    });
  },

  // hex转rgb
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [200, 200, 200];
  }
});
