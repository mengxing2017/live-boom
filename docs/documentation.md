# 文档站使用与维护

本站使用 VitePress，提供侧栏、页内目录、代码高亮、本地全文搜索和 Mermaid 架构图。直接使用本项目的 `docs/*.md`，不维护另一份接口正文。

## 启动查看

在 **live-boom 仓库根目录**执行，环境为 Node.js 22、pnpm 11：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

浏览器访问 <http://127.0.0.1:5174>。`pnpm docs` 为同一启动命令的快捷入口；Linux 也可执行 `devbox run docs`。修改 Markdown 后自动更新，Ctrl+C 退出。文档站不启动 Tauri、数据库或玩法渲染器，不占用客户端前端的 5173 端口。

默认仅监听本机，端口占用时直接报错，不会静默选择其他端口。需要另选端口时显式覆盖：

```sh
pnpm docs:dev --port 5175
```

只有确实需要局域网访问时才显式指定 `--host 0.0.0.0`；正常开发保持默认本机监听。

## 构建与本机预览

```sh
pnpm docs:build
pnpm docs:preview
```

预览地址 <http://127.0.0.1:4174>，静态产物为 `docs/.vitepress/dist/`。preview 预览上一次构建产物，修改内容后需重新 build；日常编辑使用 docs:dev。

构建保留内部死链检查，失败时应修复引用，不全局关闭检查。站点默认部署于域名根路径，如需子路径托管应设置配置的 base 并重新构建。当前只提供本地启动和静态构建，不自动发布外网。

文档依赖统一放在根 package.json 和 pnpm-lock.yaml，不为 docs 建立第二套锁文件或业务子项目。Vue/VitePress 只用于文档工具，不进入 Rust/React 桌面应用或插件运行包。依赖升级后提交统一锁文件。

## 文档组织

| 路径 | 内容 |
| --- | --- |
| `docs/index.md` | 文档首页与阅读路线 |
| `docs/project-overview.md` | 项目边界、客户端运行与环境入口 |
| `docs/plugin-development.md` | 架构、React 最小玩法、专用工作台 |
| `docs/plugin-api-reference.md` | Manifest、Schema、服务接口、命令及限额 |
| `docs/plugin-testing-and-release.md` | 测试、签名、版本和交付 |
| `docs/printer-3d.md` | 3D 示例使用与验收 |
| `docs/development-data-reset.md` | 开发数据定位与备份 |
| `docs/refactoring-validation.md` | 基础架构与验证历史 |
| `docs/.vitepress/config.ts` | 导航、侧栏、搜索、Mermaid 与链接转换 |

新增页面时同步首页入口和侧栏。站内链接优先使用相对 `.md` 路径，并保留稳定标题供锚点引用。代码示例使用语言标记的围栏，架构图使用 mermaid 围栏。

## 源码、报告与离线阅读

站内指南、接口正文和本地搜索随静态产物提供，不依赖外部搜索服务。文档中 `../README.md` 的站点链接会指向项目概览；其他指向仓库源码和第三方许可的相对链接由配置转换为 GitHub main 分支页面，查看这些源码引用需要网络及仓库权限。Markdown 原文的相对引用保持可供仓库阅读。

文档必须自包含，禁止引用规划报告目录中的文件，也不能通过外部 URL、正文路径或构建复制绕过这一边界。必要背景、接口、结论和验证依据应整理到本站页面，功能与接口以当前文档和实际代码为准。保持站点内部链接检查开启。

不属于本项目的文档只能通过链接引用，不得复制正文、摘录、翻译搬入或通过 include、嵌入、构建读取与下载等方式引入，也不得加入本站搜索索引或静态产物。本站正文只编写本项目自身的接口、配置、操作和验证说明。

不要把私钥、凭据、客户昵称/照片或私有玩法源码放入 docs。`docs/.vitepress/cache/` 与 `docs/.vitepress/dist/` 是生成物，不提交到源码仓库。

## 验证范围

站点构建、页面访问、导航、搜索和图表验证只验证文档工具链，不替代插件/客户端业务测试。插件示例的独立构建与签名核验记录见[测试与交付](plugin-testing-and-release.md)。

实现和命令约定参考 [VitePress 官方入门](https://vitepress.dev/guide/getting-started) 与 [Mermaid 插件说明](https://github.com/emersonbottero/vitepress-plugin-mermaid)。

2026-11-06 已通过静态构建与内部死链检查、开发/预览页面 HTTP 访问、本地搜索索引的接口词检索，以及原有 TypeScript/依赖边界检查。当前验证环境无可用交互浏览器，搜索弹窗、响应式外观和 Mermaid 实际绘制仍需浏览器验收；服务返回正常不代表这些交互已验证。
