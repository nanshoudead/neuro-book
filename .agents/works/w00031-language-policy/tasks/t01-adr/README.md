---
schema: nbook.task/v2
taskId: t01-adr
status: active
updated: 2026-10-27
---

# 语言政策 ADR

## 目标与范围

把 [Work README](../../README.md) 的“开发者已确认的决定”写成 `docs/adr/0034-language-policy.md`（编号以写时的下一个空闲号为准）。

- ADR 只写稳定的语言分层、目录与错误投影的边界、几处例外，以及每条的理由、被否决的做法与代价；目录登记、回退链、类型检查、旧会话读取这些细节交给 Spec 与 w00028（第三轮后端审查第 5 条）。
- 正文写明取代 ADR 0023 的“前端使用 vue-i18n”一项，0023 保持 `accepted`、正文不改。`docs/adr/README.md` 补一条部分取代的写法，沿用 0028、0031 的先例。
- `docs/standards/code/common.md` 加“语言”一节：只写规则入口，链接 ADR。
- 影响清单：要随政策更新的真相源。至少包括相关 Spec 的输出与失败表、`docs/specs/agent/harness.md`、`packages/nb-harness/AGENTS.md`、`packages/nb-harness/docs/omp-capabilities.md`（引用 OMP 例外），以及 nb-story、dev-panel 的包级文档。命令 `description` 暂不改（等 t05）。
- 消息键与错误码：消息键写成“拥有者命名空间 + 码”，不直接拿码当键（第三轮后端审查第 1 条）。

合同：只改 ADR 与规范，行为合同未变。

## 当前状态

计划：[plan.md](plan.md)（自主推进，2026-10-27）。计划审查：omp，有效 3 条、另采纳初稿 5 条，处理见计划末尾；报告 `evidences/plan-review-omp.txt`。

已完成（2026-10-27）：

- `651acb420`：[ADR 0034](../../../../../docs/adr/0034-language-policy.md)；ADR README 补部分取代的写法、索引加 0034、0023 一行补注。
- `7c43aa277`：`docs/standards/code/common.md` 加“文字用哪种语言”；`packages/nb-harness/AGENTS.md` 与 `docs/omp-capabilities.md` 链接 ADR 0034 决策 4。

验证：`bun run docs:check`、`bun run governance:check` 的 `failures` 为空，没有本次改动的警告。

实现审查：omp（与 t02 计划审查同一会话），有效 2 条，都已处理（`d98265c6e`）：诊断不本地化的理由改为本项目自己的取舍、去掉“vim、git 都不翻诊断”的不准确概括；后果表补上 `runtime/plugin-channel.md`、`runtime/server-host.md` 与远程路由，交 t03。撤回的 3 条见报告 `evidences/impl-review-omp.txt` 的勘误。

讨论稿与讨论期审查：`evidences/design-v1.txt` 到 `design-v3.txt`（以 v3 为准），`design-review-omp-r1.txt` 到 `r3.txt`；前端审查与独立设计在 [w00028 t01 证据](../../../w00028-i18n/tasks/t01-requirements/evidences/)。

## 下一步

待确认清单里 t01 的一条等开发者追认。
