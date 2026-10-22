---
schema: nbook.task/v2
taskId: t04-nbook-type-scale
status: planned
updated: 2026-10-22
---

# NeuroBook 主题字号恢复大一档

## 目标与范围

NeuroBook 主题的字号与控件高度恢复成 2026-09-01 以前那一档（界面正文 14px、控件 28/34/42px），写死像素的字号逐处归档，界面无溢出与截断；之后 w00027 t06 在新字号上重出设置界面设计稿

行为合同不变：没有产品 Spec 写字号；改的是 nb-ui 的 NeuroBook 主题与 `packages/nb-ui/docs/` 的设计语言。计划见 [plan.md](plan.md)。

来由：2026-10-22 开发者看 w00027 t06 的设置界面觉得字小；实测字小来自 2026-09-01 `14b316ee2` 把主题收回 macOS 档，开发者定恢复那次之前的一档（界面正文 14px、控件 28/34/42px），不照搬 Tailwind 默认（它的 lg 是 18px，也没有 2xs、md 两档）。

## 当前状态

2026-10-22 计划初稿已写，等开发者确认。

## 下一步

开发者确认计划后，从 master 开 worktree `.worktree/w00030-t04-type-scale`（分支 `refactor/w00030-t04-type-scale`）按切片实施。
