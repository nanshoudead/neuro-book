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

2026-10-27 计划写好，开始实施 S1。

## 下一步

按 plan.md 的切片 S1 到 S5 实施，收口后派 Sonnet 做实现审查；版本改成 0.11.1 后停下，发布交开发者。
