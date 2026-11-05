# 独立玩法插件开发

## 仓库与构建

闭源玩法只依赖固定版本的公共 SDK，不依赖桌面宿主源码。当前 SDK 尚未发布到 npm，可以先在公共仓库执行 `pnpm --filter @liveboom/plugin-sdk pack --pack-destination /tmp/liveboom-sdk`，将生成的 tarball 作为固定版本依赖安装到私有仓库；正式发布后使用确定版本的包，不使用浮动 workspace 路径或复制宿主工程。

```text
customer-play/
  package.json                  依赖 SDK，声明自身专有许可证
  manifest.json
  schemas/input.json
  schemas/config.json
  src/index.js                  简单玩法的入口
  assets/                       仅发布所需素材
  THIRD_PARTY_NOTICES
```

可以参考 `plugins/registry`，复制后更换 ID、名称、发布者和版本。每次发布同 ID/版本内容必须一致，内容变化要递增版本。示例 manifest 的 `sdkApi: "1"` 与宿主 `0.2.x` 配套。

```json
{
  "name": "customer-play",
  "private": true,
  "type": "module",
  "license": "UNLICENSED",
  "dependencies": { "@liveboom/plugin-sdk": "file:vendor/liveboom-plugin-sdk-0.2.1.tgz" },
  "scripts": { "build": "liveboom-plugin . dist/customer.lbplug" }
}
```

简单入口由打包器注入 `liveboom.connect(factory)`，无需 import；源码示例：

```js
liveboom.connect(services => {
  let timer;
  return {
    prepare(input) { return input; },
    play(input) {
      document.getElementById('stage').textContent = input.nickname;
      timer = setTimeout(() => services.result('completed'), 2000);
    },
    dispose() { clearTimeout(timer); }
  };
});
```

这段最小示例只说明协议；实际需实现 `pause/resume`，计时使用剩余时长，销毁不提交结果。完整实现见两个示例插件。每次任务 factory 的 services 固定绑定该任务和播放代次，旧异步回调不会获得新任务身份。不要保存 services 用于其他任务。

复杂玩法可自行用 React/Canvas/Three.js 构建自包含 HTML，放到 manifest.entry，显式引入并打包 `@liveboom/plugin-sdk/client` 的 `connectPlugin`。不能依赖宿主的 React、网络 CDN、同源文件或全局 Tauri。首期 HTML 中 JS/CSS 内联，素材使用 data URI，或声明 `assets.own` 后请求 `services.request('assets.resolve', {path:'assets/logo.png'})` 获取受限 data URI；不支持相对路径的多文件模块加载、Worker 或 WASM 权限。

## 包格式与输入协议

当前 `.lbplug` 是 UTF-8 JSON 归档，不是 ZIP：顶层为 `format: "liveboom.plugin.v1"`、`files`（安全相对路径 → base64 字节）、`integrity`（同路径 → SHA-256）、`signature`。签名数据为 ASCII 路径排序后、无空白序列化的 integrity 对象；Ed25519 对其字节签名。签名间接覆盖 manifest 和所有文件。未知字段、重复路径、路径穿越、缺失或损坏文件会拒绝安装。

打包器仅收集 manifest、schema、入口、assets 与许可声明，不收集源码目录、私钥、默认 source map。assets 下的 `.map/.pem/.key` 和符号链接拒绝打包。密钥必须保存在私有 CI secrets 或仓库外。JS 可读性压缩不构成加密。

`inputSchema/configSchema` 使用首期受限 schema 方言，**不是完整 JSON Schema**：支持 object/string/integer/number/boolean/array、properties/required/additionalProperties:false、title/description/default、enum、minLength/maxLength、minimum/maximum。每层至多 32 字段；数组必须声明 items/maxItems（最多 100 项），可声明 minItems；不支持 $ref、pattern、oneOf 等，未知关键字拒绝安装。文本按 Unicode 字素簇计数；宿主拒绝控制字符、类型错误和未声明字段。单次输入/配置至多 64 KiB。根输入和配置应是对象，公共 UI 自动生成相应字段。

未声明 plan.v1 时，prepare 返回经过同一 inputSchema 验证的规整输入；声明 plan.v1/planSchema 后返回独立冻结计划。两种路径均由 Rust 校验、存储后再发 play。重试已准备的任务复用冻结输入，不重新随机生成计划。宿主统一处理 task_id、epoch、instance、队列、容量、幂等、来源标识和结果；插件不声明自己的可信来源。

必需权限为 `task.current.read/task.result.report`，可选 `storage.own/assets.own`，不支持网络、文件系统、系统进程或任意 SQL。进度目前预留消息，不进入权威任务状态。

## 签名与交付

在仓库外生成 Ed25519 PKCS#8 PEM 私钥，例如 `openssl genpkey -algorithm ED25519 -out /secure/publisher.pem`。构建签名包：

```sh
pnpm exec liveboom-plugin . dist/customer.lbplug /secure/publisher.pem
```

同时生成 `.publisher.json`，仅含发布者与公钥。交付插件、公钥、SHA-256 指纹和依赖声明；通过独立渠道核对指纹。客户在控制台保存发布者公钥，填写本机 `.lbplug` 路径导入，再选择插件启用。宿主不访问私有源码仓库，也不需要重编译。

正式宿主拒绝未签名外部包。只有 debug 构建且显式设置 `LIVEBOOM_ALLOW_UNSIGNED=1` 才允许开发未签名包。随宿主编译携带的示例仅以精确摘要信任，并走相同安装、展示和 RPC 路径。

插件包上限 200 MiB、2000 文件，资源解析单项至多 10 MiB；storage.get/set 仅访问当前任务所属玩法/版本/schema 的命名空间，单项 64 KiB、每命名空间 1 MiB。

## 版本、回退与卸载

新版本并排安装，队列与历史固定记录完整插件版本和摘要。切换玩法/版本要求当前和待执行队列为空；configure 只更新新任务规则，不重写已接收任务。presentation 独立即时更新。仅可切换满足当前协议且已验证的版本，不保证历史协议包可用。相同 stateSchemaVersion 可通过控制台显式复制到空目标版本；禁止覆盖和跨玩法复制。跨 schema 支持显式键映射与默认值：同发布者、同玩法、空目标、单项 64 KiB/总计 1 MiB，最多 100 键；来源完整保留并记录迁移审计。复杂值变换由插件作者先生成并审查迁移数据，不在宿主执行任意脚本。

被启用、当前/待执行/历史任务引用的版本拒绝卸载。停用并清空历史/开始新场后可卸载；卸载包保留命名空间数据，没有自动删除客户数据的操作。

故障时失败、中断与完成分别记录。渲染实例丢失或应用重启不会自动重播运行中任务，需要用户明确重试；应用重启后待执行队列也先暂停，玩法画面就绪后手动继续。宿主当前只允许一个实例打开同一数据目录。


## 0.2.1 可选扩展

3D 示例见 `plugins/printer-3d`。新增能力的插件声明最低 `hostVersion: ">=0.2.1 <0.3.0"`，基础 `sdkApi: "1"` 保留。签名 manifest 的 `capabilities` 只接受：

| 能力 | 使用方式 |
| --- | --- |
| session.v1 | `connectPlugin(factory,{session: async (services,config)=>sessionLifecycle})`；session 一次创建，任务 factory 仍每任务创建；task dispose 不销毁 session |
| plan.v1 | 声明 planSchema；prepare 返回 `{units:[...], ...}`；units 长度必须等于宿主预留工作量。play 第三个参数含 plan/completedUnits/source；逐份 `request('units.complete',{index})`，全部完成才 result |
| presentation.v1 | 声明 presentationSchema；会话 `presentation(value)` 接收完整显示设置；`configure(config)` 接收新业务配置，仅用于显示当前规则，任务仍使用自己的 config |
| preferences.own.v1 | session `request('preferences.get'/'preferences.set',{key,value?})`；绑定真实输出实例和当前插件版本，空闲可用；不伪造 task |
| media.own.v1 | session `request('media.resolve',{reference})` 获取宿主导入且属于本插件的图片 data URI |
| audio.own.v1 | task `audio.play`（自身包 path、volume、loop）、audio.stop、speech.say（text/lang/id/rate/volume/voice）；声音由可信输出顶层唯一播放，需用户在该窗口解锁，只选本地语音 |
| preview.frames.v1 | session `frame(JPEG Blob)`，640×360、256 KiB、最多 5 FPS；独立二进制消息，不提升普通 RPC 限额。`metrics({...})` 至多 4 KiB、宿主最多每秒发布一次 |
| export.png.v1 | session `exportPng(ArrayBuffer)`，PNG 最大 2 MiB、2048×2048；转到控制台预览，用户确认后原生保存对话框选址 |

可选 manifest `workUnitsField` 指定输入中的 1–100 有界整数字段；同时声明 `workUnitsSelectorField/workUnitsRulesField` 时，宿主按输入选择器索引配置规则表，规则字段为 enabled 和 units（1–10），工作量为输入数量乘规则 units。宿主只认识通用表结构，不内置事件/礼物名称。缺省工作量为 1。普通优先任务仅调整等待队列顺序。

可选 `examples` 指向 `{name,input}[]` JSON，最多 12 项，每项经 inputSchema 校验；模板只填表，不自动提交，也不能设置可信来源。打包器会携带该文件及扩展 schema。

session 生命周期可实现 `presentation/configure/visibility/control/dispose`；公共镜头代理通过受限 control 消息传递，不转移任务执行权。资源应由插件自己的 bundler 打入 IIFE，素材走 assets.resolve，不使用相对网络 fetch。像素、音效、规则图和指标均不是完成凭证。

项目未上线，仅维护当前协议，不提供历史插件信任名单或旧数据补全。无专用操作台的插件仍可使用通用表单；专用操作台统一采用视口协议。改编 MIT 代码的闭源交付仍须携带相应完整许可。

## 可选独立控制文档

插件可声明 `controlEntry: "web/control.html"`、`control.v1` 和 `control.viewport.v1`，三者必须同时提供。入口是包内完整离线 HTML，打包器将其加入完整性清单和签名。没有该声明时继续使用公共 Schema 表单。私有玩法自己的 React 组件、文案和样式随私有插件构建，不由公共宿主 import。

操作台位于 `sandbox="allow-scripts"` 的独立 iframe，只连接 `@liveboom/plugin-sdk/control` 的 MessagePort。客户端应在文档 load 前注册连接监听（React 可通过同步根提交及 layout effect 初始化）。SDK 提供 `connectControl(onEvent)`、`request(method,params,bytes?)` 与 `dispose()`。事件包含裁剪至当前插件的 state、JPEG preview、metrics、export.ready；历史最多 100 条，不含其他玩法任务。组件释放时关闭连接；预览使用有界 JPEG 的 data URL，避免 opaque iframe 的 Blob URL 兼容问题。

请求限额：每秒 40 条，最多 8 个并发，普通参数 64 KiB；图像导入独立 ArrayBuffer 最大 8 MiB，由原生再次校验。可用 method 为 command、media.import、voices、export.review。command 仅开放本地提交、配置、画面、队列控制、当前插件偏好与媒体读取、许可查看等固定名单；不能安装/卸载/启用插件、信任发布者、重启应用、任意调用 native 或保存任意路径。破坏性清理由可信宿主确认，PNG 保存须在可信宿主预览并点击保存。

操作台和渲染文档均由唯一 control 原生窗口读取，但分处两个独立的 opaque iframe；非当前插件或非 control 窗口拒绝服务。原生桥只信任顶层随机请求凭证；控制命令白名单与渲染 task/epoch/instance 校验分别执行。文档 CSP 禁网、禁子框架、禁表单导航、禁 eval。宿主只创建一个渲染实例、一个任务队列和一个音频输出；控制文档不能自行加载第二个执行器。跨系统原生 WebView 隔离仍需目标系统发布验收。


## 桌面控制视口（宿主 0.2.3 起）

专用操作台在 `control.v1` 基础上声明 `control.viewport.v1`，同时提供 `controlEntry`。需要宿主版本 `>=0.2.3 <0.3.0`；打包器与 Rust 验证器会拒绝缺少 `control.v1` 或入口的视口声明，仅接受完整的视口控制能力声明。

新布局的 iframe 占满公共工作区。插件应设置 `html,body,#root` 高度 100%，各级 Grid/Flex 的可收缩区域设置 `min-height:0;min-width:0`，滚动仅发生在任务/属性等局部面板。宿主不接收内容高度消息，SDK 不提供 `resize(height)`；插件自行在给定视口内布局。

`connectControl` 增量事件：

```ts
{ type: 'viewport', value: {
  width: number, height: number, // iframe 客户区 CSS 逻辑像素
  dpr: number, visible: boolean,
  mode: 'normal' | 'compact', revision: number,
  density: 'compact' | 'comfortable'
}}
{ type: 'layout.reset' }
```

首次握手、尺寸变化、可见性和字号偏好变化会发送视口。隐藏视图可能报告零尺寸，应等待恢复可见后重新布局。尺寸由 CSS 直接伸缩，无需经 Rust 往返。SDK 会同步根节点字号密度；插件仍负责有界布局。控制视口、监看容器、真实展示输出尺寸相互独立，不能通过改变控制窗尺寸重新初始化播放会话。

可选 React 基础层从 `@liveboom/plugin-sdk/ui` 导入 `Workbench`、`InspectorTabs`、`Modal`，并导入 `@liveboom/plugin-sdk/ui/styles`。React/React DOM 为可选 peer 依赖，纯协议插件不需要采用 React 控件。插件构建时内联所需组件、CSS 和许可，不从宿主 DOM、CDN 或私有仓库动态读取源码。

`Workbench` 接受 `tasks/stage/inspector` ReactNode，提供分隔条、键盘调整、紧凑侧面板和恢复布局。`store.load/save` 可以调用 `client.request('layout.load')`、`client.request('layout.save', {layout})`；宿主仅接受 tasks/stage/inspector 三个有限百分比，总和约 100，按发布者/插件 ID/布局版本存储在可信侧。该存储不属于任务业务配置，写入失败不影响制作。

SDK 将 iframe 内的 Ctrl/Cmd+, 转为受限 `app.settings` 请求；插件仍没有任意宿主命令或系统快捷键权限。所有既有命令白名单、摘要绑定、窗口角色和不透明源沙箱边界继续生效。公共壳隐藏工作台时保持控制文档挂载并停止向其转发预览帧，草稿与控制状态不会因导航重置。

控制 iframe 仅允许脚本，未开放 `allow-forms`。提交按钮应使用 `type="button"` 并通过显式处理器调用 SDK 命令；Ctrl/Cmd+Enter 也应阻止默认提交并调用相同逻辑。不能依赖浏览器原生 form 导航/提交来触发业务，也不能为此放开沙箱。


## 工作台内嵌实际画面

专用控制文档从 `@liveboom/plugin-sdk/ui` 引入 `RenderSurface`，在期望显示实际玩法的位置放置该组件，并传入受限 `request` 方法：

```tsx
<RenderSurface request={(method, params) => client.request(method, params)} />
```

容器必须有明确可用高度。组件上报 `surface.bounds`（x/y/width/height/visible，CSS 像素）；宿主校验有限数值并裁剪到控制 iframe 边界，将自己持有的渲染 iframe 覆盖在此空位。没有复制场景、JPEG 回传或插件跨源 DOM 访问。工作台失去可见性、控件遮挡画面或弹出导出审核时隐藏承载区，保留渲染器与运行状态；导航回来继续显示。宿主向渲染会话发送 `visibility`；3D 会话隐藏时用定时调度继续制作和回执、停止 GPU 绘制，避免依赖隐藏 iframe 的 requestAnimationFrame。控制文档不应在占位区内放置其他控件。

一个玩法提供一个承载区。标准 3D 制作台在中央画面区预留位置，昵称登记在右侧预留位置；未提供专用控制文档的玩法由公共宿主分配画面与表单区域。不再提供 `open_display`、`resize_display` 或 display 原生窗口；尺寸依据工作台区域与 DPR 自动适配。内部 `register_display` / `display_ready` 仅表示渲染实例注册/就绪，不再表示操作系统窗口。

宿主重载玩法时生成新实例，旧代次回调仍拒绝；音频首次解锁按钮位于工作台画面。SDK 的可选预览帧协议不是本方案的实际显示路径，3D 示例已停止生成和回传低帧 JPEG。
