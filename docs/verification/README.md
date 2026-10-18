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
- **首版 15 项开发构建浏览器测试**：三个显式后端下的全部超分模型、CUGAN 4×、U2NetP；超分输出尺寸 / alpha；调色 GPU/CPU 差异；取消、缓存损坏恢复和 HTTP 503。
- 拼接检查：SRVGG 多块对比独立整图 ONNX；CUGAN 2× / 4× 多块对比 PyTorch 使用相同全图 SE 均值的一次整图前向。可见 RGB 最大差异 ≤1 灰阶，平均差异 <0.02；不将 alpha=0 的隐藏 RGB 作为可见误差。
- UI 流程：PNG/JPEG/WebP 下载文件重新解码检查尺寸与透明度；1.7× 输出、结果复用、恢复原图、遮罩预览 / 反选、坏图错误、主题持久化、手机抽屉和无横向溢出。要求无未处理 pageerror。
- **首版生产构建独立 UI 验收**：在 4188 端口直接加载 `dist/`，重复五项 UI 流程，检查懒加载 Worker 与运行时静态资源。
- `npm run build`、`npm audit`：构建 / 类型检查通过，依赖审计 0 漏洞。

完整浏览器过程数据保存在本机忽略目录 `artifacts/`（日志、JSON、UI PNG、失败时 trace）。可复跑测试脚本在 `tests/e2e/`；汇总数据见本目录 JSON。

## 性能样本

生产包、AMD Radeon 880M、显式启用 WebGPU，生成的 480×360 示例图，默认 RealCUGAN 2× / 128 分块，输出 960×720。冷上下文任务约 **3.11 秒**（含本地 HTTP 加载与模型编译）。这是一次样本，未扣除浏览器缓存，不是跨设备速度承诺。

## 范围限制

尚未在实体手机、Safari / Firefox、Windows Edge、独立显卡或尺寸上限的 64M 像素图片上进行验收；不声称所有设备已通过。抠图只验收网络数值、遮罩与输出流程，不把显著主体模型当成发丝级 alpha matting。内存自动降块路径存在，未通过故意耗尽显存来验收。图像效果还应由用户使用真实素材评估。

## Material Design 3 重构与滑块修复（2026-10-18）

本次保留处理核心、模型与推理后端。修复边缘滑块的字符串数值边界，重做 mdui 界面，并增加动态主题色。

- `npm test`：12 / 12 核心测试通过。
- `npm run build`：模型文件校验、TypeScript 检查及生产构建通过。
- 开发页面 UI 回归：7 / 7；生产包 `http://127.0.0.1:4188/` 独立 UI 回归：7 / 7。无未处理 pageerror。
- 滑块：点击、跨范围拖动、Home / End、重复点击和切换工具后，边缘值始终在 -20～20，手柄位置在 0～100%，min / max / step 均为 number。
- 实际处理：显式 WebGL 的 1.7× 超分，WASM 抠图、遮罩与反选，调色、PNG / JPEG / WebP 下载后重新解码，检查尺寸与 alpha；结果复用与恢复原图；取消与坏图错误。
- 主题：预设色、自定义色、非法输入拒绝、配色令牌实际变化、深色持久化、刷新恢复种子色、系统模式响应明暗变化。等待预设色 Tooltip 完全关闭，确认不会误关外层主题 Dialog。
- 响应式：320 / 390 / 599 / 600 / 840 / 1199 / 1200 / 1440 px，导航类型正确、页面无横向溢出；390 px 参数抽屉与通道菜单可用。产品明文 DOM 中无原生 button / select / number input，隐藏的 file input 除外。
- 已检查桌面、曲线、抠图、手机参数抽屉、手机深色和主题 Dialog 的 PNG 截图。此次未重跑 39 项模型图矩阵；上方首版模型数值证据仍为原来的验收记录。

复跑命令：

```bash
TEST_BASE_URL=http://127.0.0.1:4188 GPU_TEST=1 CHROMIUM_PATH=/path/to/chrome \
  npm run test:browser -- tests/e2e/ui.spec.ts tests/e2e/sliders.spec.ts
```

本机日志：`artifacts/material-build.log`、`material-unit-tests.log`、`material-ui-tests.log`、`material-production-ui-tests.log`；截图：`artifacts/ui/accepted-*.png`。生产 UI 结果摘要保存为本目录 `material-ui.json`。

## 品牌、许可与线上部署（2026-10-18）

首次发布提交：`05eb94eda818c4a0f167ef5f036d6b1090947d80`。首次发布使用旧拼写路径，现已重定向；当前线上地址为 <https://tool.talium.site/ImagePreprocessTools/>。原始发布数据保留在 `deployment.json`。

- 网站名称为 ImagePreprocessTools，顶部图标和 favicon 均使用 `assets/logo.png`；默认主题种子色为 Logo 橙色 `#FB7916`，保留已有用户主题选择。
- 已精简 README，添加完整 AGPL v3 许可证；线上源代码入口指向本次发布提交。模型各自许可保留。
- 本地生产构建通过，品牌更新后的本地 UI 回归 7 / 7；部署脚本的配置保留与归档校验测试 3 / 3。
- 线上 Chromium UI 回归 7 / 7，无未处理 pageerror；包括实际 WebGL 1.7× 超分、WASM 抠图、曲线与三种格式下载、滑块边界、响应式和主题持久化。
- 线上单独确认默认橙色选中、Logo 与 favicon 地址相同、AGPL 源代码链接与 `release.json` 的提交对应。
- 服务器发布目录全部 37 个文件与本地构建 SHA256 一致；公开入口的 JS / CSS / Logo 字节一致；21 个模型与运行时资源的状态、长度通过检查，WASM MIME 正确。
- 无尾斜杠地址返回 308；不存在的模型、WASM 和页面返回 404。Caddy 配置校验通过，reload 后服务 active。
- 工具箱首页、MakoLrcStudio 和 AnimeCharacterGuessr 入口均返回 200，SHA256 与部署前一致。

发布编号：`20261018T120622Z-05eb94eda818`；服务器回滚备份：`/var/backups/image-preprocess-tools/20261018T120622Z-05eb94eda818/`。

结构化摘要见 [deployment.json](deployment.json)。本机详细日志为 `artifacts/deploy-stage.log`、`deploy-activation.log`、`online-branding-tests.log`；HTTP 与文件校验详情为 `artifacts/deployment-verification.json`、`online-branding-details.json`。此次未重跑模型数值矩阵或扩大实体设备验收范围。

## 链接修正与 README 补充（2026-10-18）

发布提交：`065c8c089980d198044e0c19d2655e84fe41c454`。正确地址为 <https://tool.talium.site/ImagePreprocessTools/>，构建 base、服务器发布目录、激活检查和部署文档均已同步修正。

- 旧拼写的目录地址及其子路径返回 308，子路径查询参数保留；浏览器访问旧地址后到达正确地址。新地址缺少尾斜杠时也返回 308。
- 生产构建通过；部署脚本测试 3 / 3，线上 UI 回归 7 / 7，无未处理 pageerror。未改动处理核心与模型。
- 37 个发布文件与本地构建的 SHA256 全部一致；入口 JS / CSS / Logo 公开访问字节一致；21 个模型及运行时资源状态、大小与 WASM MIME 检查通过，不存在的资源返回 404。
- Caddy 校验与 reload 成功，服务 active；工具箱首页、MakoLrcStudio 和 AnimeCharacterGuessr 入口哈希与本次发布前一致。
- README 添加 Logo、浅色曲线调色和深色 RealCUGAN 超分两张真实操作截图，列明主要运行依赖、模型来源、许可证与开发依赖；15 个本地图片及文档链接均存在，截图已经目视检查。

发布编号：`20261018T122047Z-065c8c089980`；备份：`/var/backups/image-preprocess-tools/20261018T122047Z-065c8c089980/`。源码入口对应本次发布提交。结构化摘要见 [path-correction.json](path-correction.json)，本机详细日志与检查数据为 `artifacts/path-correction-*.log`、`artifacts/path-correction-*.json`。
