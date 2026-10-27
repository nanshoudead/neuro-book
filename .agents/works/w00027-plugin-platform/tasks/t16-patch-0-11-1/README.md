---
schema: nbook.task/v2
taskId: t16-patch-0-11-1
status: active
updated: 2026-10-27
---

# 0.11.1 补丁：真实用户冒烟的缺陷与小改进

## 目标与范围

修 t15 发布后真实用户冒烟发现的缺陷 2 到 5 与改进 1、5 到 9，发 0.11.1

合同：[`workbench.bookshelf`](../../../../../docs/specs/workbench/bookshelf.md) 输出 11（新建后打开）、[`runtime.cli`](../../../../../docs/specs/runtime/cli.md)（停止后的提示）；其余是实现与文档的修正，行为合同不变。计划 [plan.md](plan.md)。

来源：[t15 的真实用户冒烟](../t15-author-api-round2/evidences/p3-user-smoke.md)。开发者 2026-10-27 定：新建章节、中文短名、插件重启入口先记下（Work README 后续事项），其余一次做完；autonomous-delivery 推进，审查只派一个 Sonnet，不用 omp。按任务大小跳过计划审查，Sonnet 做实现审查。

## 当前状态

进展：

- S1 `08c5040da`：`nbook` 停止后在标准错误写“NeuroBook 已停止。”（`runServerProcess` 加 `onStopped`，启动失败不调）；帮助按 `Bun.stringWidth` 对齐（commander 的 `displayWidth`）；作者构建预设关掉 `checks.pluginTimings`（只在构建慢时出现，没有稳定的测试）。验证：`bun test src/cli` 20 例，帮助对齐的断言做了变异检查。
- S2 `3342d9d4f`：内核把正常关闭带来的撤回（`receiver-closed`、`scope-closed`、`activation-stopped`）记 debug，失败撤回仍 warn；工作台入口停止后外壳加载失败记 debug。验证：nb-runtime 诊断 15 例；开发服务里从书架点进作品，控制台的 error 与 warn 从 20 条变成 0 条（改回旧代码对照）。
- S3 `1d6791e87`：新建作品写完封面与作品目录后打开它；插件页的内置插件按界面语言显示名称与说明（`builtin-names.ts`，表里不含只在开发模式出现的 Lab：`check:dist` 不许生产产物里有它的名字）。验证：插件页 DOM 16 例、名称表对照产品清单、书架与插件 e2e（书架窄屏那例原先碰巧依赖一部没打开过的书，改成任一新鲜度说明）。Spec `6f39221eb`。
- S4 `23f34d66c`：nb-story 的 `GraphLayout` 挪进 `src/web/graph/layout.ts`，typecheck 恢复。验证：nb-story typecheck 与测试（负载 19 时两例 5 秒超时，单独重跑 22 例过）。
- S5 `a342d7f36`：0.11.1；两个 npm 包补 keywords、homepage、bugs，应用包描述改中文；README 写明没有文档目录时的作品目录；发布文档写明 Bun 的 bin 警告无害。验证：打包测试 68 例。
- 收口：`test:affected --since 9f8b355af --typecheck` 在负载 30 时一例 Markdown DOM 测试超时，单独重跑过；全量 e2e 排队等负载降下来；实现审查（Sonnet）已派出。

## 下一步

按 plan.md 的切片 S1 到 S5 实施，收口后派 Sonnet 做实现审查；版本改成 0.11.1 后停下，发布交开发者。
