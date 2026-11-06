# 项目与开发环境

liveboom 是 Rust + React 的本地互动娱乐桌面宿主。公共服务运行在本机 Tauri 进程中，玩法通过离线 `.lbplug` 包安装；实际画面嵌入工作台，不另开原生展示窗口。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `apps/desktop/` | 唯一 React/Tauri 桌面应用与原生适配 |
| `crates/play-core/` | 通用领域约束 |
| `crates/play-contracts/` | Rust 契约与 TypeScript 类型生成 |
| `crates/play-runtime/` | 调度、持久化、插件验证与权限 |
| `packages/plugin-sdk/` | 协议客户端、React 基础层与打包器 |
| `packages/desktop-ui/` | 公共桌面壳与隔离插件宿主 |
| `plugins/registry/` | 昵称登记开源示例 |
| `plugins/printer-3d/` | 3D 制作台开源示例 |
| `docs/` | 本文档站；通过根命令单独运行 |

定制玩法使用独立私有仓库，不新增客户端分支或专有宿主 import。详见[插件开发指南](plugin-development.md)。

## 开发

工具链为 Rust 1.98.0、Node.js 22、pnpm 11。Windows 需要 MSVC C++ 构建工具和 WebView2；Linux 推荐使用已固定原生依赖的 Devbox 环境。

Linux 在仓库根目录执行：

```sh
devbox install
devbox run -- pnpm install --frozen-lockfile
devbox run desktop
```

已正确配置原生环境时，可使用：

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

只读文档不需要 Rust/GTK/WebKit：`pnpm docs:dev`，访问 <http://127.0.0.1:5174>。`pnpm dev` 是客户端前端服务，独立浏览器没有原生 transport，不能作为完整应用运行。

## 常用检查

```sh
pnpm check
pnpm build
node --test tests/*.test.mjs
devbox run -- cargo test --workspace --exclude liveboom
devbox run desktop:verify
```

`desktop:verify` 检查 Linux 动态链接，不证明所有图形/音频硬件均已验收。目标系统验收范围见[插件测试与交付](plugin-testing-and-release.md)。

## 运行排错

- EGL_BAD_PARAMETER 是 WebKit 图形初始化故障。更新 Devbox 后需退出旧 shell、停止旧客户端，再运行 devbox install 和 devbox run desktop，使同源 Mesa 的 EGL/GBM/DRI 路径生效。
- AT-SPI 辅助功能总线缺失通常不阻止玩法加载；需要屏幕阅读器时修复桌面会话服务。
- Rust toolchain overridden 是项目固定工具链的正常信息。
- 数据路径、备份与开发结构不兼容的处理见[开发数据目录与重置](development-data-reset.md)，不要为插件加载问题直接删库。
- 包信任、插件接口及工作台加载错误见[插件故障排查](plugin-testing-and-release.md#5-常见故障)。

## 范围与许可

当前宿主与 SDK 为 0.2.3，项目尚未上线，不提供旧协议/旧开发数据兼容。提供两个 MIT 开源玩法示例，其他玩法可以闭源交付并保留所使用的版权与许可。分发的 JS/素材可被提取，签名不是 DRM。

当前不提供平台抓包、支付或会员流程。插件服务是本地受限 SDK，不是需要部署的 HTTP API；本地文档站不涉及云端发布。
