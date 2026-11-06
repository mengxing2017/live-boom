---
layout: home
hero:
  name: liveboom
  text: 客户端与插件开发文档
  tagline: Rust + React · 本地互动 · 独立玩法插件 · 开闭源隔离
  actions:
    - theme: brand
      text: 开始开发插件
      link: /plugin-development
    - theme: alt
      text: 查看插件 API
      link: /plugin-api-reference
features:
  - title: 从示例开始
    details: 创建独立 React 玩法，构建离线文档与工作台操作界面。
    link: /plugin-development
  - title: 按接口开发
    details: 查阅 Manifest、Schema、任务生命周期、权限和命令参数。
    link: /plugin-api-reference
  - title: 独立签名交付
    details: 测试、离线安装、版本升级、状态迁移与闭源仓库交付。
    link: /plugin-testing-and-release
---

## 阅读入口

| 目标 | 文档 |
| --- | --- |
| 安装环境并启动客户端 | [项目与开发环境](project-overview.md) |
| 创建第一个 React 玩法 | [插件开发指南](plugin-development.md) |
| 查询服务方法与参数 | [插件 API 参考](plugin-api-reference.md) |
| 调试、签名、交付和排错 | [插件测试与交付](plugin-testing-and-release.md) |
| 使用与验收 3D 示例 | [3D 制作台](printer-3d.md) |
| 查看或备份开发数据 | [开发数据目录与重置](development-data-reset.md) |
| 启动、构建和维护本站 | [文档站使用与维护](documentation.md) |

## 当前边界

公共服务在本机 Tauri/Rust 进程中运行；玩法以 `.lbplug` 安装，实际画面显示在工作台。当前提供昵称登记与 3D 制作台两个开源示例，其他玩法可在独立私有仓库开发。

当前文档对应宿主及 SDK **0.2.3**、`sdkApi: "1"`。本项目没有平台抓包、支付或会员流程；插件 API 是本地受限服务接口，不是 HTTP/Swagger 服务。文档站可以独立启动，不需要数据库、原生客户端或后端服务。
