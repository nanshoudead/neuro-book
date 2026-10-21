---
schema: nbook.task/v2
taskId: t02-tailwind-unify
status: active
updated: 2026-10-21
---

# 全仓统一用 Tailwind v4，宿主编译 nb-ui

## 目标与范围

neuro-book 从 UnoCSS 换到 Tailwind v4；nb-ui 不再发预编译产物，提供样式入口由宿主编译；nb-story、dev-panel 改用同一入口；滚动条 token

合同：产品行为合同未变；改的是样式的构建与接入方式，ADR 0023 的前端一条随之修订（见计划 S5）。

## 当前状态

2026-10-20 新建并写了实施计划 [plan.md](plan.md)（含在 master 上实测的改动面）。2026-10-21 开发者确认计划；w00027 t07 的 S2a、S2b 已进 master，开工。

- worktree：`.worktree/w00030-t02-tailwind`，分支 `refactor/w00030-t02-tailwind`

- S0（2026-10-21）：工具 1 到 4 写好，放在分支的 `scripts/nb-ui/tailwind-migration/`；重测的改动面与分层冲突写进计划的“改动面”“分层后结果会翻转的地方”两节（10-20 的初测处数有误，已改）。切片重排为 S1 到 S4，每个提交都能通过验证：nb-ui 产物在 S1 冻结、S2 neuro-book 换掉 UnoCSS 时删除。
- 改前基准截图：开发服务开在固定于 master 的 worktree `.worktree/w00030-t02-baseline`（端口 4317），状态根用 `/tmp/t02/state-template` 的副本（登记了示例作品 `book`）；截图在 `/tmp/t02/before/`（Lab 107 个组件 501 个场景 × 两主题 × 明暗，加 4 个页面 × 明暗）。

## 下一步

基准截完后停掉基准开发服务；派 S1。
