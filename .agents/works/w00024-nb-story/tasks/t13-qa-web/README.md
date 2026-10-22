---
schema: nbook.task/v2
taskId: t13-qa-web
status: planned
updated: 2026-10-21
---

# nb-story 网页问答页与设置页

## 目标与范围

把内置问答接进网页查看器：书内问答页（对话列表、流式对话视图、可停止、可追问）、问答配置的设置页与服务端的问答运行和接口；顺带把查看器里手写的抽屉、搜索浮层、表格、重试按钮换成 nb-ui 组件。对话视图用 w00019 做的 `nb-agent-ui`（决定 11）。依赖 t08（已完成）与 w00019 的 [t10](../../../w00019-agent-conversation-view/tasks/t10-migrate-nb-agent-ui/README.md)、[t11](../../../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)。

合同：改 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md) 的“不做问答”，[`story/qa.md`](../../../../../docs/specs/story/qa.md) 补网页入口；对话视图的合同参照已归档的 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md)（w00019），开工时按搬进来的部分重新确认。

## 决定

开发者 2026-10-21 定：

1. 问答接进网页，当作 neuro-book 主应用接入 Agent 对话的预演；w00019 的对话组件已经调整过一轮，在此基础上做。
2. 要有连续对话与简单的网页配置界面；连续对话与 `answer` 改成可选放在 t08 先做，本 Task 接在 t08 之后。
3. 组件位置：通用零件进 nb-ui（`useStreamScroll`、可折叠的行与卡片、`CodeBlock`）；消息类型、分轮、对话视图与工具渲染的注册表单独建包 `nb-agent-view`，建在 nb-ui 之上。Markdown 显示与输入框编辑器由宿主经注册表注入（nb-story 先用简单实现，以后 neuro-book 接 `nbook.markdown` 的 `MarkdownDisplay`、`PromptEditor`）。
4. 这次只收问答页要用的 nb-ui 零件；其余候选记入 Work README 的“后续安排”，按 w00029、w00030 的顺序另做，避免和 w00030 的结构整理撞车。
5. 查看器里手写了 nb-ui 已有控件的几处（手机与平板的抽屉、搜索浮层、`story-table`、重试与加载中）并进本 Task 一起换。

注意力排序（开发者 2026-10-21 定）：

6. **位置**：书里导航新加一页“问答”，占主区；宽屏时对话列表是主区左侧一栏，平板与手机收进顶部的“对话”下拉。答案里的出处与人名照常在右侧抽屉打开，不离开对话。（先选过“放在抽屉”，随后改为独立一页。）
7. **过程**：运行中逐步展开，每一步一行实时列出；一轮结束后整轮过程收成一行摘要，只露出答案或文字回复。这一条改掉 w00019 的“思维链运行中也不自动展开”（归档 [`ui/agent-conversation-view.md`](../../../../../docs/archived/specs/ui/agent-conversation-view.md) 的“展开与折叠”）：问答一轮要一到六分钟，等待时要看得到进展。
8. **答案卡片**：常显结论类型、结论、“谁知道什么”的表或分点、一行可点的依据出处；展开说明与覆盖范围收起，点“详细”展开。文字回复按 Markdown 显示，没核实的出处在下面用提醒色列出。
9. **阅读位置不同的对话照常显示**：查看器的阅读位置拨到某个对话的位置之前，这个对话也不拦、不藏，只在对话顶上写它读到哪里。新对话用查看器当前的阅读位置。
10. **设置页**：独立一页（地址 `/settings`），书架右上角与书里顶栏的菜单都能进入；管整份配置（模型、问答、抽取模型），与 `nbstory config` 是同一份文件。密钥本身不显示、不能填，只写服务启动时那个环境变量有没有值；有“测试连接”。

对话视图（开发者 2026-10-21 定）：

11. 包名改为 `nb-agent-ui`（决定 3 的 `nb-agent-view` 作废）。对话视图做完整版、先一次迁完，工作移到重新打开的 w00019：[t10 迁移](../../../w00019-agent-conversation-view/tasks/t10-migrate-nb-agent-ui/README.md)、[t11 补齐](../../../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)。顺序是迁移、补齐、再做本 Task；本 Task 只留问答页、设置页、服务端接口与换手写控件。
12. nb-form、nb-agent-ui 与 nb-ui 一样在新应用的 Lab 里看。

## 当前状态

- 2026-10-21 经 nbdev 新建。
- 2026-10-21 t08 完成后开始设计：定了注意力排序与设置页（决定 6 到 10）。计划初稿 [plan.md](plan.md) 写成后，开发者把对话视图改为完整版并移到 w00019（决定 11、12）；初稿里 nb-agent-view 与 nb-ui 零件的部分作废，等 w00019 t11 完成后按本 Task 剩下的范围改写，再给开发者确认。

## 下一步

等 w00019 t10、t11 完成后改写 plan.md。
