# 验收记录

日期：2026-10-18。环境：Node 26.11.1、Linux、AMD Radeon 880M / RDNA 3、Chromium 153.0.8010.12（Playwright Chromium revision 1243）。
GPU 测试通过 Vulkan / ANGLE 显式启用硬件；结果不代表默认 Linux 浏览器一定开启 WebGPU。实际用户页面按能力检测。

## 模型图

`models.json` 保存 13 个导出图 × WebGPU / WebGL / WASM 的 **39 项**数值结果；`cpu-models.json` 保存与原始 CPU 模型的等价性校验。

- 转换模型 CPU MAE 最大约 3.68e-6；U2NetP 为 0。
- 三后端全部 MAE <1e-4，8 bit 输出 MAE 均 <0.001 灰阶。
- 确认 GPU vendor=amd、architecture=rdna-3，WebGL renderer=AMD Radeon 880M RADV。
- WebGPU 禁用 CPU EP fallback。WebGL 使用 packed 纹理路径。
- 这是固定参考输入的模型图验收，不单独证明大图拼接或所有设备性能。

重跑：先运行 `scripts/convert-models.py` 生成张量参考，启动开发服务器，再运行 `CHROMIUM_PATH=/path/to/chrome npm run test:models`。

## 核心与浏览器

- **12 项单元测试**：中性曲线、插值极值、色相接缝、灰色保护、奇数尺寸、alpha 预乘、流式缩放、常量遮罩、边缘方向、图片尺寸与头部检查。
- **15 项开发构建浏览器测试**：三个显式后端下的全部超分模型、CUGAN 4×、U2NetP；超分输出尺寸 / alpha；调色 GPU/CPU 差异；取消、缓存损坏恢复和 HTTP 503。
- 拼接检查：SRVGG 多块对比独立整图 ONNX；CUGAN 2× / 4× 多块对比 PyTorch 使用相同全图 SE 均值的一次整图前向。可见 RGB 最大差异 ≤1 灰阶，平均差异 <0.02；不将 alpha=0 的隐藏 RGB 作为可见误差。
- UI 流程：PNG/JPEG/WebP 下载文件重新解码检查尺寸与透明度；1.7× 输出、结果复用、恢复原图、遮罩预览 / 反选、坏图错误、主题持久化、手机抽屉和无横向溢出。要求无未处理 pageerror。
- **生产构建独立 UI 验收**：在 4188 端口直接加载 `dist/`，重复五项 UI 流程，检查懒加载 Worker 与运行时静态资源。
- `npm run build`、`npm audit`：构建 / 类型检查通过，依赖审计 0 漏洞。

完整浏览器过程数据保存在本机忽略目录 `artifacts/`（日志、JSON、UI PNG、失败时 trace）。可复跑测试脚本在 `tests/e2e/`；汇总数据见本目录 JSON。

## 性能样本

生产包、AMD Radeon 880M、显式启用 WebGPU，生成的 480×360 示例图，默认 RealCUGAN 2× / 128 分块，输出 960×720。冷上下文任务约 **3.11 秒**（含本地 HTTP 加载与模型编译）。这是一次样本，未扣除浏览器缓存，不是跨设备速度承诺。

## 范围限制

尚未在实体手机、Safari / Firefox、Windows Edge、独立显卡或尺寸上限的 64M 像素图片上进行验收；不声称所有设备已通过。抠图只验收网络数值、遮罩与输出流程，不把显著主体模型当成发丝级 alpha matting。内存自动降块路径存在，未通过故意耗尽显存来验收。图像效果还应由用户使用真实素材评估。
