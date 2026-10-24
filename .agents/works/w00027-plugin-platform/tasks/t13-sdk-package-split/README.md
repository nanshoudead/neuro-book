---
schema: nbook.task/v2
taskId: t13-sdk-package-split
status: active
updated: 2026-10-24
---

# SDK 拆成独立包、内核去掉 NeuroBook 常量

## 目标与范围

开发者 2026-10-24 定：（1）内核里写死的 NeuroBook 常量（保留的发布者 nbook、engines.neurobook 的键名、nbook. 内置前缀、诊断插件 id）改由宿主在装配时传入；（2）按做法 C 拆包：内置插件的合同留在应用，应用经包导出公开唯一的 SDK 入口；作者工具、构建预设、模板、作者文档与示例插件拆成独立的工作区包 @notnotype/nb-plugin-sdk；公开合同不再引用内部模块，收窄 SDK 带出的名字；第三方插件的通用部分（安装、登记、装载、构建）在目录上与 NeuroBook 专有部分分开、各有入口，暂不抽成通用包，出现第二个使用插件模式的应用时再抽；（3）包边界文档与 nb-runtime 说明写清：内核与应用无关，第三方插件的通用部分暂在应用里。t12 两份报告里与拆包、API 形状相关的结论并入本 Task 的计划。

合同：外部行为除诊断插件改名外不变；[plugin-manifest](../../../../../docs/specs/runtime/plugin-manifest.md) 的清单格式改由平台档案参数化，[plugins](../../../../../docs/specs/runtime/plugins.md) 的贡献 id 前缀与合同核对规则，以及诊断插件 id、插件管理失败码与 SDK 的组成都有 Spec 改动，见 [plan.md](plan.md) 第 4 节。

## 当前状态

2026-10-24 经 nbdev 新建。架构设计见 [design.md](design.md)，实施计划见 [plan.md](plan.md)；两轮设计审查（Sonnet）已处理，见 plan.md 第 9 节；开发者 2026-10-24 定 design.md 第 5 节 D0 到 D5 全部按推荐，并指定按 autonomous-delivery 推进；开工。

进展：

- S1a `0ffd9455c`：清单格式按平台档案建（`createManifestFormat`），拆成读、生成、还原；应用的 `src/plugin-platform-profile.ts` 给出 NeuroBook 档案，id 规则只剩一份。
- S1b `e0fa57fe0`：内核装配收平台档案；`idPrefix` 对保留发布者放宽，8 个内置贡献点改用它，工作台的贡献点定义导出一份供插件与测试共用；合同按内容核对，删掉应用的补丁；激活产出不是对象报 `activation-threw`（t11）；应用经 `src/application.ts` 装配，架构测试守住。三处新行为做过变异核对。
- S1c `30710af3a`：诊断插件改名 `runtime.diagnostics`；内核源码不再出现应用名，有扫描测试。
- Spec 与 ADR `65921ae97`（master）。验证：内核 393 例、应用 Bun 1434 例、Vitest 364 例、类型检查、`plugin-code` 与 `plugins` 两份 e2e 6 例；已合入 master。t11（激活产出形状由内核核对）并入本 Task 的 S1b。

## 下一步

S2a：文件搬进 `src/plugin-platform/`（纯搬家），档案两层与字面量进档案，`types.ts` 反转。
