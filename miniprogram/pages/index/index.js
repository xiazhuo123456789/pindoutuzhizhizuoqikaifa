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

    ctx.clearRect(0, 0, 1200, 1200);
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

  // 渲染图纸到canvas
  renderToCanvas(grid, gridSize) {
    const { canvasRenderSize, showGrid, showLabels } = this.data;
    const ctx = wx.createCanvasContext('beadCanvas');
    const cellSize = canvasRenderSize / gridSize;

    // 清空
    ctx.clearRect(0, 0, canvasRenderSize, canvasRenderSize);
    ctx.setFillStyle('#FAF8F2');
    ctx.fillRect(0, 0, canvasRenderSize, canvasRenderSize);

    // 1. 填色块
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        if (grid[idx] === null) continue;
        ctx.setFillStyle(PALETTE[grid[idx]].hex);
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    // 2. 色号标注
    if (showLabels && cellSize >= 16) {
      const fontSize = Math.max(8, Math.floor(cellSize * 0.32));
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
          ctx.setFillStyle(brightness > 140 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)');
          ctx.fillText(color.code, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
        }
      }
    }

    // 3. 网格线
    if (showGrid) {
      // 细网格线
      ctx.setStrokeStyle('rgba(32,34,31,0.15)');
      ctx.setLineWidth(1);
      for (let i = 0; i <= gridSize; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvasRenderSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvasRenderSize, i * cellSize);
        ctx.stroke();
      }
      // 每5格加粗定位线
      ctx.setStrokeStyle('rgba(32,34,31,0.4)');
      ctx.setLineWidth(2.5);
      for (let i = 0; i <= gridSize; i += 5) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvasRenderSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvasRenderSize, i * cellSize);
        ctx.stroke();
      }
    }

    ctx.draw();
  },

  // 导出图片到相册
  exportImage() {
    if (!this.data.hasResult) return;

    wx.showLoading({ title: '保存中...' });

    wx.canvasToTempFilePath({
      canvasId: 'beadCanvas',
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
  }
});
