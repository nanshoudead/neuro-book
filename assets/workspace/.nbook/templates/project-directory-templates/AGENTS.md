# Project Agent Instructions

本文件是当前 Project Workspace 的项目级 Agent 入口。所有 profile 先遵守本文件，再遵守自己的 `agent-context/{profile}/context.md`、`agent-context/{profile}/memory.md` 与 `agent-context/{profile}/generated.md`。

## Reading Order

1. 先读取本文件。
2. 再读取当前 profile 自己的 `agent-context/{profile}/context.md`，如果存在。
3. 再读取当前 profile 自己的 `agent-context/{profile}/memory.md`，如果存在。
4. 再读取当前 profile 自己的 `agent-context/{profile}/generated.md`，如果存在。
5. 只在任务需要时读取 `lorebook/`、`manuscript/`、`simulation/`、`reference/` 或 Plot System。

不要自动读取其他 profile 的 `agent-context/` 文件，也不要读取 `.nbook/context-access/`；后者是程序私有状态。

## Directory Boundaries

- `lorebook/` 保存稳定设定、世界规则、角色/地点/势力/物品资料和可复用 AI instruction。
- `manuscript/` 保存正式正文、卷章节点和章节草稿。
- `simulation/` 只保存世界运行态：`subjects/`、`entities/`、`runs/`。
- `agent-context/` 按 profile 保存运行上下文、跨 session memory 和程序生成的 context recommendations。
- `reference/` 保存外部素材、导入归档和低置信迁移材料；除非整理进 `lorebook/`、`manuscript/` 或 `simulation/`，否则不要当成已确认 canon。
- `.nbook/` 保存项目配置、Project SQLite 和程序私有状态；不要把故事设定写入这里。

## Information Boundaries

- 需要区分上帝视角 canon、角色可知信息、当前状态和用户可见正文。
- `simulator.leader` 可以读取 god-view lorebook 与 runtime state，并负责过滤后再交给 `simulator.actor` 或 `rp.writer`。
- `simulator.actor` 只消费 sidecar 注入的 actor-safe context 和本轮 actor-facing message，不自行遍历 lorebook、reference 或其他 subject。
- `rp.writer` 只消费 simulator leader 的 writer brief 和 `agent-context/rp.writer/context.md`，不自行遍历 `simulation/` 或 god-view lorebook。
- 普通 `writer` 只写指定章节，使用调用方显式传入的 chapter、Plot 和 lorebook entries。

## File Changes

- 修改文件前先确认目标目录归属，不把 profile policy 写进 `simulation/`。
- 当前状态写入 `simulation/subjects/`、`simulation/entities/` 或 Plot System；长期稳定设定写入 `lorebook/`。
- 正文写作只写明确指定的 `manuscript/.../index.md` 或 brief 指定输出路径。
- 对核心设定、不可逆世界状态、主要角色命运或大范围目录结构变更，除非用户本轮明确授权，否则先说明计划并请求确认。
