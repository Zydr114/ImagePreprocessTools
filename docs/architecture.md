# 可行性调研与实现说明

## 结论与选型

| 功能 | 选型 | 实现取舍 |
| --- | --- | --- |
| 动漫超分 | RealCUGAN v3 conservative，原生 2× / 4× | 网络较小，但 SE 需要全图共享统计，浏览器必须有专门分块实现 |
| 照片超分 | Real-ESRGAN realesr-general-x4v3，4.88 MB | 使用 SRVGG 轻量网络，不采用大型 RRDB 通用模型 |
| 动漫快速超分 | Real-ESRGAN animevideov3，2.50 MB | SRVGG 原生 4×，较少卷积层；效果与 RealCUGAN 不同 |
| 调色 | WebGL 2 + 1024 点 LUT，CPU 参考实现 | 普通图像算法，不需要神经网络；七条曲线按固定次序组合 |
| 抠图 | U2NetP，4.57 MB，320×320 输入 | 显著前景提取，符合 <100 MB；不是 SAM 的点击 / 框选分割，也不是 alpha matting |
| UI | mdui 2.1.5 + Vue 3 | 原生 Web Components，Vite 将 mdui-* 视作自定义元素 |

这些功能在浏览器可实现。耗时受图片面积、网络层数、后端和驱动影响，不能从参数量直接推断实时速度。首版按单图本地处理交付。

## 资料依据

以下为上游实现或官方说明；具体版本和下载 SHA256 另见 `scripts/model-sources.lock.json`。

- [RealCUGAN 原始实现与权重](https://github.com/bilibili/ailab/tree/main/Real-CUGAN)：使用 `upcunet_v3.py`、`updated_weights.zip` 的 conservative 权重，alpha=1。沿用跨块 SE 均值同步的基本方法。
- [Real-ESRGAN 官方模型与推理代码](https://github.com/xinntao/Real-ESRGAN)：通用 v3 和 animevideo v3 为面向轻量推理的 SRVGG 模型。
- [U²-Net 官方项目](https://github.com/xuebinqin/U-2-Net)：提供小型 U2NETP；[rembg U2NetP ONNX 权重](https://github.com/danielgatis/rembg/releases/tag/v0.0.0) 用作浏览器转换来源。
- [ORT WebGPU 官方文档](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)：显式选择 `webgpu` EP；WebGPU 算子覆盖不等于 WASM，必须逐模型验证。
- [ORT Web 部署文档](https://onnxruntime.ai/docs/tutorials/web/deploy.html)：运行时 JavaScript 与 WASM 配套，同源静态文件路径。
- [mdui 安装与按需引入](https://www.mdui.org/en/docs/2/getting-started/installation)、[Vue 集成](https://www.mdui.org/zh-cn/docs/2/frameworks/vue)。
- [ORT WebGL 维护状态跟踪](https://github.com/microsoft/onnxruntime/issues/32241)：本项目保留并固定已验收的 1.30.0 兼容路径，后续升级需要重跑数值矩阵。

## 推理后端

`src/inference/runtime.ts` 根据选择独立懒加载 WebGPU、WebGL 或 WASM 包。模型文件先检查大小与 SHA256，再交给运行时；Cache API 命中也会重新校验。损坏缓存自动删除并重新读取。

WebGPU 使用 `disable_cpu_ep_fallback=1`，不允许缺少 GPU 算子时暗中借用 CPU EP。WebGL 使用 packed 纹理路径；WASM 为单线程，不依赖跨源隔离。WebGL 的模型元数据载入器把符号维度改为数值 0 表示动态维度，不修改权重或运算；同一会话内输入分块形状保持不变。

自动模式只根据可用能力选择后端。选中后端推理失败时显示错误，用户可手动切换；内存错误会先尝试减小同后端分块。

### 转换中的等价适配

1. SRVGG PReLU 展开为 `relu(x) - slope * relu(-x)`，保留原始逐通道斜率。
2. 整数 nearest 上采样替换为固定 one-hot 1×1 Conv + PixelShuffle，避免 WebGL Resize 的模式限制。
3. RealCUGAN 负 Padding 裁剪改为 Slice，保留相同坐标；无穷 Slice 边界缩为等价 int32 哨兵。
4. U2NetP 固定 320 输入下，33 个 ceil MaxPool 的输入边长均为偶数，可以精确关闭 ceil；Resize 改为已知固定比例，清除不需要的 shape 子图。
5. 所有 ONNX 使用 FP32；没有以量化误差换取兼容。

`docs/verification/cpu-models.json` 记录转换与原始 CPU 参考的误差，`models.json` 记录三后端结果。相同形状的一个图能运行，不足以证明整图拼接；浏览器测试另外验证拼接和非整数输出。

## 超分分块与内存

- RealCUGAN 2× halo=18，4× halo=19；分块 core 为 32 / 64 / 128，边界按周期反射填充。最后不足一块的部分也填充至相同形状，输出时裁掉多余部分。
- 前四轮逐块计算全图共享 SE 均值（通道 64 / 128 / 128 / 64），每轮依赖上一轮已完成的均值。第五轮输出像素。不会给每块独立计算 SE 后直接拼接。
- SRVGG 使用 40 像素上下文，保留实际图片边界的零填充语义；锚定相同尺寸的上下文矩形，避免 WebGL 会话动态形状重绑定。photo 网络卷积半径为 34，anime 为 18。
- 只保存一条 tile 高度的输出带，按行流入 Lanczos 3。不会先分配完整原生 4× 大图再缩回请求尺寸。最终输出仍须完整保存在内存中。
- alpha 使用独立插值，Lanczos 阶段预乘 alpha，避免透明区域的隐藏颜色形成边缘光晕。RGB 输出裁到 0～255，图像 alpha 不送入 RGB 模型。
- 非原生倍率的宽高各自四舍五入。原生 2× / 4× 是实际模型倍率；例如 3× 是 4× 推理后重采样。

每次任务创建一个独立 Worker。取消直接 terminate，任务序号使过期结果不能覆盖新图，源像素复制后再 transfer。

## 调色与遮罩

曲线使用保持形状的分段 Hermite 插值，固定 1024 点 LUT。依次应用各 RGB 通道、总 RGB、HSL 调整。色相曲线首尾的值和切线连续；色相 / 明度调整对灰色逐渐减弱。WebGL 预览使用最长 1400 像素缩略图；导出在 Worker 中按 512×512 无邻域瓦片渲染原尺寸，GPU 出错则使用同一算法的 CPU 参考并显示实际后端。

U2NetP 按 rembg 风格进行 320×320 RGB 归一化，输出范围有常量保护。遮罩在 320 分辨率进行形态处理 / 高斯羽化，再双线性映射到原图并乘原 alpha。界面中的像素半径按原图尺寸换算，低分辨率遮罩限制了极细边缘精度。导出不使用黑白“查看遮罩”的预览图。

## 从来源重建模型（可选）

日常运行无需此步骤。推荐 Python 3.12，依赖见 `scripts/requirements-models.txt`；Torch 可使用 CPU wheel。

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r scripts/requirements-models.txt
.venv/bin/python scripts/convert-models.py
.venv/bin/python scripts/create-reference-fixtures.py
npm run dev
# 另一个终端
GPU_TEST=1 CHROMIUM_PATH=/path/to/chrome npm run test:models
```

转换器会按锁文件下载和校验来源，产生模型、manifest、许可证和 `artifacts/models` CPU 张量参考。来源哈希变化会拒绝运行，升级时需人工审查差异。模型保存在 Git 中，下载恢复地址指向当前仓库的原始文件，没有依赖尚未发布的 Release。

## 界面与主题

- 使用 mdui 2 的 Layout、TopAppBar、NavigationRail / NavigationBar、NavigationDrawer、Card、Button / ButtonIcon、Chip、SegmentedButton、Select、TextField、Slider、Switch、Dialog、Snackbar、Progress、Tooltip、Divider。文件选择器为隐藏的原生 file input，曲线与图像画布为业务绘图组件。
- 以 600 px 切换底部导航与侧边导航；1200 px 以下参数使用模态抽屉，以上固定展示。布局使用 8 px 间距体系、16 / 24 px 内容边距、mdui 字号 / 形状 / 色彩角色令牌。保留组件默认的按钮、滑块、输入框尺寸与造型。
- [setColorScheme](https://www.mdui.org/zh-cn/docs/2/functions/setColorScheme) 根据种子色生成完整配色；页面背景、文字、边界、状态和控件统一使用 `--mdui-color-*`，外观通过 `setTheme` 切换。提供 6 个种子色与 `#RRGGBB` 输入，校验后保存到 localStorage；系统模式响应系统明暗变化。图标使用 `@mdui/icons` 本地 SVG 按需打包，无外部字体请求。
- 删除宣传语、英文副标题和装饰性说明；保留字段标签、单位、格式、输出尺寸、进度、错误及许可入口。
- Vue 对自定义元素可能直接赋值 DOM property。mdui Slider 的 `min / max / step` 必须使用数值绑定；静态 `min="-20"` 会成为字符串，导致步进计算中的 `min + steps * step` 拼接字符串。应用层同时约束边缘半径与导出质量的范围。
- mdui 的 `close / closed` 是可冒泡的自定义事件；Dialog / NavigationDrawer 使用 `.self`，避免内部 Tooltip / Select 的关闭事件误关外层面板。对比分割手柄使用 mdui ButtonIcon，并将 slider 角色、名称与数值映射到实际获得焦点的内部按钮。Select / TextField 的标签同样转发至 Shadow DOM 中实际的输入控件。

参考：[Google Material Design 3](https://m3.material.io/)、[mdui 设计令牌](https://www.mdui.org/zh-cn/docs/2/styles/design-tokens)、[NavigationRail](https://www.mdui.org/zh-cn/docs/2/components/navigation-rail)。
