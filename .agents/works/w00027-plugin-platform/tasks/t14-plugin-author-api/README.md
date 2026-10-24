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

2026-10-24 经 nbdev 新建；实施计划见 [plan.md](plan.md)，计划审查进行中。

## 下一步

计划审查（后端与计划 omp，界面 Sonnet）处理完后按 plan.md 第 5 节的切片实施。
