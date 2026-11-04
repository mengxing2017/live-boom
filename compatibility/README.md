# 旧示例兼容制品

3D 制作台接替二维示例后，活跃工作区只保留 registry 与 printer-3d 两个玩法。

`plugins/community.registry-1.0.0.lbplug` SHA-256：`1a9e94cef6fc475362b3d8311d16f3f9fc1ffc6ae349caebb8267af9eac6247f`。
`plugins/community.workshop-2d-1.0.0.lbplug` SHA-256：`4de8d54e0e979bcda465ff664d403a285e91ea76016c835949c77c072bcd608f`。

两份均为升级前已安装的公开示例原包，内容与版本不变，并保留原包 SDK/许可声明。宿主只按精确摘要保留信任；已有安装、未完成任务和历史仍引用原版本。全新安装不自动启用或安装退役二维示例，必要时可显式导入其兼容包。

`workshop-2d-source` 保存退役示例源码（迁移期间的 1.0.1 开发版本），不属于 pnpm 工作区，不是额外子项目。不要用该源码覆盖已分发的 1.0.0 包；继续开发时采用新版本并签名交付。

React 操作台升级另保留原 `community.printer-3d@1.0.0` 包：`plugins/community.printer-3d-1.0.0.lbplug`，SHA-256 `800e4641fdfacc75ec59cad086a519fa5b17aad04e4f4e8643ee8fde34d4eb4e`。既有任务与历史继续引用原包；新版 1.1.0 需要显式启用，不覆盖原版本。
