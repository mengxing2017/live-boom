# 插件测试、签名与交付

适用宿主 / SDK **0.2.3**。先完成[开发指南](plugin-development.md)的插件构建，再按本文在真实宿主中安装和验收。接口参数见 [API 参考](plugin-api-reference.md)。

## 1. 本地开发闭环

### 1.1 构建宿主与插件

公共 live-boom 仓库根目录：

```sh
pnpm install --frozen-lockfile
pnpm build
```

Linux 使用 README 的 Devbox 环境：

```sh
devbox install
devbox run desktop
```

Windows 需具备 MSVC、WebView2 和 Rust 工具链，在公共仓库执行 `pnpm tauri dev`。纯插件前端开发无需安装 Rust，但最终必须在真实 Tauri 宿主和目标系统 WebView 中验收。

插件私有仓库根目录：

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 是否同时签名取决于自己的构建脚本；开发指南示例读取 `LIVEBOOM_SIGNING_KEY`。不要把环境变量名当作宿主自动签名功能，签名在 Node 打包脚本中发生。

### 1.2 临时未签名开发模式

只有 **debug 构建**且原生宿主启动时显式带 `LIVEBOOM_ALLOW_UNSIGNED=1`，才允许导入未签名外部包。项目根目录运行：

```sh
LIVEBOOM_ALLOW_UNSIGNED=1 devbox run desktop
```

PowerShell 等价示例：

```powershell
$env:LIVEBOOM_ALLOW_UNSIGNED = '1'
pnpm tauri dev
```

不要为外部包添加内置摘要信任、改宿主校验器或将开发开关写入客户发布配置。发布模式始终拒绝未签名外部包。即使 debug 模式允许未签名，包完整性、Schema、能力、文件路径等校验依然生效。

### 1.3 导入与启用

1. 启动宿主，打开左侧“玩法”。
2. 在“离线导入插件”填写本机 `.lbplug` **绝对路径**，点击“校验并导入”并确认。导入仅安装，不自动启用。
3. 从已安装插件选择目标版本，填写合法配置，点击“启用玩法”；也可使用顶部选择框就地切换。顶部选择按 Schema defaults 初始化配置，复杂玩法请在管理页明确配置。
4. 回到工作台，等待“玩法已就绪”，提交合法输入，检查实际画面、队列和历史。
5. 修改插件后递增版本、重新构建并导入；清空运行/等待任务后选择新版本。

顶层公共壳选择和管理插件，插件自己的操作台不具备启用、安装或发布者信任权限。选择框展开不应导航；用户明确切换后工作台才加载选中的插件。

普通浏览器打开 `pnpm dev` 不具备 Tauri transport，不能当完整宿主使用。直接用 file:// 打开插件 HTML 也不会收到握手。不能因为独立网页“看起来正常”就判断已通过沙箱和原生协议测试。

### 1.4 调试隔离数据

不要用删库作为日常调试方式。需要测试首次启动、故障恢复时，在启动原生进程**之前**使用独立数据目录。Linux 例子：

```sh
XDG_DATA_HOME=/tmp/liveboom-plugin-dev LIVEBOOM_ALLOW_UNSIGNED=1 devbox run desktop
```

对应应用数据为 `/tmp/liveboom-plugin-dev/com.liveboom.desktop/`。宿主对同一数据目录有单实例锁；旧进程未关闭时，新进程可能被拒绝。调试目录也可能含个人信息，保留和清理由开发者确认后处理。

系统默认路径、Windows/macOS 定位与备份见[开发数据文档](development-data-reset.md)。不要让插件自行寻找和操作这些目录，也不要提供自动删除真实客户数据的脚本。

## 2. 测试分层

### 2.1 私有玩法自身测试

先测试纯 domain 模块，再测试页面和宿主集成。建议覆盖：

| 层次 | 必测行为 |
| --- | --- |
| 规则与计划 | 边界输入、规则关闭、数量/倍数、随机结果冻结、计划可序列化且通过 Schema |
| 生命周期 | 暂停剩余时间、继续、销毁取消、异常、迟到回调、只完成一次 |
| 多份任务 | 顺序确认、重复回执、部分完成后重试不重复制作 |
| 操作台 | 必填校验、重复点击、command_id 重试、错误提示、草稿保留 |
| 资源 | assets 解析、媒体导入、无权限拒绝、声音首次解锁、本地语音缺失时的降级 |
| 布局 | 最大化、缩放、窄窗、不同 DPR/密度、抽屉和 Modal 遮挡、恢复默认布局 |
| 性能 | 空闲 GPU、隐藏时继续逻辑但不绘制、长时运行的内存/计时器/GPU 资源回收 |

相同输入和冻结计划应能解释同一任务结果。不要用视觉截图或音频播放成功替代 Rust 的任务结果与进度断言。

### 2.2 公共仓库检查命令

下面命令均在公共仓库根目录运行：

```sh
pnpm check
pnpm build
node --test tests/*.test.mjs
devbox run -- cargo test --workspace --exclude liveboom
devbox run -- cargo test -p liveboom --lib plugin_protocol
devbox run desktop:verify
```

`pnpm check` 包含 TypeScript 检查与公共依赖边界检查；Node 测试覆盖 SDK、打包、现有示例。Rust 库测试覆盖包验证、队列、身份、冻结计划和持久化；原生协议测试覆盖编码入口路径。`desktop:verify` 检查构建和 Linux ELF 动态库，不验证实际 GPU 绘制，也不替代窗口启动验收。

真实 Chromium 集成测试使用 CDP，需要显式提供本机 Chromium 路径：

```sh
CHROMIUM_BIN=/absolute/path/to/chromium pnpm test:browser
CHROMIUM_BIN=/absolute/path/to/chromium pnpm test:printer
```

现有 `tests/printer-browser.mjs` 支持聚焦示例：

```sh
CHROMIUM_BIN=/absolute/path/to/chromium LIVEBOOM_CONTROL_ONLY=1 LIVEBOOM_REGISTRY_ONLY=1 node tests/printer-browser.mjs
CHROMIUM_BIN=/absolute/path/to/chromium LIVEBOOM_CONTROL_ONLY=1 LIVEBOOM_RECOVERY_ONLY=1 node tests/printer-browser.mjs
```

这些是仓库示例测试，不会自动发现或验证任意私有玩法。私有项目应建立自己的 fixture、规则断言与生命周期测试。浏览器测试通过也不能证明 WebKitGTK/WebView2 的原生 URI、图形驱动和音频行为正常。

### 2.3 原生目标系统验收

至少在支持的每个操作系统和 WebView 版本完成一次真实客户端验证：从校验安装开始，到工作台加载、提交、暂停/继续、完成、历史和重启恢复。对 Three.js 类玩法实际观察场景与帧率；握手成功只是“协议就绪”，不等于 WebGL 已正确绘制。

测试非当前摘要文档拒绝、缺权限拒绝、篡改包拒绝；不要通过加入 allow-same-origin、allow-forms、任意 connect-src 或 native 桥来修复兼容问题。若需要新增公共能力，先修改公共契约、授权和测试，再发布新 SDK/宿主版本；私有玩法不能自增权限字符串获得能力。

## 3. 包格式与签名

本文档示例于 2026-11-06 从 Markdown 提取到独立临时目录，以实际 SDK 0.2.3 tarball 安装依赖，完成普通 React 渲染文档、专用 React 工作台、自包含 HTML 构建和 Ed25519 签名核验；同时检查逐文件完整性与未携带源码文件、私钥和 source map。该核验不等于已完成示例的全部原生平台运行验收，交付仍须执行上一节的目标系统测试。

### 3.1 `.lbplug` 归档

归档是 UTF-8 JSON，不是 ZIP，也不是可执行动态库：

```json
{
  "format": "liveboom.plugin.v1",
  "files": { "manifest.json": "base64字节", "web/index.html": "base64字节" },
  "integrity": { "manifest.json": "sha256小写十六进制", "web/index.html": "sha256小写十六进制" },
  "signature": { "publisher": "customer-studio", "value": "base64的Ed25519签名" }
}
```

上例仅示意结构，哈希和文件内容不是可安装数据。未签名包的 signature 为 null。归档顶层和 signature 未知字段、files/integrity 重复路径、摘要缺失、不安全路径、文件损坏等会被拒绝。

签名对象是按路径 ASCII 顺序排序、无空白 JSON 序列化的 integrity 对象 UTF-8 字节。Ed25519 签名覆盖文件清单，间接覆盖 Manifest、HTML、Schema、素材与许可；修改任何文件都必须重新打包签名。整个归档字节的 SHA-256 是包 digest，与发布者公钥指纹不同。

打包器只收集 Manifest、引用 Schema/examples、渲染/控制 HTML、assets、THIRD_PARTY_NOTICES、SDK MIT 文件。它不会自动收集其他 src 文件。assets 中的符号链接、`.map`、`.pem`、`.key` 会拒绝；不要把其他后缀的敏感文件放在 assets 后期待打包器识别。提交前仍要审查实际归档清单。

### 3.2 创建发布者密钥

在**仓库之外**已有的安全目录生成 Ed25519 PKCS#8 PEM 私钥：

```sh
openssl genpkey -algorithm ED25519 -out /secure/customer-studio-ed25519.pem
```

私钥只交给受限 CI/发布人员，不随插件、日志、tarball、assets 或 Git 提交。不得用 `.publisher.json` 代替私钥，也不得使用 RSA/ECDSA 私钥调用当前签名器。

### 3.3 签名构建

使用开发指南的 build.mjs：

```sh
LIVEBOOM_SIGNING_KEY=/secure/customer-studio-ed25519.pem pnpm build
```

也可以先生成全部 HTML，再单独调用 SDK CLI：

```sh
pnpm exec liveboom-plugin . dist/plugin.lbplug /secure/customer-studio-ed25519.pem
```

输出：

- `dist/plugin.lbplug`：完整归档。
- `dist/plugin.lbplug.publisher.json`：`{publisher,publicKey}`；publicKey 为 **32 字节原始 Ed25519 公钥的 base64**，不是 PEM 或 SPKI DER。
- 控制台 `{path,digest}`：整个包的 SHA-256，记录到发布清单。

计算客户核对的公钥指纹（SHA-256 原始 32 字节公钥）：

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const p=JSON.parse(readFileSync("dist/plugin.lbplug.publisher.json","utf8")); console.log(p.publisher,createHash("sha256").update(Buffer.from(p.publicKey,"base64")).digest("hex"));'
```

公钥指纹应通过独立可信渠道核对。插件包、同目录的公钥文件和同一条下载信息并不能独立证明发布者身份。

## 4. 客户安装、更新与回退

### 4.1 正式安装

1. 从可信渠道取得 lbplug、发布者 ID、公钥、指纹、包摘要、支持宿主范围及交付说明。
2. 在公共“玩法”页的“信任插件发布者”填写 publisher 和 base64 公钥，核对宿主显示的指纹后保存。
3. 填写本机包路径，校验并导入。宿主会验证签名、摘要、Schema、权限和能力。
4. 在无当前任务和无等待队列时选择并启用目标版本，确认工作台就绪。
5. 执行交付方提供的最小手动输入，检查结果与历史。

正式模式拒绝未签名包；仅编译携带的示例以精确包摘要信任。更改示例后旧摘要可能失去信任，不能将此规则用于绕过客户包签名。

### 4.2 版本与数据策略

| 标识 | 决定什么 | 升级约定 |
| --- | --- | --- |
| Manifest id | 玩法身份 | 稳定，不与其他发布者复用 |
| Manifest version | 发行内容 | 每次内容变化递增，包含 HTML、素材和许可变化 |
| sdkApi | MessagePort 协议主版本 | 当前固定字符串 1 |
| hostVersion | 可运行宿主范围 | 使用实际验收范围，不盲目放宽 |
| stateSchemaVersion | 业务状态格式 | 结构变化时递增，并明确映射方案 |
| 包 digest | 安装与任务精确引用 | 自动计算，不能手改文件后保留旧值 |

新版本并排安装，任务与历史保留精确版本和摘要。当前/等待队列非空时禁止切换。configure 只更新新任务设置；presentation 可即时改变画面。不要让新版操作台直接改旧任务计划。

升级顺序：备份 → 停止接收并完成/明确处理现有任务 → 导入新包 → 必要时显式复制/迁移状态 → 启用新版本 → 检查配置和自有媒体 → 小样本验收。不要自动清空客户任务、历史或配置。

### 4.3 状态复制和迁移

这是公共壳“玩法管理”的受信任操作，不是插件 request 服务：

| 情形 | 公共功能 | 约束 |
| --- | --- | --- |
| 相同 stateSchemaVersion | “复制兼容版本的状态” | 同 publisher/id、不同摘要、队列空、目标命名空间空；来源保留 |
| 不同 stateSchemaVersion | “跨 schema 数据迁移” | 同 publisher/id、目标为空、显式键映射/默认值，最多 100 键；不执行任意脚本 |

迁移 JSON 的 mapping 方向为“来源键 → 目标键”，defaults 是目标缺省键值，例如：

```json
{
  "mapping": { "old-count": "count" },
  "defaults": { "theme": "default" }
}
```

映射只改键名，不做值变换；迁移后目标插件仍负责解释状态。单项 64 KiB、总量 1 MiB，源数据和迁移审计保留。发布前用真实旧数据样本验证，不承诺旧 SDK/协议包一定可运行。

业务状态和偏好按 ID/版本/stateSchemaVersion 分隔；媒体按摘要分隔；布局按 publisher/id/布局协议版本分隔。状态迁移不等于配置、媒体或任务历史自动迁移。需要更新媒体引用的玩法，应先设计明确的数据重新导入和绑定流程。

### 4.4 回退与卸载

回退是显式启用仍通过当前宿主验证的旧包。旧版本自身命名空间仍保留，新版写入不会自动反向同步。重试旧任务要求启用其相同摘要的包；如果当前宿主协议或信任策略已不接受该包，需要作者重新交付支持版本，不能跳过校验。

被活动玩法、当前任务、等待任务或历史引用的包不能卸载。先按业务需要停用和处理引用；清历史是明确的有损操作，不是默认升级步骤。卸载包不会自动删除业务命名空间。媒体也只能在不被任务、回执或状态引用时删除。

## 5. 常见故障

| 现象 / 错误 | 检查及处理 |
| --- | --- |
| 工作台“当前玩法包不可用” | 保存的活动摘要当前未通过校验；在顶部重新选择已验证版本。检查诊断、重新导入正确签名包，不删库恢复信任 |
| “非当前插件” / FORBIDDEN | 确认已启用正确摘要并重启匹配构建；使用 SDK，不自行拼 URI。当前宿主已处理 `/control` 与 `%2Fcontrol` 路由 |
| Plugin loading / 插件加载超时 | 握手监听是否及时安装、HTML 是否完整离线、是否抛脚本异常、CSP 是否阻止相对模块 |
| INCOMPATIBLE_API / INCOMPATIBLE_CAPABILITY | sdkApi、hostVersion、能力和当前宿主不匹配；对照 API 参考，不加白名单绕过 |
| INVALID_MANIFEST / INVALID_PERMISSION | 入口与能力配套声明、路径、必需权限和工作量字段是否正确 |
| VALIDATION_FAILED / INVALID_SCHEMA | 未声明字段、错误类型、缺必填、控制字符、超界或不支持的 Schema 关键字；default 不会自动补值 |
| UNSIGNED_PLUGIN | 正式包需要签名；开发模式需 debug + 原生进程启动前设置开关 |
| UNTRUSTED_PUBLISHER / INVALID_SIGNATURE | 发布者和公钥是否匹配、是否经过指纹核对、包是否被修改 |
| INTEGRITY_FAILED / VERSION_CONFLICT | 不修改已安装文件；新内容递增版本重新打包，确认交付摘要 |
| BUSY / QUEUE_FULL | 当前/等待任务阻止切换，或剩余工作量达到 100；等待完成或由用户明确处理 |
| STALE_TASK / STALE_INSTANCE | 保存了旧 services/回调或渲染已重载；取消过期任务，不能把旧身份替换为新身份重发 |
| INVALID_UNIT / 任务不能完成 | 单元顺序、units 长度、completedUnits 和完成回执顺序是否正确 |
| 无画面但已握手 | RenderSurface 容器高度/遮挡、WebGL 初始化、DPR、浏览器控制台与原生图形日志；握手不证明实际绘制成功 |
| 不出声 | 工作台首次点击启用声音，检查 audio 能力、包内路径和本地语音；不绕过用户激活要求 |
| PNG 未保存 | 先 exportPng，再 export.review，最后用户在宿主可信预览点击保存；检查尺寸/大小上限 |
| 媒体升级后不存在 | media 按摘要隔离，不会由状态复制自动搬迁；重新导入并绑定有效引用 |
| EGL_BAD_PARAMETER / 图形进程 Aborting | Linux 按 README 更新 Devbox/Mesa 驱动路径并退出旧 shell；这是崩溃，不能按普通警告忽略 |
| AT-SPI org.a11y.Bus 缺失 | 桌面辅助功能总线告警，与包路由无关；需要辅助功能时修复会话服务 |
| Rust toolchain overridden 提示 | rust-toolchain.toml 固定工具链的正常 info，不是构建失败 |
| ERR_PNPM_IGNORED_BUILDS | 独立插件仓库按开发指南提供 pnpm-workspace.yaml 的 allowBuilds.esbuild；不要全局放开所有安装脚本 |

诊断时记录宿主版本、SDK 版本、插件 id/version/digest、OS/WebView、原生错误和复现输入。日志不记录私钥、整张客户图片或无需收集的昵称。提交最小复现包前去除客户专有素材与个人信息。

## 6. 闭源仓库与许可交付

公共宿主、SDK 和示例自有代码为 MIT；玩法可在独立私有仓库声明自己的专有许可。每个定制玩法随包提供自己的 React 界面和规则，不能把专有规则或客户素材放进公共壳。

改编示例时保留原作者的完整 MIT 版权/许可，继承的 `3d-printer-live` 相关代码与素材按现有 [3D 示例第三方声明](../plugins/printer-3d/THIRD_PARTY_NOTICES) 和上游许可逐项核对。不要因为公共项目使用 MIT 就推断所有第三方模型、字体、音效和图片都可任意闭源再分发。

打包器自动写入 `LICENSE-liveboom-SDK`，并携带 THIRD_PARTY_NOTICES。插件仓库自己的 LICENSE 文件**不会自动加入归档**；应把自有交付许可文本放入 THIRD_PARTY_NOTICES，或另行随正式交付文件提供。缺失 THIRD_PARTY_NOTICES 时打包器生成的占位说明不是完整许可审查，也不适用于实际打入 React 等依赖的复杂插件。

建议利用 bundler metafile 收集两个入口实际包含的依赖，包含其完整版权与许可文本；素材另列作者、来源、授权和修改说明。公共仓库 [许可收集工具](../tools/plugin-pack/notices.mjs) 可作实现参考，但不属于 SDK 已发布 API。

JS 压缩、私有 Git 仓库和签名不提供客户机器上的内容加密；`.lbplug` 可提取 JS 和素材。签名保障来源与完整性，开闭源隔离保障源码仓库和依赖边界，不能将其宣传为 DRM 或不可逆保密。

## 7. 交付清单

- [ ] 使用锁定 SDK/tarball 与依赖锁文件，CI 以 frozen-lockfile 安装。
- [ ] 内容变化已递增插件版本，Manifest 宿主范围与能力经过实际验收。
- [ ] 构建并签名同一份产物；记录 package digest、公钥指纹及构建来源提交。
- [ ] 核查包清单，不含私钥、凭证、源码映射和无授权素材。
- [ ] 交付完整许可、使用说明、配置示例、安装/升级/回退步骤和状态迁移说明。
- [ ] 通过任务、暂停、取消、重试、多份进度、隐藏/恢复和工作台布局测试。
- [ ] 在目标系统实际安装验证 CSP、原生协议、WebGL、音频和 PNG 保存。
- [ ] 说明已知限制及支持范围，不把测试浏览器结果等同于所有原生平台验收。
- [ ] 客户可离线安装；运行不依赖私有仓库、CDN、签名服务器或开发机路径。
- [ ] 宿主未为该客户新增专用分支、专有 import 或越权接口。
