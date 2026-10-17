---
schema: nbook.task/v2
taskId: t05-author-experience
status: planned
updated: 2026-10-17
---

# 作者体验：脚手架、文档与完整示例

## 目标与范围

让仓库外的人按文档从零写出、构建、安装并调试一个第三方插件。范围：

- 脚手架：一条命令生成带 `plugin.ts`、入口、示例视图与构建脚本的插件目录（放在 SDK 包里，例如 `bunx nbook-plugin create`）。
- 作者文档：SDK 包的 README（安装、构建、调试、发布目录），`packages/neuro-book/examples/README.md` 增加“外部插件”一节；两者链接 Spec，不复制行为正文。
- 示例全部外置：t04 已改好 snippets、clock、notes、counter；本 Task 补 menu、file-menu，六个示例都经构建、安装、启用运行，`examples/README.md` 的讲解随之改写（开发者 2026-10-17 定示例改为外置插件）。
- 完整示例：一个真实能力的插件（例如统计当前作品的字数并画一个面板），覆盖设置项、命令、视图、服务端远程服务、私有存储与自定义配置。
- smoke：在仓库外的临时目录按文档生成并构建，安装进产品，走完安装→使用→禁用→卸载。

非目标：在线分发与插件市场；SDK 的正式发布流程；插件签名与权限。

## 行为合同

- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)
- [`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)

## 当前状态

2026-10-17 建 Task，未开工。依赖 [t04](../t04-browser-loading-sdk/README.md) 的 SDK 与装载能力。

## 下一步

t04 完成后开工；开工时先按真实的 SDK 与安装流程修订范围，再写 `plan.md`。
