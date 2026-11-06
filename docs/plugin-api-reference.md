# 插件 API 参考

适用：宿主 / SDK **0.2.3**，`sdkApi: "1"`。入门代码见[开发指南](plugin-development.md)，交付见[测试与交付](plugin-testing-and-release.md)。本文只描述当前实现；未列出的服务不应当作插件可用接口。

## 1. SDK 入口

| 导入路径 | 导出内容 | 使用位置 |
| --- | --- | --- |
| `@liveboom/plugin-sdk` | `PluginInfo`、`Task`、`Snapshot`、`AppError` 等类型；公共壳的 `DesktopTransport` | 类型引用；不要在玩法中实现 native 直连 |
| `@liveboom/plugin-sdk/client` | `connectPlugin`，task / session 生命周期类型 | 渲染文档 |
| `@liveboom/plugin-sdk/control` | `connectControl`、`ControlEvent`、`ControlState`、`ControlViewport` | 专用操作台文档 |
| `@liveboom/plugin-sdk/ui` | `Workbench`、`InspectorTabs`、`Modal`、`RenderSurface`、`LayoutStore` | 可选 React 操作台 |
| `@liveboom/plugin-sdk/ui/styles` | SDK 桌面控件样式 | 与 React 基础层一起打包 |
| `@liveboom/plugin-sdk/pack` | `pack(directory, output, keyPath?)` | Node.js 构建脚本 |

CLI：`liveboom-plugin <plugin-directory> [output.lbplug] [ed25519-private.pem]`。缺省输出为插件目录下的 `dist/plugin.lbplug`。打包器返回 `{path,digest}`，digest 是整个归档字节的 SHA-256。

SDK 的 TypeScript 类型直接随包发布，React 入口为 TSX，需要 esbuild 等 bundler 处理。不要让原生浏览器直接加载这些 TS/TSX 源码。

## 2. Manifest

完整字段来自 [PluginManifest](../crates/play-contracts/src/lib.rs)，JSON 字段使用下表的驼峰命名。

| 字段 | 必填 | 含义与限制 |
| --- | --- | --- |
| `id` | 是 | 稳定玩法标识；包含 `.`，最多 100 字节，仅 ASCII 字母、数字、`.`、`-`、`_`，如 `customer.name-wall` |
| `name` | 是 | 非空显示名，最多 200 字节 |
| `version` | 是 | 合法 SemVer；同 ID/版本不同内容拒绝安装 |
| `sdkApi` | 是 | 当前为字符串 `"1"`，不是 npm SDK 版本 |
| `hostVersion` | 是 | 宿主 SemVer 范围；当前建议 `>=0.2.3 <0.3.0` |
| `publisher` | 是 | 非空发布者标识，最多 100 字节，须与签名发布者一致 |
| `entry` | 是 | 包内自包含渲染 HTML 路径 |
| `inputSchema` | 是 | 任务输入 Schema JSON 路径，根为 object |
| `configSchema` | 是 | 业务配置 Schema JSON 路径，根为 object |
| `stateSchemaVersion` | 是 | 大于 0 的整数；自身持久状态格式版本 |
| `permissions` | 是 | 必需权限与可选资源权限，见下表 |
| `capabilities` | 否 | 已实现可选能力列表，缺省空数组 |
| `controlEntry` | 否 | 自包含 React/HTML 操作台；与 `control.v1`、`control.viewport.v1` 同时提供 |
| `planSchema` | 否 | 冻结计划 Schema，与 `plan.v1` 同时提供 |
| `presentationSchema` | 否 | 显示配置 Schema，与 `presentation.v1` 同时提供；建议 object |
| `examples` | 否 | `{name,input}[]` 文件；最多 12 项，名称非空且最多 32 字符，每项输入必须通过 inputSchema |
| `workUnitsField` | 否 | 输入中的工作量整数字段，Schema 必须明确限定 1–100 |
| `workUnitsSelectorField` | 否 | 输入中索引业务规则表的字符串字段，须与下一项及 workUnitsField 一起声明 |
| `workUnitsRulesField` | 否 | config 中的规则表字段；每个选中规则需 `enabled:true` 和整数 `units:1–10` |

包内路径必须是安全相对路径：最多 240 字节，每段只使用 ASCII 字母、数字、`.`、`_`、`-`，段间 `/`；不允许空段、`.`、`..`、绝对路径、反斜杠。跨平台文件名注意大小写一致。

### 2.1 权限

| permission | 用途 |
| --- | --- |
| `task.current.read` | 必需；当前任务读取 |
| `task.result.report` | 必需；任务结果回报 |
| `storage.own` | 当前任务自身版本命名空间中的 storage.get/set |
| `assets.own` | 请求包内 `assets/` 的 data URI |

未知权限会拒绝安装。权限没有任意网络、任意文件、摄像头、麦克风、系统进程或数据库 SQL 项。

### 2.2 可选能力与配套声明

| capability | 用途 / 额外要求 |
| --- | --- |
| `control.v1` | 专用操作台；必须有 controlEntry 和 control.viewport.v1 |
| `control.viewport.v1` | 有界视口与桌面布局；必须有 controlEntry 和 control.v1 |
| `session.v1` | 长驻渲染场景；代码还需传入 connectPlugin 的 session factory |
| `plan.v1` | 独立冻结计划及逐份进度；必须有 planSchema |
| `presentation.v1` | 即时显示设置；必须有 presentationSchema |
| `preferences.own.v1` | 空闲也可使用的偏好存取 |
| `media.own.v1` | 导入、列出、解析和清理本玩法自有图像 |
| `audio.own.v1` | 通过宿主唯一音频层播放音效和本地语音 |
| `preview.frames.v1` | 受限 JPEG 监看和 metrics；不是当前工作台实际画面通路 |
| `export.png.v1` | 生成有界 PNG 并交由宿主审核保存 |

按实际调用声明最小能力。例如 session `assets.resolve` 需要 `session.v1` + `assets.own`；当前 `audio.play` 的素材解析也经过该 session 资源服务，因此包内音效应同时声明 `session.v1`、`audio.own.v1` 和 `assets.own`。不要仅凭类型允许的方法名推断已获得宿主权限。

## 3. Schema 方言

Rust 会在安装时检查 Schema、在配置/输入/计划等写入时校验值。此方言**不等于完整 JSON Schema**。

| 关键字 | 行为 |
| --- | --- |
| `type` | 必需，支持 object、string、integer、number、boolean、array |
| `title` / `description` | UI 标签与说明 |
| `default` | 表单初始化提示，不会自动向已提交 JSON 填值 |
| `properties` | object 必需，每层最多 32 个字段 |
| `required` | 必填字段名数组，名称必须已在 properties 中声明 |
| `additionalProperties` | object 必须明确为 false，任何未声明字段均拒绝 |
| `enum` | 非空数组，最多 100 值；提交值必须在其中 |
| `minLength` / `maxLength` | 非负整数；字符串按 Unicode 字素簇计数 |
| `minimum` / `maximum` | 数值上下限 |
| `items` / `maxItems` | array 必需，maxItems 最多 100 |
| `minItems` | 可选，不能大于 maxItems |

`$ref`、`$schema`、`pattern`、`format`、`oneOf`、`allOf`、nullable 等未实现关键字会拒绝安装，不要把编辑器默认生成的元数据直接加入包内 Schema。每次值校验的序列化 JSON 上限 64 KiB；字符串含控制字符会拒绝，包括换行、Tab。数字字符串不等于 number，`1.5` 不等于 integer。

提交方必须发送完整有效对象。`configure` 和 `presentation` 接受完整配置，不是 JSON Patch；专用 UI 修改单个值时先合并其余字段再提交。当前通用 Schema 表单适合简单字段，嵌套规则、复杂数组应提供专用操作台并测试交互，不把 Schema 可验证性当作通用表单已支持全部复杂编辑器的保证。

## 4. 任务生命周期与冻结计划

### 4.1 connectPlugin

```ts
import { connectPlugin } from '@liveboom/plugin-sdk/client';

connectPlugin<Input, Config, Plan>(taskServices => ({
  prepare(input, config) { /* 返回 Input 或 Plan，允许 Promise */ },
  play(input, config, state) { /* 启动执行，完成后显式回报 result */ },
  pause() {},
  resume() {},
  dispose() {}
}), {
  session: async (sessionServices, initialConfig) => ({
    configure(config) {},
    presentation(value) {},
    visibility(visible) {},
    control(value) {},
    dispose() {}
  })
});
```

上段为签名示意，`Input/Config/Plan` 由作者定义。`options` 和其中的 session 回调可整体省略。任务 factory 可异步；尽早同步调用 connectPlugin 注册握手监听，耗时素材准备放在 factory/session 内。

| 阶段 | 宿主与 SDK 行为 | 插件要求 |
| --- | --- | --- |
| 文档握手 | 宿主传一次 MessagePort、nonce；SDK 回 ready，宿主注册随机实例 | 不自行构造 instance、task_id 或 epoch |
| session | 可选长驻场景创建，任务 prepare/play 等待 session 就绪 | 预加载与重型场景资源在此管理 |
| prepare | 当前任务携带 input/config，SDK 创建 task 实例 | 规整输入或生成计划，返回可序列化 JSON |
| 冻结 | Rust 按 Schema 校验并持久化准备结果 | 不在 play 再随机生成已冻结结果 |
| play | SDK 传入 input、该任务 config、state | 启动动画；函数返回不代表完成 |
| pause / resume | 宿主暂停/继续，同步调用生命周期 | 冻结逻辑时钟并正确恢复剩余时间 |
| result | 插件回 completed/failed，宿主验证代次与进度 | 最终结果只回报一次；出错可 failed |
| cancel / 切换任务 | SDK dispose 当前 task | 清理计时器、监听器、异步回调；不要提交结果 |
| 文档销毁 | 宿主发 dispose，清理 task 后清理 session | 释放 GPU、纹理、音频相关引用等资源 |

普通路径下 `prepare` 返回经同一 inputSchema 校验后的规整输入，`play` 接收它；省略 prepare 时保留原始输入。声明 `plan.v1` 时 `prepare` 返回 planSchema 对应计划，play 的 input 仍是输入，计划从 `state.plan` 读取。

```ts
type PlaybackState<Plan> = {
  plan: Plan | null;
  completedUnits: number;
  source: string; // 当前可信来源为 manual 或 demo
};
```

factory 的 services 绑定不可变的 `{task_id,epoch,instance}`。过期 task 的 request 被 SDK 或 Rust 拒绝，过期结果不能完成新任务。不要全局保存“最近的 services”供旧计时器使用；销毁时取消定时器、AbortController 和事件监听。

`restore` 是类型中存在的可选回调，不是当前自动恢复运行任务的承诺；以宿主显式重试流程为准。`connectPlugin` 的返回函数仅注销初始连接监听，不能当作已连接 task/session 的完整销毁 API；正常生命周期由宿主 dispose 消息驱动。

### 4.2 冻结计划与逐份完成

计划建议采用根 object，包含 `units` 数组；数组长度必须等于宿主计算的任务 work_units。计划中保存随机选中的模板、颜色、文案、尺寸等可重播信息，不保存 DOM、函数、Three.js 实例或资源文件绝对路径。

```ts
async function play(input, config, state) {
  const plan = state.plan;
  for (let index = state.completedUnits; index < plan.units.length; index++) {
    // animate 必须实现暂停、恢复、取消；此处仅示意进度协议。
    await animate(plan.units[index]);
    await services.request('units.complete', { index });
  }
  services.result('completed');
}
```

`index` 从 0 起，必须按顺序回报；重复已确认的 index 幂等，跳过未完成单元会拒绝。先 await 单元回执，再回任务完成；未完成全部单元时不能报 completed。重试保留冻结输入/计划和 completedUnits，从下一个单元继续，避免重复制作已完成单元。

没有 workUnitsField 时 work_units 为 1。配置规则表时工作量为 `input[workUnitsField] × config[workUnitsRulesField][input[workUnitsSelectorField]].units`；对应规则必须 enabled。宿主约束当前与等待任务的**剩余工作量总和不超过 100**，不是一律可排 100 个多份任务。优先任务只调整等待顺序，不打断当前任务。

### 4.3 暂停、隐藏与故障恢复

`pause` 是业务暂停；`visibility(false)` 是画面不可见，两者不同。渲染循环隐藏时可停止 GPU 绘制，但仍要推进未暂停任务的逻辑与回执。浏览器可能节流隐藏 iframe 的 requestAnimationFrame，应采用独立时钟或定时调度；参考 [3D 会话](../plugins/printer-3d/src/scene/session.js)。恢复可见后按实际容器尺寸和 DPR 重设 viewport，不能重建任务/重置进度。

当前宿主加载握手与 prepare 超时约 10 秒；执行计时在未暂停时累计，prepared 后上限为 `max(120000, work_units × 45000)` 毫秒。宿主检测到超过 15 秒的调度间隔会按系统休眠/展示中断处理。这些是故障保护，不应把耗时任务设计得贴着限额运行。

应用重启或渲染实例丢失不会自动重播运行中任务。用户选择相同摘要版本后可明确重试失败/中断任务；重启后的待执行队列先暂停，画面就绪后由用户继续。

## 5. 渲染文档服务

### 5.1 task services

`services.result(status)` 只支持 `'completed' | 'failed'`，没有取消和中断结果权限。`services.progress(value)` 目前为预留消息，不更新权威单元进度；需要进度持久化时用 units.complete。

`await services.request(method, params)`：

| method | params | 返回值 / 要求 |
| --- | --- | --- |
| `storage.get` | `{key}` | 存储值或 null；storage.own |
| `storage.set` | `{key,value}` | 写入后的值；storage.own |
| `assets.resolve` | `{path:'assets/logo.png'}` | data URI 字符串；assets.own |
| `units.complete` | `{index}` | null；有效冻结计划及正确顺序 |
| `audio.play` | `{path,volume?,loop?}` | 宿主播放包内素材；audio.own.v1，并配齐 session/assets 权限 |
| `audio.stop` | `{}` | 停止宿主当前声音；audio.own.v1 |
| `speech.say` | `{text,lang?,id?,rate?,volume?,voice?}` | 本地语音；audio.own.v1，建议每段给稳定 id |

任务服务只能在当前任务身份仍有效时调用，不能用 storage.get 做空闲 UI 初始化。SDK 服务请求超时 5 秒；普通消息 JSON 最多 64 KiB，渲染桥普通消息每秒最多 100 条、服务并发最多 16。图片走专门二进制消息，不能把限额理解成允许大 base64 JSON RPC。

当前音效层一次保留一个活动音效，新 audio.play 会停止旧音效；volume 裁剪到 0–1。语音只选本地且与语言匹配的 voice，找不到则不播；文本最多取 160 字符、rate 裁剪到 0.5–2、volume 裁剪到 0–1。语音 id 在任务代次内用于去重，建议提供非空稳定值。声音请求成功不是播放完毕或任务完成凭证；即使用户未解锁声音也应可正常执行视觉流程。

storage key 非空、最多 100 字节；值最多 64 KiB，业务命名空间最多 1 MiB。当前实际业务命名空间为 `id:version:stateSchemaVersion`；preferences 另有子命名空间。不要假设它按摘要隔离，也不要让不同发布者共用同一个玩法 ID。

### 5.2 session services

通过 `options.session` 的 services 调用，绑定当前真实渲染实例，空闲时也可使用：

| 方法 | 参数 / 行为 | 能力 |
| --- | --- | --- |
| `request('preferences.get',{key})` | 值或 null；key 非空最多 100 字节 | preferences.own.v1 |
| `request('preferences.set',{key,value})` | 值最多 64 KiB，偏好命名空间最多 1 MiB | preferences.own.v1 |
| `request('assets.resolve',{path})` | 包内 assets 的 data URI | session.v1 + assets.own |
| `request('media.resolve',{reference})` | 宿主已导入图像的 data URI | media.own.v1 |
| `metrics(value)` | 自定义诊断对象，非权威任务状态 | preview.frames.v1 |
| `frame(blob)` | JPEG Blob；只作监看，非实际工作台显示 | preview.frames.v1 |
| `exportPng(arrayBuffer)` | 提交待审核 PNG，不直接保存文件 | export.png.v1 |

preferences 可用于镜头、视图列表等，按玩法 ID/版本/stateSchemaVersion 隔离，与 task storage 不同。宿主用正确 instance 做授权；切换和重载后不能沿用旧实例调用服务。

SessionLifecycle 接收 `configure(config)`（新业务设置，用于规则显示）、`presentation(value)`（即时显示设置）、`visibility(boolean)`、`control(value)`（插件自己定义的受限工具消息）、`dispose()`。任务 factory 仍然每个任务创建，任务结束不销毁 session。

### 5.3 包内素材与外部图像

包内 assets 由打包器递归收集，资源单次解析最多 10 MiB。支持按后缀生成 PNG、JPG/JPEG、WebP、MP3、WAV 的 MIME，其他后缀为 application/octet-stream。自定义字体等宜构建时内联正确 MIME 的 data URI，或自行确认消费方能处理。

所有 HTML 必须离线自包含：JS/CSS 内联、ES module 打成 IIFE；图片/字体用 data URI。不能用相对 `<script src>`、相对 fetch、远程字体、动态 CDN、Worker 或 eval。`.lbplug` 有多个文件不表示 WebView 会为这些文件开放 HTTP 路由。

对于用户图片，操作台通过 media.import 导入得到 `media:<sha256>` 引用，将引用作为 input/config 的普通字段保存；渲染 session 调用 media.resolve。不要把本机路径、URL 或原始图片 base64 当作任务输入。

媒体按**插件摘要**隔离，与 ID/版本业务状态不同；新包不能假设自动读到旧摘要的媒体。跨版本状态复制/迁移不会自动复制媒体，升级前应设计重新导入/重新绑定流程并测试历史引用。

## 6. 专用操作台 API

### 6.1 连接与状态

```ts
const client = connectControl(event => {
  if (event.type === 'state') renderState(event.value);
});
await client.request('command', {
  name: 'submit', args: { command_id: crypto.randomUUID(), input: { nickname: '访客' } }
});
// 操作台组件卸载时：
client.dispose();
```

连接前 request 会拒绝“操作台尚未连接”；已连接请求超时 15 秒。不要在页面 load 后才异步注册握手监听。React 用同步根提交 + useLayoutEffect，见开发指南。

`ControlState` 包含 snapshot 的 version、session_id、paused、display_ready、demo_enabled、demo_interval、presentation、config，以及必有的 active。current/queue/history 仅投影当前**摘要**玩法的任务；history 最多保留最后 100 条。

`ControlTask` 字段：`id`、`epoch`、`input`、`plan`、`work_units`、`completed_units`、`source`、`priority`、`status`、`created_at`、`finished_at`。不暴露完整 Task 的 plugin/config/instance。不要编造 instance 或自己通过这些字段拼装 native 请求。

| 事件 | payload | 用途 |
| --- | --- | --- |
| `state` | `value:ControlState` | 完整当前操作台投影；按最新版本更新 |
| `viewport` | `value:ControlViewport` | 容器尺寸、DPR、密度和可见性 |
| `layout.reset` | 无 | 恢复默认布局，转换为 Workbench 的 resetKey |
| `metrics` | `value:Record<string,unknown>` | 诊断显示，可缺省，不作为完成凭证 |
| `export.ready` | 无 | 宿主缓存了 PNG，可请求审核 |
| `preview` | `bytes:ArrayBuffer` | 类型保留；当前工作台使用真实 RenderSurface，勿依赖它作为实际输出通道 |

viewport 字段：width/height 为 CSS 像素；dpr 为像素比；visible；mode 为 normal/compact（当前阈值宽 1180）；revision；density 为 compact/comfortable。尺寸变化、握手、可见性和外观变化触发更新。隐藏可能报零尺寸；无需经 Rust 请求改变窗口尺寸，也没有 resize(height) API。

### 6.2 request 方法

| method | params / bytes | 说明 |
| --- | --- | --- |
| `command` | `{name,args}` | 下节白名单命令；宿主追加摘要约束 |
| `surface.bounds` | `{x,y,width,height,visible}` | 有限数值，宿主裁剪；通常由 RenderSurface 调用 |
| `layout.load` | `{}` | 布局对象或 null |
| `layout.save` | `{layout:{tasks,stage,inspector}}` | 三个 5–90 的百分比，总和与 100 差不超过 1 |
| `app.settings` | `{}` | 打开宿主设置；SDK 转发 Ctrl/Cmd+, |
| `media.import` | `{}`，第三参数为 ArrayBuffer | media.own.v1；返回媒体引用字符串 |
| `voices` | `{}` | 本地语音列表 `[{name,lang}]`，可能暂时为空 |
| `export.review` | `{}` | export.png.v1，必须已有导出 PNG；显示宿主可信预览 |

layout 存于可信壳 localStorage，按 publisher/id/布局协议版本隔离，不是 task config，也不按插件发行版本分割。保存失败可降级，不阻断玩法执行。

媒体导入示例：

```ts
const reference = await client.request('media.import', {}, await file.arrayBuffer());
```

ArrayBuffer 会被 transfer，调用后原缓冲区会分离，不能继续复用。原生会解码并重编码 PNG/JPEG，最大输入 8 MiB、4096×4096，缩略到不超过 512×512；同摘要最多 200 张、200 MiB。名单外格式、越界、伪装文件会拒绝。

### 6.3 command 白名单

所有命令通过 `client.request('command',{name,args})`，不可直接 `invoke`。除有返回说明外，成功一般返回 null。

| name | args | 行为 |
| --- | --- | --- |
| `submit` | `{command_id,input,priority?:0或1}` | 本地手动任务；不能指定可信 source |
| `submit_demo` | 同 submit | 显式离线模拟任务 |
| `configure` | 完整 config 对象 | 只应用于新任务，已接收任务 config 不变 |
| `presentation` | 完整显示配置对象 | presentation.v1，即时生效 |
| `pause` / `resume` | `{}` | 暂停/继续权威队列与当前任务 |
| `cancel` | `{id}` | 当前玩法任务，取消等待或当前任务 |
| `retry` | `{id}` | 仅失败/中断任务，必须队列空且启用相同摘要版本 |
| `clear_pending` | `{}` | 宿主确认后清空等待队列 |
| `clear_history` | `{}` | 宿主确认，要求无当前/等待任务；清记录/幂等回执并开始新场 |
| `preempt` | `{}` | 宿主确认，当前未完成部分重新排队；不是优先提交 |
| `reset_demo` | `{}` | 宿主确认清理模拟数据，保留手动数据 |
| `demo_policy` | `{enabled,interval,input}` | 模拟循环，interval 15–120 秒；启用时 input 必须合法 |
| `preview_control` | 插件定义的控制对象 | 不超过 4 KiB，转给 session.control；镜头工具等，不赋予任务结果权限 |
| `read_preferences` | `{key}` | 当前玩法偏好读取，空闲操作台初始化可用 |
| `media_list` | `{}` | media.own.v1；返回 `[reference,字节数][]` |
| `media_resolve` | `{reference}` | media.own.v1；data URI |
| `delete_media` | `{reference}` | media.own.v1；宿主确认，引用中的媒体拒绝删除 |
| `licenses` | `{}` | 当前包 THIRD_PARTY_NOTICES 文本 |

安装、卸载、启用/停用、信任发布者、跨版本状态操作、重启应用、任意文件保存均不在操作台白名单。它们只能通过可信公共壳的管理功能进行。操作台不能调用 open_display、resize_display，也不能请求第二个原生输出窗口。

command_id 建议 UUID。一次逻辑提交遇到不确定网络/桥接结果而重试时复用同一 ID 和相同 input/source/priority；新提交使用新 ID。同 ID 内容不同会 COMMAND_CONFLICT。当前场次幂等回执最多 10000 条，达到后结束本场再继续。

## 7. React 桌面 UI 组件

| 组件 | 主要 props | 约定 |
| --- | --- | --- |
| `Workbench` | tasks、stage、inspector；可选 store、resetKey | 三列可调布局；窄窗折叠抽屉，支持键盘和恢复布局 |
| `InspectorTabs` | `items:[{id,label,content}]` | 属性页签，内容保留挂载，局部滚动 |
| `Modal` | open、title、onClose、children | 插件内对话框；不能代替宿主的破坏性操作确认或文件保存审核 |
| `RenderSurface` | `request(method,params):Promise<unknown>` | 一个实际画面占位区域；容器必须有明确高度 |

各层 Grid/Flex 设 `min-width:0;min-height:0`；html/body/#root 全高、禁止整页溢出。RenderSurface 当前约每 100 ms 检查边界与遮挡，自动通知宿主；不能把按钮放在其上期待跨 iframe 透传交互。抽屉遮挡、Modal、导航切换应验证画面隐藏且任务状态保持。

控制 iframe 未开放 allow-forms。提交按钮使用 `type="button"` 并明确调用 SDK；表单快捷键需 preventDefault。不请求放开 sandbox 或修改 CSP 解决表单导航、图片/模块相对路径问题。

## 8. 配额与协议排错

| 项目 | 当前上限 / 行为 |
| --- | --- |
| `.lbplug` 原始字节 / 文件数 | 200 MiB / 2000 个 |
| 全包解码总量 | 500 MiB |
| 单个包内 assets.resolve | 10 MiB |
| 输入、配置、计划 / 单条存储值 | 64 KiB JSON |
| task storage / preferences | 各命名空间约 1 MiB；按实际实现计数 |
| 渲染普通消息 / 并发服务 | 100 条/秒 / 16 |
| 操作台请求 / 并发 | 40 条/秒 / 8 |
| 操作台普通参数 | 64 KiB JSON；二进制媒体走独立参数 |
| 预览帧 | JPEG，640×360，256 KiB，最多 5 FPS |
| metrics | 完整普通消息不超过 4 KiB，原生最多每秒发布一次，需 preview.frames.v1 |
| PNG 导出 | 2 MiB，2048×2048；渲染桥最多每秒接收一次 |
| 任务工作量 | 当前与等待的剩余工作量总计最多 100 |
| 操作台任务历史 | 当前摘要最近 100 条投影 |

MessagePort 普通信封包含 api:`"1"`、nonce、type。task 消息还绑定 task_id/epoch/instance；service 请求另有 id/method/params。SDK 已处理信封和应答，不要手写 nonce 或绕过 SDK。iframe 文档 URL 仅允许当前包摘要的两种入口；签名有效并不意味着可读取未启用玩法的文档。

原生 AppError 是 `{code,message}`；控制/渲染 SDK 的 request 当前通常将桥返回的错误转为 Error 文本，不保证提供结构化 code。业务 UI 展示可读错误并允许重试；不能只靠匹配 `[object Object]` 或假定所有层都抛同一结构。
