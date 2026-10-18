# 模型数值验收

2026-10-18，本机 AMD Radeon 880M，Chromium 通过 Vulkan/ANGLE 启用硬件 GPU。
`models.json` 保存 13 个导出图 × 3 个显式后端的 39 项结果。
每项使用固定输入，与原始 PyTorch / ONNX CPU 参考输出比对。
所有项 MAE < 1e-4，且 8 bit 输出 MAE < 0.05；WebGPU 禁止 CPU EP 回退。
这是模型图兼容性验收，不代表整张图像拼接、产品交互或所有设备的性能。

重跑：先运行 `scripts/convert-models.py` 生成参考张量，启动开发服务器，
再运行 `CHROMIUM_PATH=/path/to/chrome node scripts/check-models.mjs`。
测试脚本使用 Vulkan 和 unsafe-webgpu 启动参数；普通浏览器仍按实际能力检测。
