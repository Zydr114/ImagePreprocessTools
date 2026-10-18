# 像素工坊 · Image Preprocess Tools

基于 **Vue 3 + TypeScript + mdui 2** 的浏览器本地图像处理工具。图像不会上传服务器，模型和运行时从同源静态资源按需加载。

## 功能

- **超分辨率**：RealCUGAN 保守版 2× / 4×、Real-ESRGAN 照片 / 动漫轻量模型。输出 1～4 倍（含小数），非原生倍率通过 Lanczos 3 重采样。
- **曲线调色**：RGB、红、绿、蓝，以及色相 → 色相 / 饱和度 / 明度七组曲线；实时 GPU 预览、原尺寸导出，支持鼠标、键盘和数值编辑控制点。
- **自动抠图**：U2NetP（4.57 MB），提供遮罩预览、反选、边缘收缩 / 扩张和羽化。适用于主体明确的图片，不是 SAM 式交互选区，也不提供精细发丝修复。
- 原图 / 结果分割线对比、同步缩放平移，输出可作为下一工具的输入，随时恢复导入原图。
- PNG / JPEG / WebP 导入和导出，保留透明度；JPEG 可设置透明区域底色。
- 深浅主题、小屏参数抽屉、任务进度与取消、模型 SHA256 校验和缓存管理。

## 本地启动

要求 Node.js **22.12+**（本次验证使用 26.11.1），桌面新版 Chrome / Edge 优先。

```bash
npm ci
npm run dev
```

访问 **http://127.0.0.1:5188/**。初次使用某个后端会加载相应运行时并编译模型。
仓库已包含全部 ONNX 模型，不需要 Python 或额外模型托管服务。`npm run models` 可校验、恢复缺失的模型。

```bash
npm run build
npm run preview -- --port 4188
```

生产构建预览：http://127.0.0.1:4188/ 。静态部署只需发布 `dist/`；子目录部署先设置 `VITE_BASE_PATH=/your-path/` 再构建。
WebGPU、模型哈希校验、缓存需要安全上下文，请使用 HTTPS 或 localhost。普通局域网 HTTP 地址可能无法推理。

## 后端与限制

自动选择顺序：WebGPU → WebGL → WASM。也可手动指定。GPU 模型加载失败时会显示错误，供用户手动选择其他后端；不会悄悄把 CPU 计算显示成 GPU。

- ONNX Runtime Web 固定为 **1.30.0**；WebGL 为兼容后端，需要持续关注上游支持。调色使用独立 WebGL 2 着色器，失败时明确显示 CPU。
- 图像为 **sRGB / 8 bit / 单张静态图片**，不支持 HDR、ICC 配置编辑、动画或批量处理。EXIF 方向由浏览器解码应用；导出不复制原文件元数据。
- 桌面输入 / 输出上限：单边 8192、6400 万像素；窄屏上限：单边 4096、1600 万像素；单文件 <100 MB。这是尺寸保护，不承诺设备内存一定足够。
- 大图仍可能很慢。默认 128 分块，内存分配失败时在相同后端尝试 64 / 32 分块；仍失败则给出可操作错误。取消会终止处理线程。
- RealCUGAN 通过全图四轮共享 SE 均值避免各块单独统计；五阶段图重复了一部分网络，换取较低中间显存占用，速度不等于桌面原生程序。
- 所有模型共 46.55 MB；RealCUGAN 2× / 4× 阶段图各约 16.58 / 18.03 MB。选中的模型才会加载。ORT 还需要约 14～28 MB 的对应 WASM 运行时，不能把模型大小视为总下载量。
- 模型缓存可在右上角“关于与模型缓存”清理。页面不缓存用户图片；刷新页面会丢失编辑状态。

## 开发和验证

```bash
npm test                    # 12 项核心算法测试
npx playwright install chromium
npm run test:browser        # 15 项浏览器流程测试；无 WebGPU 设备时跳过该项
```

硬件 GPU 验证（Linux Vulkan，按环境选择参数）：

```bash
GPU_TEST=1 CHROMIUM_PATH=/path/to/chrome npm run test:browser
```

`GPU_TEST=1` 会启用 `unsafe-webgpu`、忽略 GPU 黑名单并使用 Vulkan / ANGLE，仅供测试；它不改变用户浏览器的配置。`CHROMIUM_PATH` 可省略以使用 Playwright 下载的浏览器。

生产包 UI 验证：先启动 preview，再执行：

```bash
TEST_BASE_URL=http://127.0.0.1:4188 GPU_TEST=1 npm run test:browser -- tests/e2e/ui.spec.ts
```

模型来源、适配理由及重建方式见 [架构与调研](docs/architecture.md)，测试环境、数据和证据边界见 [验收记录](docs/verification/README.md)。

## 上游项目

[RealCUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN)（MIT）、[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)（BSD-3-Clause）、[U²-Net](https://github.com/xuebinqin/U-2-Net)（Apache-2.0）、[rembg](https://github.com/danielgatis/rembg)、[ONNX Runtime](https://onnxruntime.ai/)、[mdui 2](https://www.mdui.org/zh-cn/docs/2/)。模型许可保留在 `public/licenses/`。
