# 实施计划与验收边界

## 已确认的产品决策

- Vue 3 / TypeScript / Vite / mdui 2，纯浏览器本地处理，图片不上传。
- 桌面 Chrome / Edge 优先；移动端自适应，根据设备能力降级。
- 超分：RealCUGAN v3 保守版 2× / 4×、Real-ESRGAN 通用与动漫轻量版。
- 指定输出倍率 1～4（含小数），原图 / 结果滑块对比、同步缩放平移。
- 调色：RGB / R / G / B，以及按色相调整色相、饱和度、明度的曲线。
- 抠图：U2NetP 自动去背景，遮罩预览、反选、收缩 / 扩张、羽化、透明 PNG。
- WebGPU / WebGL 手动选择，独立的 WASM CPU 兼容模式，明确显示实际后端。
- 首版 FP32，sRGB 8 位，单张 PNG / JPEG / WebP；默认 PNG 导出。
- 桌面输出不超过 6400 万像素 / 单边 8192，移动端不超过 1600 万像素 / 单边 4096。

## 交付顺序（每步验收、独立提交并推送）

1. 模型导出 / 来源 / 校验清单 / Python 数值参考与浏览器原型。
2. mdui 工作区、图像导入导出、对比与实时曲线调色。
3. 超分 Worker、SE 跨块同步、指定倍率与分块重采样、进度 / 取消。
4. 自动抠图及遮罩编辑。
5. 真实浏览器验收、文档、本地服务启动。

## 验收依据

- 模型转换 CPU 参考 MAE <= 1e-4（归一化浮点）；GPU 8 位输出平均误差 <= 1 灰阶。
- 强制每个后端，记录 GPU / WASM，不能将 CPU 后备标为 GPU 验收。
- 奇数尺寸 / 透明输入 / 小数倍率 / 分块接缝 / 曲线首尾 / 常量遮罩。
- 取消、换图、下载失败、缓存损坏、连续任务，过期任务不能覆盖当前图片。
- 性能记录注明输入尺寸、模型、后端、硬件；不根据文件大小推断实时性能。

## 调研资料

- RealCUGAN: https://github.com/bilibili/ailab/tree/main/Real-CUGAN （MIT）
- Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN （BSD-3-Clause）
- U2Net: https://github.com/xuebinqin/U-2-Net （Apache-2.0）
- U2NetP ONNX: https://github.com/danielgatis/rembg/releases/tag/v0.0.0
- ORT WebGPU: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- WebGL 弃用跟踪: https://github.com/microsoft/onnxruntime/issues/32241
- mdui + Vue: https://www.mdui.org/zh-cn/docs/2/frameworks/vue

模型适配重点：RealCUGAN 分阶段同步四处 SE 均值；SRVGG 的 PReLU 等价展开；U2NetP 固定 320 输入下将 ceil 池化等价改写。采用相同转换产物验证双 GPU 后端。

## 实施状态（2026-10-18）

五项交付内容已完成。模型 / 工具、处理核心、mdui 工作区、浏览器验收与修正、调研及运行文档分步提交。最终生产包运行于 `http://127.0.0.1:4188/`，开发服务使用 5188 端口。
具体已通过的测试和未覆盖的设备边界以 [验收记录](verification/README.md) 为准。
