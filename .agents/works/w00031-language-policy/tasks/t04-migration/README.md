---
schema: nbook.task/v2
taskId: t04-migration
status: planned
updated: 2026-10-27
---

# 错误与诊断迁移

## 目标与范围

按 t03 的切片执行：失败说明改成按码本地化，开发诊断改英文。每片同时改消费者、持久化兼容读取和测试（按码或结构断言）；`test:affected` 只用来挑测试，不当作完整性证明。

粗估规模（2026-10-27 grep，排除清单外的非测试源码约 1387 个文件、20.7 万行）：带中文的 `new XxxError` 约 1035 处，日志与诊断约 211 处，`reason`、`message`、`detail` 字段约 791 处（有重叠）；测试里断言中文的约 369 个文件。工期等 t03 切片后重估。

不在本 Task：现有英文工具说明与命令 `description` 的语言（等 t05）。

合同：按 t03 列出的 Spec，起点是 [`runtime/diagnostics.md`](../../../../../docs/specs/runtime/diagnostics.md) 与 t03 的清单。

## 当前状态

2026-10-27 建，暂不开工。开工前要有 t02 的通道矩阵与 t03 的切片设计。

## 下一步

t03 定稿后修订本 Task 的范围与切片。
