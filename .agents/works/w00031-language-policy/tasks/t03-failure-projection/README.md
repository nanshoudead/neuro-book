---
schema: nbook.task/v2
taskId: t03-failure-projection
status: planned
updated: 2026-10-27
---

# 失败投影与切片设计

## 目标与范围

依据 t02 的通道矩阵，设计“给用户看的失败投影”，并把开发诊断改英文按错误域与通道切片（不按包）：

- 码从哪来；插件自定义的失败码怎么带文案（消息键是拥有者命名空间加码，文案在拥有者的目录里）；未知码显示通用说明并附码；
- `NotificationInput`、命令结果的 `reason`、跨进程 detail 这些字符串槽改成码加结构化参数；
- 共用的校验函数（例如 nbdev 后端与面板共用的中文校验）改成返回问题码加参数，CLI 与网页各自拼文字；
- 领域工具在 `details` 里给结构化 `code`，按码写中文说明；harness 只保证 `isError`、原样记录、字段不丢；
- `nbstory` 分三层：提示词与工具说明、给人看的输出（中文产品文案）、`--json` 与 API 的 `message`（要版本化，或拆成 `message` 与 `detail`）；
- 旧持久化数据怎么读；不按旧文案猜码；
- 诊断构造入口带类型，机检检查入口而不是按中文判断。

产出：提案与 Spec 修改，切片清单与每片的验收（直接消费者、真实子进程、会话与 QA 读回、CLI JSON）。

合同：会改 [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 的失败结果、[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 的工具结果、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md) 的 JSON 输出等；开工时补全清单。

## 当前状态

2026-10-27 建，未开工；依赖 t02 和 w00028 t01 的目录机制。

## 下一步

t02 交付后开工。
