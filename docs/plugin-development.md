# 独立玩法插件开发

## 仓库与构建

闭源玩法只依赖固定版本的公共 SDK，不依赖桌面宿主源码。当前 SDK 尚未发布到 npm，可以先在公共仓库执行 `pnpm --filter @likeboom/plugin-sdk pack --pack-destination /tmp/likeboom-sdk`，将生成的 tarball 作为固定版本依赖安装到私有仓库；正式发布后使用确定版本的包，不使用浮动 workspace 路径或复制宿主工程。

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
  "dependencies": { "@likeboom/plugin-sdk": "file:vendor/likeboom-plugin-sdk-0.2.1.tgz" },
  "scripts": { "build": "likeboom-plugin . dist/customer.lbplug" }
}
```

简单入口由打包器注入 `LikeBoom.connect(factory)`，无需 import；源码示例：

```js
LikeBoom.connect(services => {
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

复杂玩法可自行用 React/Canvas/Three.js 构建自包含 HTML，放到 manifest.entry，显式引入并打包 `@likeboom/plugin-sdk/client` 的 `connectPlugin`。不能依赖宿主的 React、网络 CDN、同源文件或全局 Tauri。首期 HTML 中 JS/CSS 内联，素材使用 data URI，或声明 `assets.own` 后请求 `services.request('assets.resolve', {path:'assets/logo.png'})` 获取受限 data URI；不支持相对路径的多文件模块加载、Worker 或 WASM 权限。

## 包格式与输入协议

当前 `.lbplug` 是 UTF-8 JSON 归档，不是 ZIP：顶层为 `format: "likeboom.plugin.v1"`、`files`（安全相对路径 → base64 字节）、`integrity`（同路径 → SHA-256）、`signature`。签名数据为 ASCII 路径排序后、无空白序列化的 integrity 对象；Ed25519 对其字节签名。签名间接覆盖 manifest 和所有文件。未知字段、重复路径、路径穿越、缺失或损坏文件会拒绝安装。

打包器仅收集 manifest、schema、入口、assets 与许可声明，不收集源码目录、私钥、默认 source map。assets 下的 `.map/.pem/.key` 和符号链接拒绝打包。密钥必须保存在私有 CI secrets 或仓库外。JS 可读性压缩不构成加密。

`inputSchema/configSchema` 使用首期受限 schema 方言，**不是完整 JSON Schema**：支持 object/string/integer/number/boolean/array、properties/required/additionalProperties:false、title/description/default、enum、minLength/maxLength、minimum/maximum。每层至多 32 字段；数组必须声明 items/maxItems（最多 100 项），可声明 minItems；不支持 $ref、pattern、oneOf 等，未知关键字拒绝安装。文本按 Unicode 字素簇计数；宿主拒绝控制字符、类型错误和未声明字段。单次输入/配置至多 64 KiB。根输入和配置应是对象，公共 UI 自动生成相应字段。

未声明 plan.v1 时，prepare 返回经过同一 inputSchema 验证的规整输入；声明 plan.v1/planSchema 后返回独立冻结计划。两种路径均由 Rust 校验、存储后再发 play。重试已准备的任务复用冻结输入，不重新随机生成计划。宿主统一处理 task_id、epoch、instance、队列、容量、幂等、来源标识和结果；插件不声明自己的可信来源。

必需权限为 `task.current.read/task.result.report`，可选 `storage.own/assets.own`，不支持网络、文件系统、系统进程或任意 SQL。进度目前预留消息，不进入权威任务状态。

## 签名与交付

在仓库外生成 Ed25519 PKCS#8 PEM 私钥，例如 `openssl genpkey -algorithm ED25519 -out /secure/publisher.pem`。构建签名包：

```sh
pnpm exec likeboom-plugin . dist/customer.lbplug /secure/publisher.pem
```

同时生成 `.publisher.json`，仅含发布者与公钥。交付插件、公钥、SHA-256 指纹和依赖声明；通过独立渠道核对指纹。客户在控制台保存发布者公钥，填写本机 `.lbplug` 路径导入，再选择插件启用。宿主不访问私有源码仓库，也不需要重编译。

正式宿主拒绝未签名外部包。只有 debug 构建且显式设置 `LIKEBOOM_ALLOW_UNSIGNED=1` 才允许开发未签名包。随宿主编译携带的示例仅以精确摘要信任，并走相同安装、展示和 RPC 路径。

插件包上限 200 MiB、2000 文件，资源解析单项至多 10 MiB；storage.get/set 仅访问当前任务所属玩法/版本/schema 的命名空间，单项 64 KiB、每命名空间 1 MiB。

## 版本、回退与卸载

新版本并排安装，队列与历史固定记录完整插件版本和摘要。切换玩法/版本要求当前和待执行队列为空；configure 只更新新任务规则，不重写已接收任务。presentation 独立即时更新。启用旧版本即可回退，其原状态保留。相同 stateSchemaVersion 可通过控制台显式复制到空目标版本；禁止覆盖和跨玩法复制。跨 schema 支持显式键映射与默认值：同发布者、同玩法、空目标、单项 64 KiB/总计 1 MiB，最多 100 键；来源完整保留并记录迁移审计。复杂值变换由插件作者先生成并审查迁移数据，不在宿主执行任意脚本。

被启用、当前/待执行/历史任务引用的版本拒绝卸载。停用并清空历史/开始新场后可卸载；卸载包保留命名空间数据，没有自动删除客户数据的操作。

故障时失败、中断与完成分别记录。展示窗丢失或应用重启不会自动重播运行中任务，需要用户明确重试；应用重启后待执行队列也先暂停，展示就绪后手动继续。宿主当前只允许一个实例打开同一数据目录。


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

session 生命周期可实现 `presentation/configure/control/dispose`；公共镜头代理通过受限 control 消息传递，不转移任务执行权。资源应由插件自己的 bundler 打入 IIFE，素材走 assets.resolve，不使用相对网络 fetch。像素、音效、规则图和指标均不是完成凭证。

旧插件可以继续保持 v1 factory 和 prepare/input 路径。`compatibility/plugins` 保留两份 1.0.0 原包，宿主只对其精确摘要保留信任；新代码不可复用旧版本号覆盖内容。改编 MIT 代码的闭源交付仍须携带相应完整许可。

## 可选独立操作台（宿主 0.2.2 起）

插件可声明 `controlEntry: "web/control.html"` 及 `control.v1`，两者必须同时提供。入口是包内完整离线 HTML，打包器将其加入完整性清单和签名。没有该声明时继续使用公共 Schema 表单。私有玩法自己的 React 组件、文案和样式随私有插件构建，不由公共宿主 import。

操作台位于 `sandbox="allow-scripts"` 的独立 iframe，只连接 `@likeboom/plugin-sdk/control` 的 MessagePort。客户端应在文档 load 前注册连接监听（React 可通过同步根提交及 layout effect 初始化）。SDK 提供 `connectControl(onEvent)`、`request(method,params,bytes?)`、`resize(height)` 与 `dispose()`。事件包含裁剪至当前插件的 state、JPEG preview、metrics、export.ready；历史最多 100 条，不含其他玩法任务。组件释放时关闭连接；预览使用有界 JPEG 的 data URL，避免 opaque iframe 的 Blob URL 兼容问题。

请求限额：每秒 40 条，最多 8 个并发，普通参数 64 KiB；图像导入独立 ArrayBuffer 最大 8 MiB，由原生再次校验。可用 method 为 command、media.import、voices、export.review。command 仅开放本地提交、配置、画面、队列控制、当前插件偏好与媒体读取、许可查看等固定名单；不能安装/卸载/启用插件、信任发布者、重启应用、任意调用 native 或保存任意路径。破坏性清理由可信宿主确认，PNG 保存须在可信宿主预览并点击保存。

操作台和展示窗分别由 control/display 角色读取指定入口，非当前插件或角色不匹配拒绝服务。操作台 CSP 与展示文档一致，只允许 data 图像，仍禁网、禁子框架、禁表单导航、禁 eval。控制台预览不启动玩法执行器，不维护第二个任务队列，也不播音。跨系统原生 WebView 隔离仍需目标系统发布验收。
