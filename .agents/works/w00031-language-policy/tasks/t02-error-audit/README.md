---
schema: nbook.task/v2
taskId: t02-error-audit
status: done
updated: 2026-10-27
---

# 错误处理只读审查与通道矩阵

## 目标与范围

只读审查新应用与新包的错误处理，产出现状通道矩阵：每个通道标明现在用什么语言、谁生产、谁消费、是否持久化、旧数据怎么读。前后端分开派审查者（后端 omp，前端 Sonnet）。

通道至少包括：诊断查询、JSONL 日志、握手与跨进程 detail、命令失败通知、工具结果、运行中的 Agent 事件与 SSE（网页投影会丢掉 `details`）、会话 JSONL、QA 记录、CLI 给人看的输出、CLI JSON、nbdev 的 HTTP `errors[].message` 与面板共用的校验函数、Task 证据、测试断言。

另外记下：Error 子类与错误码的现状（各包自定义的码、重名情况），直接显示 `error.message` 或 `reason` 的界面位置。

合同：只读，行为合同未变。

## 当前状态

计划：[plan.md](plan.md)（自主推进，2026-10-27）。计划审查：omp，有效 5 条，都已处理（见计划末尾），报告 `evidences/plan-review-omp.txt`。

已完成（2026-10-27），基线提交 `65d9daea0`：

- **产物**：[artifacts/channel-matrix.md](artifacts/channel-matrix.md)。内容有错误域总表、通道总表、必查表、两边计数并列、给 t03 的问题清单（必须先定 17 条、迁移时注意 4 条）、未追到汇总；第 9 节是主会话的合并核对：8 条高风险链路逐跳核对、前端 5 个随机样本（加后端 5 个，共 10 个，都属实）、两处不一致的裁决、补追到的 1 项、交给 t03 的 8 项未追到。
- **分区报告**：`evidences/audit-backend-omp.txt`（omp）、`evidences/audit-frontend-sonnet.txt`（Claude Sonnet）。机械合并由一个 Sonnet 子代理完成，核对由主会话做。
- **计数脚本与输出**：`scripts/backend/`、`scripts/frontend/`，以及 `evidences/backend-*.json.txt`、`evidences/frontend-*-out.txt`。脚本里写的是当时的临时路径，复现时要先在基线提交上建 worktree，再改路径。

验证：`bun run docs:check`、`bun run governance:check`。

实现审查：omp，有效 6 条（重要 5、建议 1），都已直接改进矩阵正文，见矩阵 9.7 与 `evidences/impl-review-omp.txt`。审查另按哈希抽 5 条“必须先定”回到基线，都相符。

## 下一步

t03 以矩阵第 6 节的“必须先定”和 9.5 交来的未追到项为输入。
