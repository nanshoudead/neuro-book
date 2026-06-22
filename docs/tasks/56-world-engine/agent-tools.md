# World Engine — Agent 工具设计草案

> 本文件是 [README.md](README.md) 的子文档，设计世界引擎暴露给 Agent 的工具集。
> 状态：**第一版已落地，本文记录当前工具契约与后续留口**。底层契约见 [sqlite-and-api.md](sqlite-and-api.md)，模型见 [schema-design.md](schema-design.md)。
> 实现模式对齐现有 `server/agent/tools/plot-tools.ts`：`tool(key, desc, TypeBox-schema, execute)` + `executeWithContext` + session custom state；工具走 `WorldEngineFacade`。

## 0. 背景：逐步取代旧 plot / rag 工具

- Agent 当前用旧 plot 工具（`get_plot_tree` / `create_story_*`…）和 subject RAG 工具（`subject_rag_search` / `subject_event_append` / `subject_memory_update`）维护运行态。
- 世界引擎上线后，**运行态（subject 状态、世界变更）改由世界引擎工具承载**；旧 plot 工具未来转为「故事 → 小说结构」编排（见 README）；旧 rag 工具留待 RAG 单独系统重做。
- **迁移节奏（定论）**：旧工具暂不删除，新工具与之并存；profile 逐步切换到新工具。本文只设计新工具。

## 1. 设计原则

- **查询绝不全量倾倒**：成熟世界有几百 subject、每个几十属性。工具必须支持按 subject / type / 属性投影 / 时刻 / list 长度过滤，由调用参数控制返回量。
- **「获取世界状态」≈「按需 reduce 若干 subject」**：facade 的全量 `getWorldState` 不直接暴露给 agent；agent 走细粒度 `queryState`。
- **写入即切面**：agent 不直接改 subject 状态，只能「写一个切面」（一组 mutation）。补过去 = 传一个更早的项目日历时间，与写当前同一个工具。
- **projectPath 必填**：对齐 plot 工具，agent 显式传 Project Path。
- **时间用项目日历字符串传**：Agent 工具不暴露 raw instant / BigInt；`time` / `at` / `from` / `to` 传 `instant:<number>`、带首尾空白，或解析后超出 SQLite 64 位整数范围都会直接报错。工具层通过项目 Calendar parse/format 转换；底层 facade/calendar 保留 raw instant 和 trim 只用于测试和调试。

## 2. 工具集（第一版）

### 2.1 查询世界状态：`get_world_state`

对应目标 1。本质是按需 reduce 若干 subject。

```
get_world_state(projectPath, {
    subjectIds?: string[],   // 只看这些 subject，如 ["erina","phoenix"]
    type?: string,           // 或按类型，如 "character"
    attrs?: string[],        // 属性投影，如 ["hp","location","mind"]；省略=全部属性
    at?: string,             // reduce 截断时间（项目日历字符串，倒叙/回忆）；省略=最新
    listLimit?: number,      // list/collection 属性最多返回多少条（如 events 取最近 20）
}) -> { subjects: SubjectState[], issues: WorldIssue[] }
```

- 必须传 `subjectIds` 或 `type` 至少其一（防止裸调拉全量）；都省略时报错提示收窄。
- `subjectIds` 如果传入，必须是非空数组且每项唯一；空数组或重复 id 会返回 400，调用方应先去重或修正请求。
- `attrs` 如果传入，必须是非空数组且每项唯一；空数组或重复属性路径会返回 400，调用方应先去重或修正请求。
- `attrs` 中每个 attr path 的路径段必须非空且不能包含首尾空白；点号只作为路径分隔符，不是 schema attr 名的一部分。
- 当项目 schema 已声明 subject types 时，`type` 必须是 schema 内类型；拼错 type 会返回 400，不会静默返回空数组。
- subject type 名不能为空，也不能包含任意空白或括号；工具入参的 `type` 必须直接使用 schema 中的稳定 key，例如 `character`。
- 典型用法：
  - 「主角现在什么状态」→ `{ subjectIds:["erina"] }`
  - 「主角的血量和位置」→ `{ subjectIds:["erina"], attrs:["hp","location"] }`
  - 「所有角色现在在哪」→ `{ type:"character", attrs:["location"] }`
  - 「倒叙：主角 200 年时」→ `{ subjectIds:["erina"], at:"复兴纪元200年 1月1日 00:00:00" }`
- 返回的 `issues` 是当前 reduce 显形的 E 问题（`broken-relative` / `dangling-ref`），必须处理；如果传了 `attrs`，issues 也会跟随属性投影范围收窄。
- 会写 session custom state `world.focus`（最近查询 / 创建的 subjectIds），便于 UI 或后续工具设计读取焦点；第一版工具不会自动从 focus 补 `subjectIds`，裸查询仍会报错。

### 2.2 获取最近世界变更：`list_world_slices`

对应目标 2。

```
list_world_slices(projectPath, {
    limit?: number,          // 最近 N 个切面（默认 5，Agent 工具上限 50），按时间倒序取再正序返回
    from?: string,           // 时间段起（项目日历字符串，含）
    to?: string,             // 时间段止（含）
    withMutations?: boolean, // 是否带每个切面的 mutation 明细，默认 false 只给标题/时间/kind
}) -> SliceSummary[]
```

- 不传 `limit/from/to` 时默认返回最近 5 个，避免把完整 timeline 倾倒给模型；带 `from` 或 `to` 的区间查询不默认截断，需要限制数量时显式传 `limit`。
- 典型用法：
  - 「最近发生了什么」→ `{ limit:5 }`
  - 「488 年风信之月这段发生了什么」→ `{ from:"...", to:"..." }`
  - 「最近 3 个切面的详细变更」→ `{ limit:3, withMutations:true }`

### 2.3 写一个切面（含补过去）：`write_world_slice`

对应目标 3。新增切面与补过去**同一个工具**，由项目日历时间决定落点。

```
write_world_slice(projectPath, {
    time: string,            // 切面时间点（项目日历字符串）。比当前最新早 = 补过去
    title?: string,
    summary?: string,
    kind?: string,           // 默认 event；允许项目自定义，如 backstory；显式传入时不能为空或带首尾空白
    mutations: Array<{
        subjectId: string,
        attr: string,        // "hp" / "equipment.weapon" / "memory.师门"
        op: "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove",
        value?: JSON,        // unset 省略
    }>,                      // 1..100；超出时拆成多个切面
}) -> { sliceId: string, issues: WorldIssue[] }
```

- **补过去**：传一个比当前最新切面更早的 `time`，timeline 自动按底层时间戳归位。第一版即支持（你要求）。
- 写入时按项目 schema 校验 attr/op/value（宽松：未声明属性默认 scalar）。
- `value` 必须是严格 JSON 值：`NaN`、`Infinity`、函数、symbol、`Date` 等非普通对象，或对象 / 数组内部的 `undefined` 会被工具层直接拒绝，不会通过 JSON 序列化静默改成 `null`、字符串或丢字段。
- `kind` 是 timeline 分类标签，省略时默认 `event`；显式传入时不能为空，也不能包含首尾空白。
- `attr` 的路径段必须非空且不能包含首尾空白；如果要写开放 object key，使用稳定段名，例如 `memory.师门`。
- schema 中 `ref(type)` 的 type 必须已声明；写入 `ref(...)` 值时必须是 `subject://<id>`，内部 `<id>` 不能为空或带首尾空白，且目标 subject 必须存在并符合声明 type。
- 写入后返回 `issues`：E 必须修；A（`base-shifted` / `masked`）需要确认语义是否符合预期。

### 2.4 创建 subject：`create_world_subject`

切面要引用 subject，subject 得先存在。

```
create_world_subject(projectPath, {
    id: string,              // 稳定 id，不能为空或带首尾空白，ref 用 subject://<id> 指向它
    type: string,            // schema 类型名
    name?: string,
    time: string,            // subject 起始时刻；有 default 时用于 init mutation 落点
}) -> { subjectId: string, issues: WorldIssue[] }
```

- 如果 schema 定义了 default，生成或追加 kind=init 的初始化 mutation；如果没有 default，只注册 subject 身份，不创建空切面。
- `type` 必须是 schema 中的稳定 subject type key；不能为空，也不能包含任意空白或括号。
- 初始化 mutation 同样遵守单切面 100 条上限；如果 `time` 对应的 `kind=init` slice 已存在，追加后的总 mutation 数超过 100 会返回 400，调用方需要调整 schema default 或拆分初始化设计。
- 如果 `time` 对应的是非 init slice，工具会返回 409，不会把 subject 初始化悄悄追加进普通事件；调用方应使用 `edit_world_slice` 显式合并，或选择其他初始化时间。
- `id` 必须全局唯一；重复 id 会返回 409，调用方应改用已有 subject 或换新 id，不做 upsert。
- `id` 会进入 `subject://<id>` 引用 URI，工具拒绝空白或带首尾空白的 id；调用方应先修正用户输入再创建 subject 或写入引用。
- world subject 的 `time` 传项目 Calendar 零点示例即可锚定纪元（见 worked-example §3）。

### 2.5 删除切面：`delete_world_slice`

用于第一版最小回退。物理删除，不可恢复。

```
delete_world_slice(projectPath, {
    sliceId: string,
}) -> { issues: WorldIssue[] }
```

- `sliceId` 是后端返回的稳定 id，调用方必须原样传回；不能为空，也不能带首尾空白。
- 删除后返回受影响 subject 最新 reduce 出来的 E issues。
- 如果删除了某个相对 op 的基准切面，后续 `add` / `listAppend` / `collection*` 可能显形 `broken-relative`。

## 3. 与 schema 的关系

- 工具需要项目 schema（`world-engine/schema.yaml`）来校验 mutation、决定 reduce 语义、生成 `get_world_state` 的属性投影提示。
- schema 由 facade 在 projectPath 上下文加载（读 `world-engine/schema.yaml`）；工具层不直接读文件。
- `get_world_schema` 已接入，用于让 agent 在写入前查看当前项目有哪些 subject 类型、属性、op/value 约束和默认值。
- schema default 的纯形状 / 类型错误会在 schema 加载期报错；ref default 的目标 subject 是否存在仍在 `create_world_subject` 写入 init mutation 时校验。

## 4. 当前状态与遗留待定

- 已接入 `get_world_state`、`list_world_slices`、`write_world_slice`、`edit_world_slice`、`delete_world_slice`、`create_world_subject`、`get_world_schema`、`list_world_subjects`。
- `write_world_slice` / `edit_world_slice` / `delete_world_slice` 会返回 `issues`；E 必须修，A 需确认语义。
- `write_world_slice` 不自动合并同一时间点；目标时间已有切面时，agent 应改用 `edit_world_slice`。
- `edit_world_slice` / `delete_world_slice` 的 `sliceId` 必须使用后端返回值原样传回；空 id 或带首尾空白的 id 会返回 400。
- `edit_world_slice` 的 `mutations` 顺序是 reduce 语义的一部分；同一切面内共同保留的相关 mutation 发生顺序反转时，可能返回下游 `base-shifted` / `masked`，即使同次编辑还新增 / 删除了无关 mutation。
- 已有：`get_world_state` 显式 subjectIds 查询和 `create_world_subject` 会写 `world.focus`；后续再决定是否让工具读取它作为默认焦点。
- 待定：工具是否需要审批（写切面是否要 approval）；第一版倾向不审批，对齐 plot 工具直接写。
- 待定：旧 plot/rag/simulation 工具的退场顺序。
