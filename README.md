# ImagePreprocessTools

浏览器中的本地图像处理工具，使用 Vue 3、TypeScript 和 mdui 2 构建。图片在设备上处理，无需上传。

- **图像超分辨率**：RealCUGAN、Real-ESRGAN，支持照片和动漫图片、1～4 倍输出及 WebGPU / WebGL / WASM 后端。
- **曲线调色**：调整 RGB、各颜色通道、色相、饱和度和明度。
- **智能抠图**：轻量 U²-Net 模型，支持边缘收缩、扩张、羽化和遮罩预览。
- 支持原图对比、结果复用、PNG / JPEG / WebP 导出，以及自定义主题色。

在线使用：**https://tool.talium.site/ImageProprocessTools/**

## 本地运行

需要 Node.js 22.12 或更新版本。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5188/ 。生产构建使用 `npm run build`，预览使用 `npm run preview`。

## 开源许可

本项目采用 [GNU AGPL v3](LICENSE)（`AGPL-3.0-only`）。第三方模型保留各自的 [许可证](public/licenses/)。

技术说明与测试记录见 [docs/architecture.md](docs/architecture.md) 和 [docs/verification/README.md](docs/verification/README.md)；部署方法见 [docs/deployment.md](docs/deployment.md)。
