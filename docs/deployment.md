# 部署

线上地址：`https://tool.talium.site/ImageProprocessTools/`。URL 中的 `ImageProprocessTools` 按发布要求保留；网站名称为 `ImagePreprocessTools`。

## 准备发布

```bash
bash scripts/deploy.sh
```

脚本要求工作区已提交，使用 `tencent` SSH 别名。它构建带子路径的 `dist-deploy/`，记录提交号、对应源代码地址及 SHA256，再上传到服务器用户目录；不执行 sudo。根路径本地预览的 `dist/` 保留供测试。

构建产物中的 `release.json` 记录此次发布的提交号。网站“设备与模型缓存”中的 AGPL 源代码入口指向同一提交。

## 激活

准备脚本最后会打印一条 `ssh tencent 'sudo -n python3 .../activate.py'` 命令。在服务器上使用免密 sudo 执行这一步以激活发布。

激活脚本会：

1. 校验归档、路由配置和准备时的 Caddyfile 哈希；配置已改变时拒绝覆盖。
2. 解压到 `/var/www/tool.talium.site/ImageProprocessTools/releases/<时间>-<提交>/`。
3. 将当前 Caddy 配置和旧版本指针备份到 `/var/backups/image-preprocess-tools/<发布编号>/`。
4. 为 `tool.talium.site` 增加独立配置导入，校验 Caddy，原子切换 `current`，再 reload。
5. 使用服务器本机 HTTPS 检查 `release.json`；失败时恢复配置和旧指针并 reload。

新路由只匹配 `/ImageProprocessTools` 和 `/ImageProprocessTools/*`。无尾斜杠请求重定向到目录地址。哈希资源使用 immutable 缓存，入口、模型与运行时资源使用 no-cache；不存在的资源返回 404。

## 验收

先检查线上 `release.json` 的提交号，以及首页、Logo、模型清单、模型和 ORT 文件。再执行：

```bash
TEST_BASE_URL=https://tool.talium.site/ImageProprocessTools/ \
  CHROMIUM_PATH=/path/to/chrome GPU_TEST=1 \
  npm run test:browser -- tests/e2e/ui.spec.ts tests/e2e/sliders.spec.ts
```

另外核对工具箱首页、`/MakoLrcStudio/` 与 `/AnimeCharacterGuessr/` 的入口哈希；这些应用的路由与文件不属于本次发布。
