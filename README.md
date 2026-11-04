# LikeBoom

Rust + React 本地互动娱乐桌面宿主。公共服务运行在 Tauri 进程内，不依赖云服务；玩法以可离线安装的 `.lbplug` 插件交付。提供昵称登记与 3D 制作台两个示例，不包含平台采集、支付或会员流程。

```text
apps/desktop/              唯一桌面应用：React 入口、Tauri IPC/窗口适配
crates/play-core/          通用领域约束（队列容量）
crates/play-contracts/     Rust wire 类型与 TypeScript 类型生成
crates/play-runtime/       唯一调度器、持久化、插件校验和权限
packages/plugin-sdk/      传输协议、隔离文档客户端、独立插件打包器
packages/desktop-ui/      通过 transport 注入的公共控制台和展示宿主
plugins/registry/         开源示例：昵称登记
plugins/printer-3d/       开源示例：3D 制作台
compatibility/            退役二维示例源码与旧版本精确包（非活跃子项目）
```

共 8 个工作区包（3 个 Rust 库、2 个 JS 公共包、1 个桌面应用、2 个玩法）；桌面应用的 npm 与 Cargo 清单属于同一个应用。闭源玩法单独建仓，一仓一包，不增加宿主、服务或客户分支。

## 开发

使用 Rust 1.98.0、Node.js 22、pnpm 11。Windows 桌面开发需安装 MSVC C++ 构建工具和 WebView2；Linux 桌面开发需 GTK3、WebKitGTK 4.1、OpenSSL 等开发依赖。纯 Rust 库测试不需要 GUI 环境。

Linux 推荐使用仓库 Devbox 环境。构建环境和原生依赖统一固定在 nixpkgs `8edc0c72e3a38faf5434e40d1f19431125fe4b30`：pkg-config、OpenSSL、D-Bus、GTK3、WebKitGTK 4.1、librsvg 的运行与开发输出均取自同一提交，并由 `devbox.lock` 固定解析结果。只有 Rust、Node 和 pkg-config 不够：`libdbus-sys` 需要 `dbus-1.pc` 及对应头文件/库，后续 Tauri 还需要 GTK/WebKit 的开发文件。

```sh
devbox install
devbox run -- pnpm install --frozen-lockfile
devbox run desktop
```

也可先进入 `devbox shell`，再执行下面的 pnpm/Cargo 命令。普通终端直接执行 `pnpm tauri dev` 不会自动继承项目 Devbox 的依赖路径。不要手工扫描整个 `/nix/store` 或写死临时 `PKG_CONFIG_PATH`，以免混用不同版本的原生库。

如果遇到 `failed to run custom build command for libdbus-sys`，在项目环境中检查并编译：

```sh
devbox run -- pkg-config --modversion dbus-1 gtk+-3.0 webkit2gtk-4.1
devbox run desktop:check
```

如果遇到 `GLIBC_2.44 not found` 等错误，应检查构建工具链与原生依赖是否来自不同 nixpkgs。更新配置后需要退出旧 Devbox shell、停止旧开发进程，再进入新环境。只让编译成功不足以验证运行时，已增加 ELF 动态加载检查：

```sh
devbox install
# 工具链切换后，仅清理桌面宿主制品以强制重新链接
# 不需要删除整个 target 或改系统 glibc
devbox run -- cargo clean -p likeboom
devbox run desktop:verify
devbox run desktop
```

2026-11-04 已通过 `devbox run desktop:verify`：加载器与 libc/libm/libmvec 均来自同一 glibc 2.44 输出。`desktop:verify` 使用二进制自身的 ELF 加载器验证全部动态依赖和符号版本，不使用可能来自旧系统的 ldd。固定 nixpkgs 提交的依据见 [Devbox 官方 flake 配置说明](https://www.jetify.com/docs/devbox/configuration#adding-packages-from-flakes)。

```sh
pnpm install --frozen-lockfile
pnpm build
cargo test
cargo clippy --all-targets -- -D warnings
pnpm test
pnpm tauri dev
```

`pnpm dev` 仅启动前端开发服务，独立浏览器没有 Tauri transport，不能当完整应用使用。`pnpm tauri dev` 自动先打包示例插件，启动控制台后点击“打开展示窗”，选择玩法后手动输入参与信息。

Windows 安装包：`pnpm tauri build`。配置为 NSIS 和离线 WebView2 安装器，构建机首次需要网络获取打包工具/运行时；不能据此视为已完成 Windows 实机验收。其他桌面平台先使用 `pnpm tauri build --no-bundle`，按需配置相应安装格式。

## 插件与验证

- [3D 制作台使用、恢复与待验项目](docs/printer-3d.md)
- [迁移实施记录](report/3d-printer-live功能迁移实施记录.md)
- [插件开发、私有仓库和签名交付](docs/plugin-development.md)
- [重构架构、验证结果和发布验收](docs/refactoring-validation.md)
- [架构设计基线](report/公共服务与玩法插件架构方案.md)

公共仓库自有代码与两个示例采用 [MIT](LICENSE)。闭源插件在独立仓库自行声明许可证；交付包保留 SDK 许可及所用依赖声明。这里的隔离是源码依赖、服务权限与交付边界，分发到客户机器的 JS/素材仍可被提取，不提供源码保密或 DRM 保证。

3D 插件 **1.1.0** 包含独立 React 操作台；旧 1.0.0 需在公共宿主管理中显式切换并启用新版。操作说明见 [3D 制作台](docs/printer-3d.md)，界面和样式随插件交付，公共宿主不导入玩法专属组件。
