---
schema: nbook.task/v2
taskId: t04-nbook-type-scale
status: done
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
- 全量 e2e 256 例：4 例失败。三例来自本次：活动栏的图标按钮随控件高度长到 42px 后光环被裁（lab-scenes）、菜单行高断言写死 28px、资源管理器拖动用例在 720px 高的窗口里展开几层后没有空白；另一例编辑器光标用例单独重跑通过（偶发）。
- Sonnet 实现审查 11 条（重要 2、建议 9），报告见 [evidences/impl-review-sonnet.txt](evidences/impl-review-sonnet.txt)。修正 `fe2b32ecc`：IconButton 边长改回定值 26/32/38px（F2，同上面的光环被裁）；字号断言改在 macOS 主题下量（F3：nbook 的 sm 与 Tailwind 默认同为 14px，分不出）；JSON 查看器漏改的两处、菜单行的行高、规则 8 补认 `font` 简写与 `.8rem` 等、两份菜单文档与设计语言的残留像素。不改的三条：md 与 lg 两档在本主题同为 14px（靠高度区分）；Kbd、Badge、书架几处按语义取档；提示词输入框按界面文字随刻度变（计划把它列在阅读区里是措辞不准）。改后先前失败的四个 e2e 文件 62 例全过，nb-ui 548 例通过。
- S3 截图：应用六页、Lab 八个组件在 nbook 与 macOS 两个主题下、开发者面板与剧情图谱查看器，改前（master）改后对照；Lab 全部场景无越界与被裁，面板与查看器被截断的元素数与改前相同（面板“在跑”页 44 到 45）。macOS 主题下紧凑档等几处从 12px 变成它自己的 xs 11px，接受。评审板 [artifacts/review](artifacts/review/index.html) v1，题 `t04-accept`。

## 决定

1. 改后的字号可以合入（2026-10-22，评审板 `t04-accept` 答 yes）。

## 下一步

合入 master 后，把 master 合进 w00027 的 Work 分支，t06 在新字号上重出设置界面设计稿。
