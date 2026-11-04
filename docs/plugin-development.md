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
  "dependencies": { "@likeboom/plugin-sdk": "file:vendor/likeboom-plugin-sdk-0.2.0.tgz" },
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

`inputSchema/configSchema` 使用首期受限 schema 方言，**不是完整 JSON Schema**：支持 object/string/integer/number/boolean、properties/required/additionalProperties:false、title/description/default、enum、minLength/maxLength、minimum/maximum。每层至多 32 字段；不支持数组、$ref、pattern、oneOf 等，未知关键字拒绝安装。文本按 Unicode 字素簇计数；宿主拒绝控制字符、类型错误和未声明字段。单次输入/配置至多 64 KiB。根输入和配置应是对象，公共 UI 自动生成相应字段。

prepare 只返回经过相同 inputSchema 验证的规整输入，成功后由 Rust 冻结存储，再发 play；它不是允许任意结构的通用计划引擎。重试已准备的任务复用冻结输入，不重新随机生成计划。宿主统一处理 task_id、epoch、instance、队列、容量、幂等、来源标识和结果；插件不声明自己的可信来源。

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

新版本并排安装，队列与历史固定记录完整插件版本和摘要。切换玩法或配置要求当前和待执行队列为空。启用旧版本即可回退，其原状态保留。相同 stateSchemaVersion 可通过控制台显式复制到空目标版本；禁止覆盖和跨玩法复制。跨 schema 的任意迁移脚本暂不开放，需在以后增加受限迁移协议，不能静默继承不兼容数据。

被启用、当前/待执行/历史任务引用的版本拒绝卸载。停用并清空历史/开始新场后可卸载；卸载包保留命名空间数据，没有自动删除客户数据的操作。

故障时失败、中断与完成分别记录。展示窗丢失或应用重启不会自动重播运行中任务，需要用户明确重试；应用重启后待执行队列也先暂停，展示就绪后手动继续。宿主当前只允许一个实例打开同一数据目录。
