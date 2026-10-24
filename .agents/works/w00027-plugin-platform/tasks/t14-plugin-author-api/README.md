---
schema: nbook.task/v2
taskId: t14-plugin-author-api
status: active
updated: 2026-10-24
---

# 作者 API 的形状：贡献助手、结果助手、短名、缺省值与出错可见

## 目标与范围

按 t13 design.md 第 4 节 A1 到 A9 改插件作者直接写的 API：definePlugin 绑定插件 id 的贡献助手（命令、状态栏条目、视图、设置项）、远程方法的 ok/fail 结果助手、短名拼 id、文字与位置的缺省、schema 补 additionalProperties 与 locality 必填、provide 改名 provideService、插件页逐入口显示激活与失败原因、命令面板的参数提示、作者文档补齐；开发者 2026-10-24 定全部做（D5）

合同：改动 [plugin-api](../../../../../docs/specs/runtime/plugin-api.md)、[plugin-channel](../../../../../docs/specs/runtime/plugin-channel.md)、[persistence](../../../../../docs/specs/storage/persistence.md)、[plugin-install](../../../../../docs/specs/runtime/plugin-install.md)、[commands](../../../../../docs/specs/workbench/commands.md) 等，逐项见 [plan.md](plan.md) 第 4 节。

## 当前状态

2026-10-24 经 nbdev 新建；实施计划见 [plan.md](plan.md)。计划审查两份：Sonnet（前端与作者体验，阻断 1、重要 11、建议 3）、omp（内核、服务端与计划整体，阻断 2、重要 8、建议 2），全部成立，逐条处理见 plan.md 第 9 节；其中一条“接受取舍”（旧产物不设兼容窗口）与四条产品取舍进了待确认清单。开始实施。

进展：

- S1 `00f04ff4e`：内核 `ok`/`fail`；业务失败的详情按码定型，提供方与调用方都按该码的 schema 核对，不合为 `provider-error`（诊断 `error-detail-invalid`）；合同的 `input`、`filter` 没写 `additionalProperties` 时补成 `false`；`provide` 改名 `provideService`、`providePerConsumer` 改名 `provideServicePerConsumer`；激活上下文加 `onStop`，`defineStore` 改用它；提供入口激活失败时 `unavailable` 带错误消息。新类型顺带查出 focus 示例里一处失败码被反推错的类型。验证：内核 397 例、应用 Bun 1465 例、Vitest 364 例、类型检查、插件 e2e 7 例；合入 master（`592eccf10`）。
- S2 `1dc451be0`：`definePlugin` 与根入口的分区、设置项、命令助手，`/browser` 的视图、设置页、状态栏条目、选项来源助手；入口按键逐项交实现，漏写、多写、换错、浏览器助手写进服务端入口都编译不过，仓库外作者项目的 vue-tsc 诊断写明是哪一项；激活事件并入；`rawContributions`；属性从 `load` 推出；作者上下文没有 `scope`。
- S3 `b8c5296c0`：记录的 `locality` 必填，schema 自动补 `additionalProperties: false`。产品与示例的记录原本都写了 `locality`，没有要补的。
- S2、S3 验证：类型检查，应用 Bun 1472 例、Vitest 368 例；合入 master。
- S4 `b44bc03a2`、`ea467516d`：模板与 7 个示例改用新写法（`definePlugin` 放在合同模块，避免与 `plugin.ts` 循环引用；命令、设置项、分区、视图、状态栏条目、设置页用助手；menu 的自定义贡献点、file-menu 的提交、counter 的公开状态走 `contributionPoints` 与 `rawContributions`；停止时用 `onStop`；远程结果用 `ok`/`fail`）；`create` 去掉 `npm init` 的占位；作者文档补前置条件、远程服务加订阅的完整代码、插件状态与公开状态、命令参数规则与常用名字；SDK 根入口导出 `CommandResult`。验证：类型检查、Bun 1472 例、Vitest 368 例、插件 e2e 7 例。

- S5 `ca7227daf`、`5224c3217`：问题读模型 `pluginProblems`（本位置的入口激活失败与受阻、被拒的贡献，纯 JSON）；清单加可选 `displayName`、`description`；插件管理的 `list` 带显示名、说明与服务端的问题（合同版本 4）；`window.plugins.problems()`；构建核对插件描述的 `locations` 与实际入口；插件页显示显示名、说明与逐条问题，Lab 加“问题”场景，e2e 加一个入口激活失败的插件。验证：类型检查、Bun 1474 例、Vitest 369 例、插件 e2e 8 例，截图核对过。
- S6 `24b63e7b9`：命令面板不列有必填参数的命令；从面板或快捷键执行失败时弹一条警告通知（命令名与原因，`stale-target` 不弹），Lab 不接时照旧。作者文档的“调试”一节改写（`8f8ddf3a7`）。Spec：plugin-install 输出 10、plugin-manifest、browser-host、views、plugin-code-loading、commands、quick-open（master `696b8952c`）。验证：类型检查、工作台 Bun 234 例、Vitest 140 例（workbench、lab、web）。合入 master。

## 下一步

收口：全量 e2e；然后启动实现审查（后端 omp、前端 Sonnet）与一次空白上下文的作者验收（Sonnet 照 t12 的做法从零写插件，并逐条对照 t12 的作者体验报告），不阻塞。
