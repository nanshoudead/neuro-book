---
schema: nbook.task/v2
taskId: t02-error-audit
status: active
updated: 2026-10-27
---

# 错误处理只读审查与通道矩阵

## 目标与范围

只读审查新应用与新包的错误处理，产出现状通道矩阵：每个通道标明现在用什么语言、谁生产、谁消费、是否持久化、旧数据怎么读。前后端分开派审查者（后端 omp，前端 Sonnet）。

通道至少包括：诊断查询、JSONL 日志、握手与跨进程 detail、命令失败通知、工具结果、运行中的 Agent 事件与 SSE（网页投影会丢掉 `details`）、会话 JSONL、QA 记录、CLI 给人看的输出、CLI JSON、nbdev 的 HTTP `errors[].message` 与面板共用的校验函数、Task 证据、测试断言。

另外记下：Error 子类与错误码的现状（各包自定义的码、重名情况），直接显示 `error.message` 或 `reason` 的界面位置。

合同：只读，行为合同未变。

## 当前状态

计划：[plan.md](plan.md)（自主推进，2026-10-27 开工）。

2026-10-27 建，未开工。前三轮审查里已发现的通道见 [t01 证据](../t01-adr/evidences/) 的 omp 报告。

## 下一步

计划交 omp 审查（与 t01 的实现审查同一会话），处理后两份分区盘点并行。
