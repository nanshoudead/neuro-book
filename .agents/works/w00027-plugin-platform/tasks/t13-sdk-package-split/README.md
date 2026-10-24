---
schema: nbook.task/v2
taskId: t13-sdk-package-split
status: planned
updated: 2026-10-24
---

# SDK 拆成独立包、内核去掉 NeuroBook 常量

## 目标与范围

开发者 2026-10-24 定：（1）内核里写死的 NeuroBook 常量（保留的发布者 nbook、engines.neurobook 的键名、nbook. 内置前缀、诊断插件 id）改由宿主在装配时传入；（2）按做法 C 拆包：内置插件的合同留在应用，应用经包导出公开唯一的 SDK 入口；作者工具、构建预设、模板、作者文档与示例插件拆成独立的工作区包 @notnotype/nb-plugin-sdk；公开合同不再引用内部模块，收窄 SDK 带出的名字；第三方插件的通用部分（安装、登记、装载、构建）在目录上与 NeuroBook 专有部分分开、各有入口，暂不抽成通用包，出现第二个使用插件模式的应用时再抽；（3）包边界文档与 nb-runtime 说明写清：内核与应用无关，第三方插件的通用部分暂在应用里。t12 两份报告里与拆包、API 形状相关的结论并入本 Task 的计划。

合同：外部行为不变；清单格式改由平台档案参数化、贡献 id 前缀与合同核对的内核规则、诊断插件 id、插件管理失败码与 SDK 的组成有 Spec 改动，见 [plan.md](plan.md) 第 4 节。

## 当前状态

2026-10-24 经 nbdev 新建。架构设计见 [design.md](design.md)，实施计划见 [plan.md](plan.md)；第一轮设计审查（Sonnet）进行中。t11（激活产出形状由内核核对）并入本 Task 的 S1b。

## 下一步

处理设计审查，交开发者确认 design.md 第 5 节的待决 D1 到 D5，再按 plan.md 的切片实施。
