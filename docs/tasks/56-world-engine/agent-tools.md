# World Engine — Agent 工具设计草案

> 本文件是 [README.md](README.md) 的子文档，设计世界引擎暴露给 Agent 的工具集。
> 状态：**草案 / 讨论中**。底层契约见 [sqlite-and-api.md](sqlite-and-api.md)，模型见 [schema-design.md](schema-design.md)。
> 实现模式对齐现有 `server/agent/tools/plot-tools.ts`：`tool(key, desc, TypeBox-schema, execute)` + `executeWithContext` + session custom state；工具走 `WorldEngineFacade`。

## 0. 背景：逐步取代旧 plot / rag 工具

- Agent 当前用旧 plot 工具（`get_plot_tree` / `create_story_*`…）和 subject RAG 工具（`subject_rag_search` / `subject_event_append` / `subject_memory_update`）维护运行态。
- 世界引擎上线后，**运行态（subject 状态、世界变更）改由世界引擎工具承载**；旧 plot 工具未来转为「故事 → 小说结构」编排（见 README）；旧 rag 工具留待 RAG 单独系统重做。
- **迁移节奏（定论）**：旧工具暂不删除，新工具与之并存；profile 逐步切换到新工具。本文只设计新工具。

## 1. 设计原则

- **查询绝不全量倾倒**：成熟世界有几百 subject、每个几十属性。工具必须支持按 subject / type / 属性投影 / 时刻 / list 长度过滤，由调用参数控制返回量。
- **「获取世界状态」≈「按需 reduce 若干 subject」**：facade 的全量 `getWorldState` 不直接暴露给 agent；agent 走细粒度 `queryState`。
- **写入即切面**：agent 不直接改 subject 状态，只能「写一个切面」（一组 mutation）。补过去 = 传一个更早的日历字符串，与写当前同一个工具。
- **projectPath 必填**：对齐 plot 工具，agent 显式传 Project Path。
- **时间用「日历字符串」传，不传数字**：LLM 不应处理 instant 秒数（如 `"15151500000"`），而是用人类可读的日历字符串（如 `"复兴纪元488年 风信之月15日 14:00"`）。工具层负责 string ↔ instant 双向转换，facade / 存储 / reduce 仍只认 `instant: bigint`。
- **Calendar 进入第一版工具层**：第一版只要求项目 canonical 格式 parse/format 对称可逆；完整自定义历法、模糊时间和复杂自然语言时间可后续再做。

## 2. 工具集（第一版）

### 2.1 查询世界状态：`get_world_state`

对应目标 1。本质是按需 reduce 若干 subject。

```
get_world_state(projectPath, {
    subjectIds?: string[],   // 只看这些 subject，如 ["erina","phoenix"]
    type?: string,           // 或按类型，如 "character"
    attrs?: string[],        // 属性投影，如 ["hp","location","mind"]；省略=全部属性
    at?: string,             // reduce 截断时间（日历字符串，倒叙/回忆）；省略=最新
    listLimit?: number,      // list/collection 属性最多返回多少条（如 events 取最近 20）
}) -> SubjectState[]
```

- 必须传 `subjectIds` 或 `type` 至少其一（防止裸调拉全量）；都省略时报错提示收窄。
- 典型用法：
  - 「主角现在什么状态」→ `{ subjectIds:["erina"] }`
  - 「主角的血量和位置」→ `{ subjectIds:["erina"], attrs:["hp","location"] }`
  - 「所有角色现在在哪」→ `{ type:"character", attrs:["location"] }`
  - 「倒叙：主角 200 年时」→ `{ subjectIds:["erina"], at:"复兴纪元200年" }`
- 写 session custom state `world.focus`（最近查询的 subjectIds），便于后续工具省略参数（对齐 plot.selection 思路）。

### 2.2 获取最近世界变更：`list_world_slices`

对应目标 2。

```
list_world_slices(projectPath, {
    limit?: number,          // 最近 N 个切面（默认如 5），按 instant desc 取再正序返回
    from?: string,           // 时间段起（日历字符串，含）
    to?: string,             // 时间段止（日历字符串，含）
    withMutations?: boolean, // 是否带每个切面的 mutation 明细，默认 false 只给标题/时间/kind
}) -> SliceSummary[]
```

- 典型用法：
  - 「最近发生了什么」→ `{ limit:5 }`
  - 「488 年风信之月这段发生了什么」→ `{ from:"...", to:"..." }`
  - 「最近 3 个切面的详细变更」→ `{ limit:3, withMutations:true }`

### 2.3 写一个切面（含补过去）：`write_world_slice`

对应目标 3。新增切面与补过去**同一个工具**，由 time 经 Calendar parse 后的 instant 决定落点。

```
write_world_slice(projectPath, {
    time: string,            // 切面时间点（日历字符串）。比当前最新早 = 补过去
    title?: string,
    summary?: string,
    kind?: "event" | "init" | "correction" | "bootstrap",  // 默认 event；补过去建议 correction
    mutations: Array<{
        subjectId: string,
        attr: string,        // "hp" / "equipment.weapon" / "memory.师门"
        op: "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove",
        value?: JSON,        // unset 省略
    }>,
}) -> { sliceId: string }
```

- **补过去**：传一个比当前最新切面更早的 `time`，timeline 自动按 instant 归位。第一版即支持，并触发受影响 subject 的 re-settle。
- **同 instant 合并**：如果 `time` 解析后的 instant 已有 slice，第一版默认把 mutations 合并进已有 slice；同一 instant 不创建第二个切面。title / summary / kind 的合并策略仍待定。
- 写入时按项目 schema 校验 attr/op/value（宽松：未声明属性默认 scalar）；`set` 的 old 由 facade 结算。
- 写入后可顺带返回受影响 subject 的最新精简状态（便于 agent 确认结果），或仅返回 sliceId（待定，见 §4）。

### 2.4 创建 subject：`create_world_subject`

切面要引用 subject，subject 得先存在。

```
create_world_subject(projectPath, {
    id: string,              // 稳定 id，ref 用 subject://<id> 指向它
    type: string,            // schema 类型名
    name?: string,
    time: string,            // 初始化切面的时间（日历字符串，subject「出生」时刻）
}) -> { subjectId: string }
```

- 生成 kind=init 的初始化切面，写 schema default 初值。
- world subject 的 `time` 传项目日历的纪元起点字符串（如 `"复兴纪元1年"`）即锚定 instant=0（见 worked-example §3）。

## 3. 与 schema 的关系

- 工具需要项目 schema（`world-engine/schema.yaml`）来校验 mutation、决定 reduce 语义、生成 `get_world_state` 的属性投影提示。
- schema 由 facade 在 projectPath 上下文加载（读 `world-engine/schema.yaml`）；工具层不直接读文件。
- agent 是否需要一个 `get_world_schema` 工具来查看「这个世界有哪些 subject 类型 / 属性」？倾向**需要**（类似 `get_agent_profile` 让 agent 自省），便于 agent 写出合法 mutation。列入 §4 待定。
- Calendar 由 facade / service 在 projectPath 上下文加载（读 `world-engine/calendar.yaml` 或默认配置）；工具层只负责把 Agent 输入输出映射为人读时间。

## 4. 遗留待定

- `write_world_slice` 返回 sliceId 即可，还是顺带返回受影响 subject 的精简新状态。
- 同 instant 合并时，已有 slice 与新输入的 title / summary / kind 如何合并，是否需要返回合并提示。
- 是否加 `get_world_schema`（让 agent 查看 subject 类型 / 属性定义）。
- `world.focus` session custom state 的具体形状与复用范围。
- 工具是否需要审批（写切面是否要 approval）；第一版倾向不审批，对齐 plot 工具直接写。
- 编辑 / 删除 / 回退切面的 agent 工具（第一版不做，对齐 facade 待定项）。
- 把这些工具接入哪个 / 哪些 profile（simulator.leader 之类），以及旧 plot/rag 工具的退场顺序。
