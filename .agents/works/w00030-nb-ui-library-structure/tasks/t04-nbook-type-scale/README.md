---
schema: nbook.task/v2
taskId: t04-nbook-type-scale
status: active
updated: 2026-10-22
---

# NeuroBook 主题字号恢复大一档

## 目标与范围

NeuroBook 主题的字号与控件高度恢复成 2026-09-01 以前那一档（界面正文 14px、控件 28/34/42px），写死像素的字号逐处归档，界面无溢出与截断；之后 w00027 t06 在新字号上重出设置界面设计稿

行为合同不变：没有产品 Spec 写字号；改的是 nb-ui 的 NeuroBook 主题与 `packages/nb-ui/docs/` 的设计语言。计划见 [plan.md](plan.md)。

来由：2026-10-22 开发者看 w00027 t06 的设置界面觉得字小；实测字小来自 2026-09-01 `14b316ee2` 把主题收回 macOS 档，开发者定恢复那次之前的一档（界面正文 14px、控件 28/34/42px），不照搬 Tailwind 默认（它的 lg 是 18px，也没有 2xs、md 两档）。

## 当前状态

2026-10-22 开发者确认计划后开工，worktree `.worktree/w00030-t04-type-scale`（分支 `refactor/w00030-t04-type-scale`）。

- S1 `4ef1c5ba0`（nb-ui）：主题刻度与控件高度、菜单行 30px；Button、IconButton 的 sm/md/lg 高度改取 `--control-h-*`（计划外的补充：Button 原来写死 26/32/38px，只改主题的控件高度会让按钮与输入框差 2px）；八个组件与菜单行的字面像素字号改取 `--text-*`；token 扫描加规则 8（组件不写字面像素字号，红翻转验证过）；设计语言与开发规范改写。nb-ui 548 个测试、类型检查通过。
- S2 `e1d462197`（应用）：46 处界面文字的字面字号改取 `--text-*`；书架与欢迎页只改小号说明文字；宿主加载页与失败页、阅读区不动。`test:affected --since master --typecheck --with-consumers` 全过（应用 Bun 1599、Vitest 403 等）。
- 更正：开工前以为 Tailwind 重构（t02）没改字号，只对用主题字号的设置窗口与书架成立；t02 的记录写明应用里直接写 `text-sm` 的 37 处从 14px 变 13px、`text-xs` 的 57 处变成主题的 11px。新刻度把它们恢复成 14px、12px。
- 进行中：全量 e2e；Sonnet 实现审查。

## 下一步

处理审查；S3 截改前改后对照（工作台、书架、设置窗口、Lab、开发者面板、剧情图谱查看器）发评审板，开发者看过再合入 master；之后 w00027 t06 合 master、重出设置界面设计稿。
