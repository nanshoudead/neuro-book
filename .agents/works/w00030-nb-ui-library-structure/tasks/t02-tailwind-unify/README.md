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

## 下一步

S0：写工具、截改前基准、重跑改动面统计。
