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

计划：[plan.md](plan.md)（自主推进，2026-10-27 开工）。

2026-10-27 建。讨论稿 `evidences/design-v1.txt` 到 `design-v3.txt`（第一、二版的“保留内联”已撤销，以 v3 和 Work README 为准），三轮 omp 审查 `evidences/design-review-omp-r1.txt` 到 `r3.txt`；前端审查与独立设计在 [w00028 t01 证据](../../../w00028-i18n/tasks/t01-requirements/evidences/)。

## 下一步

计划交 omp 审查，处理后按切片实施。
