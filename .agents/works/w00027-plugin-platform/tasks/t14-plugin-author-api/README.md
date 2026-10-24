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

## 下一步

按 plan.md 第 5 节的切片实施，当前 S2。
