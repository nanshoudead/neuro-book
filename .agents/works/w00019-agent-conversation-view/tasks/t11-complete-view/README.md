---
schema: nbook.task/v2
taskId: t11-complete-view
status: planned
updated: 2026-10-22
---

# 对话视图补齐

## 目标与范围

按归档的 ui/agent-conversation-view.md 补齐从没做过的部分：顶栏、状态栏、待处理区、横幅、提问向导、就地编辑、分支、模式与 Workflow、面板与弹窗

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（t10 从归档搬回）；做完由开发者决定能否晋升 implemented。

依赖 t10。开发者 2026-10-21 定按归档 Spec 做完整版，作为主应用接入 Agent 对话的预演。

### t10 质量审查转来的事项（开发者 2026-10-22 定）

t10 收尾时派了三个 Sonnet 从可维护性、API 形状、易用性与缺失审查 nb-agent-ui（报告在 t10 的 `evidences/`）。第一类在 t10 改完，第二类是 [t13](../t13-agent-ui-api/README.md)（接口整理，t11 之前做），第三类转到这里：

- **接上没有消费者的扩展点**：注册表里 `entries`、`headerActions`、`panels`、`trayItems`、`statusItems` 已有类型与合并规则，视图还没读取，登记了不会显示也没有提示。t11 做顶栏、面板、待处理区、状态栏与信息条目时逐个接上，不隐藏、不删。
- **S8 验收加做**：
  - 无障碍：消息流 `role="log"` 与 `aria-live`（只播报最终回复与需要回答的提问）；从消息流一键跳到输入框的键盘入口。
  - 停止、复制的反馈：点了停止到运行真正结束之间、复制成功或失败，都要有可见的反馈。
  - Lab 夹具：每个组件在 `fixtures/nb-agent-ui/index.ts` 里登记三遍、宿主逻辑与 `later()` 各写一份，收成一处。
  - 开发期提示：零件单独挂载而上层没有 `provideAgentView` 时静默回退中文与缺省组件，开发期给一条警告。
  - 消息操作条：插件多登记几个操作时，按 `order` 取前几个行内显示，其余进“更多”菜单（t10 只让窄屏时先去掉回复时间）。

### t13 转来的事项（开发者 2026-10-22 定）

- `ctx.usage` 的汇总函数随状态栏做，口径（上下文 tokens 按哪条消息算）到时一起定。
- nb-story 文字回复下面“没核实的出处”要靠条目渲染器（`entries`），随扩展点接上。
- Lab 里的 `answer` 结果节点（`fixtures/nb-agent-ui/domain-tools.ts`、`LabAnswerNode.vue`）是替 nb-story 登记的替身；nb-story 或主应用的 Agent 插件真正接入对话视图时由它们登记，Lab 改为引用。

## 当前状态

2026-10-21 经 nbdev 新建，尚未开工。

## 下一步

t10 完成后写 `plan.md`。
