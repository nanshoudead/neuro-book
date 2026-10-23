---
schema: nbook.task/v2
taskId: t05-author-experience
status: active
updated: 2026-10-23
---

# 作者体验：脚手架、文档与完整示例

## 目标与范围

让仓库外的人按文档从零写出、构建、安装并调试一个第三方插件。范围：

- 脚手架：一条命令生成带 `plugin.ts`、入口、示例视图与构建脚本的插件目录（放在 SDK 包里：`npx nbook-plugin create`）。
- 作者文档：SDK 包的 README（安装、构建、调试、发布目录），`packages/neuro-book/examples/README.md` 增加“外部插件”一节；两者链接 Spec，不复制行为正文。
- 示例全部外置：t04 已改好 snippets、clock、notes、counter；本 Task 补 menu、file-menu，六个示例都经构建、安装、启用运行，`examples/README.md` 的讲解随之改写（开发者 2026-10-17 定示例改为外置插件）。
- 完整示例：一个真实能力的插件（定为“专注计时”，见待确认清单），覆盖设置项、命令、视图、服务端远程服务、私有存储与自定义配置。
- smoke：在仓库外的临时目录按文档生成并构建，安装进产品，走完安装→使用→禁用→卸载。

非目标：在线分发与插件市场；SDK 的正式发布流程；插件签名与权限。

## 行为合同

- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)
- [`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)

## 当前状态

2026-10-17 建 Task，未开工。依赖 [t04](../t04-browser-loading-sdk/README.md) 的 SDK 与装载能力。

2026-10-23 按 t04 做完的 SDK 与安装流程写了实施计划 [plan.md](plan.md)：SDK 补工作台视图与状态栏的贡献点；`manifestOf` 拒绝第三方贡献点的 `validate`（menu 示例暴露：写了也会在宿主里悄悄失效）；menu、file-menu 外置；SDK 包加 `nbook-plugin create`、`build` 与模板；完整示例改为“专注计时”（只用 SDK 已有的接口，不碰文件与编辑器的内部合同）；作者文档进 SDK 包的 README；仓库外 smoke 分 e2e 与照文档的手动一遍。照推荐做的取舍记进 Work 的待确认清单。

2026-10-23 设计审查：Claude Sonnet（界面，17 条：重要 11、建议 6）、omp（默认模型，写完 5 条重要后上游额度用完，换 openai-codex 与默认模型链续跑都因额度不足立即失败，按规则不再试探；后端剩下的部分改派 Claude Opus 补审）。报告在 [`evidences/`](evidences/)。全部成立，按 [plan.md](plan.md) 文末“设计审查的处理”修订；主要变化：SDK 加 `./components`（nb-ui 组件的实现与类型）与 `viewContribution`；内核贡献点加 `idPrefix`、清单 id 段改为字母开头、`manifestOf` 先逐份检查再聚合；menu 启动即激活并记收到菜单项的诊断；`create` 合并已有 `package.json`、`build --dev`；focus 只留 `minutes`，合同去掉 `finish`，浏览器状态抽成纯 TS store，场地加工作台替身；e2e 改用肯定判据。照推荐做的取舍记进 Work 的待确认清单。

Claude Opus 补审后端（14 条：重要 7、建议 7），全部成立或部分成立，按 plan.md 的处理表修订：`--dev` 改用构建元数据、focus 的结算函数与条件保存、服务端记录 `locality: "shared"`、`minutes` 只在用户层、引用的 Spec 随 SDK 包复制、`create` 的合并与 `--sdk`。

- 2026-10-23 S1（`8a7a6d4d3`）：内核贡献点 `idPrefix`、清单 id 段字母开头、`manifestOf` 先逐份检查再聚合并拒绝第三方 `validate`；SDK 工作台贡献点、`viewContribution`、`./components`（宿主模块表以它取代 nb-ui 的入口，直接导入 nb-ui 构建失败并提示）；menu、file-menu 外置。验证：内核 385 例、示例与 SDK 与构建预设 52 例、Vitest 47 例、两包 typecheck；e2e `plugin-code.e2e.ts` 4 例（menu、file-menu 的 `published` 与 menu 收到菜单项的诊断）。

## 下一步

S2 收口提交；之后 S3–S5。
