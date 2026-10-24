---
schema: nbook.task/v2
taskId: t15-author-api-round2
status: planned
updated: 2026-10-24
---

# 作者 API 第二轮：作者验收提出的类型与 API 改进

## 目标与范围

按 t14 作者验收报告的 F01、F02 到 F05、F07、F08、F10、F11 评估范围，开发者定范围后实施

来源：[t14 作者验收报告](../t14-plugin-author-api/evidences/author-acceptance-sonnet.txt)里属于新 API 设计的发现（t14 plan.md 第 12 节末行），开发者 2026-10-24 要求先开任务、判断范围。

合同：会改 [plugin-api](../../../../../docs/specs/runtime/plugin-api.md)（作者 API）、[plugin-channel](../../../../../docs/specs/runtime/plugin-channel.md)（调用方的失败类型、事件助手）、[views](../../../../../docs/specs/workbench/views.md) 与 [workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)（打开视图的命令）、[plugin-code-loading](../../../../../docs/specs/runtime/plugin-code-loading.md)（构建报错的格式）；逐项写进计划。

## 范围评估

2026-10-24 按代码核对后的估计。B2、B4 是纯类型改动，难点在 TypeScript 推断：要在 vue-tsc 下实测报错的落点与第一行文字。

| 块 | 发现 | 做什么 | 动哪里 | 大小 |
|---|---|---|---|---|
| B1 打开视图 | F01 | 工作台加命令 `nbook.view.open {viewId}`：找到视图所在容器，选中容器、显示所在的区域、聚焦视图；视图不在布局里时失败并写原因。`statusItem` 的 `command` 收视图助手（点了即打开它）；作者文档列出作者可用的内置命令与参数 | 工作台命令（布局已有选容器、显示区域的动作）、`/browser` 助手、views 与 workbench-shell 的 Spec、一个 e2e | 中 |
| B2 类型报错的落点 | F02、F04、F05 | `fail` 的码与详情写错时报错落在 `fail` 那一行、第一行写清可选的码；入口产出漏写、多写贡献实现时，报错是以问题命名的属性（“缺少贡献实现 ping”“多写了 addComand”）；产出了 `remote` 却没声明 `remoteProvides` 时报错写明去声明哪个合同 | 内核 `define.ts`、`remote/contract.ts` 的类型，SDK `plugin.ts`；编译期反例 | 中 |
| B3 调用方的失败详情 | F03 | 远程调用结果的失败分支改成按码区分的联合，`detail` 随 `code` 收窄成该码的详情类型 | 内核 `remote` 的结果类型；现有调用方可能要改几处收窄写法 | 小到中 |
| B4 规则提前到编辑器 | F08 | 命令参数有必填项又给人用、记录与远程 `input` 写 `additionalProperties: true`、设置项名不合规、合同 id 前缀不对，在类型检查时就报；`context.services.require` 只收入口 `dependencies` 里声明的键 | SDK 助手的条件类型；`require` 要让激活上下文带上入口的依赖类型，内核 `ActivationContext` 与 SDK 入口的泛型都要改 | 中到大（`require` 一项占大半） |
| B5 构建报错的格式 | F07 | 构建时执行作者模块抛出的错误，按“作者文件:行 + 消息”输出，Vite 的堆栈只在 `--verbose` 时打印；摘要里写出错的文件而不是引入它的文件 | 构建预设与作者命令 | 小 |
| B6 推事件的助手 | F10 | 给远程事件一个助手，管订阅集合、停止时清理与 `onStop`，提供方只写 `emit(值)`；示例与作者文档改用它 | 内核或 SDK 的远程助手、示例 | 小 |
| B7 合同 id 从插件拼 | F11 | 合同 id 由插件对象拼出（例如 `plugin.remoteService({name, …})`），不再手写插件 id | SDK 助手、模板与示例 | 小 |

不做：`locations` 从入口推出（F11 的后半）。插件描述先于入口模块声明，宿主按它决定在哪些实例里装哪一侧的定义；构建已核对两者一致（t14 S5）。

合计：比 t14 小一些，约为它的一半到三分之二。B4 里 `require` 的类型一项改动面最大，可以单独拿出来。

## 当前状态

2026-10-24 建立并完成范围评估，等开发者定范围。

## 下一步

开发者定范围后写 plan.md（autonomous-delivery 的流程：计划、计划审查、实施、实现审查）。
