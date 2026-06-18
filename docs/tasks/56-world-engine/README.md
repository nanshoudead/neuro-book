# World Engine (世界引擎)

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [schema-design.md](schema-design.md)：subject schema 字段格式与完整魔幻世界示例（草案）。
- [sqlite-and-api.md](sqlite-and-api.md)：Project SQLite 表结构与世界引擎 API 契约（草案）。
- [agent-tools.md](agent-tools.md)：世界引擎暴露给 Agent 的工具集设计（草案）。
- [worked-example.md](worked-example.md)：奇幻世界从模板创建到演化 1 tick 的完整实例（验证模型自洽）。
- [reference/content/simulation.md](../../../reference/content/simulation.md)：当前 `simulation/` 目录规范（events.jsonl / memory.jsonl / subjects / entities / runs）。
- [reference/content/subjects.md](../../../reference/content/subjects.md)：subject 六文件分工与 RAG 机制。
- [reference/plot/system.md](../../../reference/plot/system.md)：当前 Plot 系统规范（作者视角剧情结构）。
- [docs/tasks/42-simulation-rollback-mechanism/README.md](../42-simulation-rollback-mechanism/README.md)：现有 simulation 回滚方案。
- [docs/tasks/43-subject-rag-memory/README.md](../43-subject-rag-memory/README.md)：subject 记忆 RAG。

## User Request / Topic

- 设计一个「世界引擎」来取代当前的 `plot + simulation(events.jsonl + memory.jsonl)` 组合。
- 第一版**不考虑无时间的情况**（不存在「有空间无时间」的设定）。允许倒叙、回忆等叙事手法，但底层世界时间是**连续、线性、单调前进**的。
- 核心概念：**时间线 timeline + 时间刻 / 切面（slice / entry）**。切面用于标注一个重要时间节点，记录该节点上各 subject 的状态变化。
- 架构要灵活：任意时刻的**世界状态**都可以由「该时刻之前的所有切面」reduce 计算得来。例如倒叙看 3 月，就 reduce 3 月前的所有切面，3→6 月的切面不参与。给某人物补设定 / 给大陆补历史 = 在合适时间点新增切面即可。
- subject：参与世界模拟的主体（不限于智慧生物，王国、大陆也可以是 subject），有自己的状态，状态随时间 / 切面演变。

## Goal

设计并落地一个以**单调线性时间轴**为骨架的世界引擎：以「时间线 + 切面」表达世界演化，切面记录各 subject 的状态变更，任意时刻世界状态可由时刻前切面 reduce 得到；逐步取代现有 plot + simulation 的运行态表达。

- Outcome：存在一套可比较、可 reduce 的时间 + 切面 + subject 数据模型；能回答「任意 instant 的世界状态是什么」。
- Verification surface：模型层单测（时间比较、reduce 截断、同 instant 合并、补过去后的 re-settle）；后续接入真实 simulation workflow。
- Constraints：第一版不破坏现有 plot / simulation 既有数据；时间真相源单一，显示层可换不影响已存数据。
- Boundaries：先做设计与核心模型，不急于改 Agent profile / 前端。
- Iteration policy：每轮讨论确定一块（时间 → 切面 → subject → reduce → 迁移），定论写回本文档。
- Blocked stop condition：遇到与现有 plot/simulation/agent 架构冲突且无法在不制造技术债的前提下解决时，停止并报告。

## Current State

- 已完成时间系统、切面增量模型、schema/op、Project SQLite 存储、第一版 API/Agent 工具边界的方向定论。
- 尚未写任何代码，纯设计阶段。

## Decisions / Discussion

### 已明确：时间真相源（本轮定论，后续讨论以此为依据）

- **唯一时间真相源 = 一个 BigInt 时间戳 `Instant`**：表示「自世界零点起经过的基准刻数」，可正可负。
  - 序列化为字符串存储（避免 JSON number 精度丢失）。
  - 比较运算用 BigInt 原生 `<` / `>` / `===`，全局可比较，timeline 排序与 reduce 截断都只依赖它。
- **零点 `Instant = 0n`** = 作者命名的世界元年起点（类比公元元年 / Unix epoch）。`Instant < 0` 天然表示「零点前」，不需要额外字段。
  - 注意：连续数轴**不继承公历「无第 0 年」的历史 bug**，底层永远连续；若显示层需要无第 0 年的纪年法，由日历换算处理。
- **基准刻粒度 = 1 秒**（1 刻 = 1 秒）。理由：直觉、好调试；以秒为刻，BigInt 可覆盖到量劫级（~2920 亿年），即便普通 JS number 也能到 ~2.85 亿年。
- **数值范围结论**：量劫级跨度普通 int/number 不够 → 底层用 BigInt；这是「int 不够」直觉成立的根因。

```typescript
// 唯一真值源：自零点起的基准刻（秒）数，可负。持久化为 string。
type Instant = bigint;
```

### 已明确：格式化 / 日历是独立显示模块

- **时间的格式化（「复兴纪元 488 年 风信之月 15 日 14:00」这类人读字符串）属于一个单独的显示模块**，不是时间真相源的一部分，后续可以持续调整、替换，不影响已存的 `Instant` 数据。
- 切面底层**只存 `instant`**（+ 后续可能的模糊时间字段），人读字符串由显示模块实时 format，不落盘。这样改历法 / 改月份名 / 改一天小时数都不需要迁移已有数据。
- **Calendar 最小 parse/format 进入第一版工具层**：Agent 工具收发人读时间字符串，不直接传 BigInt / 十进制 instant。第一版只要求项目 canonical 格式 parse/format 对称可逆；完整自定义历法、模糊时间和复杂自然语言时间可后续再做。
- 显示模块（Calendar）的后续完整构想：
  - 自定义单位层级（每层定义含多少下层单位），如 36 小时制 = 一天 36 时。
  - format 用模板 + 占位符配置（如 `"{epoch}{year}年 {month}{day}日 {hour:02}:{minute:02}"`），不写死。
  - 需要内置一套**现实公元纪年法（gregorian）**供用户开箱即用（含大小月 / 闰年规则）→ 因此层级进位需支持**不规则进位**（perChild 可为函数），不规则换算用预计算累加表 + 缓存。
  - 还需一套全固定进位的**幻想简明历**预设供复制改造。
  - 量劫：恒定长度 → 日历最高层 unit；长度不固定 → 走模糊时间。

### 待讨论：模糊时间（已有初步构想，未定论）

- 需求确定要支持「三百年前」「很久以前」这类模糊时间。
- 初步构想（未定论）：时间点是 `exact / fuzzy(anchor ± span, relativeTo) / unknown(before/after)` 三态；模糊比较返回「确定早 / 确定晚 / 区间重叠无法确定」三态，重叠时引擎可提示作者确认先后。
- 该方案是否纳入第一版、如何与切面结合，留待后续。

### 已明确：切面 + reduce = 事件溯源（Event Sourcing），增量模型

- **核心范式**：世界不存「当前状态」，只存「切面序列」；任意时刻世界状态 = 该时刻前所有切面按 `instant` 排序后 reduce 出来的结果。这是经典 event sourcing。
- **切面是增量（delta / mutation），不是全量快照**。理由：核心诉求是「往前插切面补历史 / 补设定」，全量快照在往前插时会让后续快照全部失效，增量模型则让后续变更自然叠加。这是被需求锁定的结论。
- **增量模型的代价 + 留口**：reduce 成本随切面数线性增长。第一版可不做优化，但模型要给 **snapshot checkpoint（每隔 N 个切面缓存一份全量状态，reduce 从最近缓存往后叠）** 留位置。
- **同一 `instant` 只能有一个切面**：禁止同一时间点出现多个 `WorldSlice`。同一刻发生的多 subject / 多属性变化必须合并进同一个 slice 的 `mutations`。写入目标 instant 已存在时，`writeSlice` 第一版默认合并到已有 slice；reduce 排序只需要 `instant ASC` + slice 内 `mutation.seq ASC`。
- **切面结构（草图，字段后续可调）**：

```typescript
// 一个切面 = 一个时间点 + 一组对若干 subject 的变更
interface Slice {
    id: string;
    instant: string;          // BigInt 时间戳（唯一时间真相源）
    title: string;            // 人读标题
    summary?: string;
    mutations: Mutation[];    // 这一刻发生的所有变更
}

// 一条变更：对某 subject 的某属性做某操作
interface Mutation {
    subjectId: string;        // 改谁（人物 / 王国 / 任务 / 背包…）
    attr: string;             // 改它的哪个属性（由 subject 类型 schema 声明）
    change: unknown;          // 变更数据；如何叠加由该 attr 绑定的 reducer 决定
}
```

### 已明确：reducer 按属性绑定，schema 是项目级资产

- **引擎不预设世界观**。引擎层只认识抽象概念（`Subject` / `Slice` / `Instant` / `Mutation` / `op` / `reduce()`），不知道「HP」「魔力」是什么。世界观差异全部由**项目自己的 schema** 表达。引擎对项目 schema 的关系 ≈ SQLite 引擎对你的表结构。
- **schema 定义方式（定论）**：项目内 **YAML/JSON 配置文件**，放 Project Workspace（目录待定），**按「类型」声明**（character / quest / location / item…，subject 是某类型实例，100 个 NPC 共享一份 character schema），运行时 TypeBox 校验。

### 已明确：op 全集 + 可逆性（回退是引擎通用能力，非某 op 专属）

- **取消 track**。之前的 track（记新老）是误设计。真相：**「回退/撤销」是所有 op 都需要的通用能力，不绑在某个属性上**。hp 就是普通 `set`，它能回退是因为引擎对所有 set 都能记/算逆操作，不是因为它用了特殊 op。
- **「HP 曲线 / 成长史」不需要专门存储**：遍历所有打在 `hp` 上的 mutation（每条带 instant + 值）天然是时间序列。reduce 出「当前值」与 reduce 出「历史轨迹」用同一批切面数据，只是聚合方式不同。
- **op 全集 + 逆操作（每个 op 必须可逆）**：

| op | 作用 | 应用时记录（为可逆） | 逆操作 |
| --- | --- | --- | --- |
| `set` | 设单值（含覆盖、含嵌套路径） | `old` 值（或「原不存在」标记） | set 回 `old` |
| `add` | 数值相对增量（scalar 数值专用） | 增量本身 | add 取反（不依赖 old） |
| `unset` | 删除一个属性 / 键 | 被删的 `old` 值 | set 回 `old` |
| `listAppend` | **只增的有序流**追加（events 经历） | 追加内容 | 删掉末尾那条 |
| `collectionAdd` | **可增删无序集合**加元素（背包、附魔、宗门弟子） | 加了哪个元素 | collectionRemove 该元素 |
| `collectionRemove` | 可增删无序集合删元素 | 删了哪个元素 | collectionAdd 回去 |

  - **`add` 的价值是架构性的**：可交换、对「往前插切面」免疫（前面插变更不影响后续 add），逆操作 = 取反、不依赖 old。set 是绝对值、对插入敏感、依赖 re-settle。数值变更优先 add（扣血 / 国库增减），知道确切目标值才用 set。
  - **`listAppend` 与 `collection*` 必须分开**：append 是只增有序流（逆 = 砍末尾）；collection 是可增删无序集合（逆 = 反向增删）。
  - schema 每个属性绑定 **kind**（`scalar` / `list` / `collection` / `object`）决定它接受哪些 op、如何叠加、如何逆。`object` 统一了固定结构（声明 fields）与开放字典（只声明 itemType），不再分 map/object。详见 [schema-design.md](schema-design.md)。

### 已明确：mutation 已结算（存 old→new），但声明式意图才是真相源

- **存储形态（定论：已结算）**：切面 mutation 持久化为 `op + 目标值 + old`，例如 `set hp: 80→50`。好处：回退 O(1)（直接读 old 反向应用，不必重 reduce）、人能直接读懂变化。
- **一致性策略（随「已结算」必须处理的后果）**：old→new 是「应用那一刻的真实快照」，是**派生缓存**；**声明式意图（set hp = 某值）才是权威真相源**。往前插 / 编辑切面后，引擎自动 **re-settle** 重算受影响切面的 old 值。
  - 原因：纯「已结算」在「往前插切面」（世界引擎核心卖点）时会让后续切面冻结的 old 失真，例如在 `[A:100→80] [B:80→50]` 间插 `[X:80→70]`，B 的 `old:80` 就过时。re-settle 让 old 始终与链条一致。
  - 净效果：拿到「已结算」的回退便利 + 可读性，又不被「往前插 old 失真」反咬。
- **第一版必须实现最小 re-settle**：补过去 / 编辑 / 删除切面时，从受影响切面的 instant 开始，按 subject 粗粒度重算该 subject 后续 mutation 的 `old`。第一版不做 attr/path 级优化；只要某个切面触及 subject A，就重算 A 在该 instant 之后的链条。

### 已明确：嵌套属性 + 引用规则

- **嵌套属性：支持，用「路径」表达更新**。`attr` 是路径字符串，天然支持点号深入：

```yaml
# schema：嵌套结构
character:
  attrs:
    equipment:
      type: object
      fields:
        head:  { type: ref(item) }   # 装备槽位
        chest: { type: ref(item) }
```

  - 更新单槽位 = `{ subjectId, attr: "equipment.head", op: set, value: ref("钢盔") }`，逆操作只记 old head。
  - **允许整体替换**：`set equipment = {...}`（逆记整个 old equipment）vs `set equipment.head`（逆只记 old head），都用 `set`，区别在路径深浅。日常优先打**细路径**保留逐槽位历史；整体替换留给「换一整套装备」这类真整体操作。

- **引用规则（定论）**：
  1. **不双向冗余存**：关系只在一边存（人物的 `equipment.head = ref(钢盔)`）。「这把剑被谁装备」靠**反查**（遍历找 `equipment.* == 钢盔`），不让装备自己再存 `equippedBy`。否则两边要同步，切面回退极易不一致 —— 即「引用不要滥用」。
  2. **reduce 不自动解引用（惰性显式解）**：`reduce(艾莉娜, t).equipment.head` 返回 `ref("钢盔")` 引用值本身，**不**把钢盔状态嵌进来。要钢盔状态调用方自己再 `reduce(钢盔, t)`。原因：自动解引用引发递归、循环引用、「解到哪层停」难题。**reduce 永远只算单个 subject，指针不自动跟进去；谁要关联视图谁自己组合多个 reduce 结果。**

### 已明确：用真实例子验证模型（结论：模型站得住）

- **魔幻人物**：character schema 用 hp/level/mp(track)、location(set→ref)、memory(merge by topic)、events(append)、mind(set) 表达，全部成立。换现代都市世界只改 schema（去 mp/level，加 phone_battery/bank_balance），引擎代码不改。
- **任务状态**：quest **本身是一个 subject**（status:set / progress:track / log:append / giver:set→ref）。**原则：能独立演变状态的东西就是 subject，不论是不是「人」** —— 印证最初「王国、大陆也是 subject」。
- **subject 关联**：关系不是独立第三种东西，就是一个 reducer 为 `set` / 值为「指向另一 subject 的引用 ref」的属性（location→ref(location)、giver→ref(subject)）。关系随时间演变自动纳入切面 + reduce。
- **背包是不是 subject**：判断标准 = 它有没有「独立的、需随时间追踪的状态/信息」。普通背包 = 人物的一个 `collection` 属性；特殊背包（诅咒口袋、会损坏的须弥戒）有独立状态 → 独立 subject/entity，内含物用 `contains: ref[]` 关联。这与现有 simulation entity 规则一致。

### 待讨论（尚未定论）

1. timeline 容器本身的数据结构（snapshot checkpoint 优化的接入点）。**存储已定：schema = 项目配置文件不进 SQLite，Project SQLite 只存切片，与 plot 表共库；同一 instant 只允许一个切面。**
2. subject 实例的注册 / 创建（subject 身份存哪、与 schema 类型绑定；是否用「初始化切面」承载身份）。
3. 模糊时间（fuzzy / unknown）如何落到 instant INTEGER。

**已定方向（不再讨论）**：
- 校验**宽松**：mutation 可打未声明属性（动态属性），未知属性默认 scalar。
- `map`/`object` 合并为 `object`（有 fields = 固定结构，无 fields 只有 itemType = 开放字典）。
- scalar 数值支持 **set + add**。
- **default 进切面**：subject 创建生成「初始化切面」写入初值，切面序列自包含。
- **文件组织**：世界引擎配置放 Project Workspace 顶层 **`world-engine/`**（`schema.yaml` 等）；切面 / mutation / subject 实例全在 Project SQLite（与 plot 共库，`World*` 前缀）。
- **ref 格式**：`subject://<id>`（纯 id，不编码 type），对齐 `{kind}://{targetId}` 惯例，单一 scheme 覆盖所有 subject 类型。
- **存储 / API（第一版最小）**：3 表（WorldSubject / WorldSlice / WorldMutation）；mutation 一行一条；`WorldSlice.instant` 唯一；instant 用 INTEGER 64 位；API 包含 `createSubject` / `writeSlice` / `getWorldState` / `queryState` / `listSlices`。`queryState` 是 Agent 与常规业务入口，`getWorldState` 只给 UI / 调试 / 导出使用。snapshot、回退、属性历史、反查引用推后；re-settle 进第一版。详见 [sqlite-and-api.md](sqlite-and-api.md)。
- **与 simulation 关系**：世界引擎是全新独立系统，当前与 `simulation/` 无关；simulation 目录**暂不删除、暂不迁移**，后续慢慢迁移。世界状态完全由切面 reduce 得来，不再有 subject 文件作为状态源。
- **与 plot 关系**：plot 同样暂不删除；未来定位为 Novel 模式「故事 → 小说结构」编排层，切面管「发生了什么」，plot 管「怎么讲成小说」。
- **RAG**：单独成系统、世界引擎的下游消费者，不跟随 schema；第一版不实现，kind 设计已支持后续订阅。详见 [schema-design.md](schema-design.md)。
- **Agent 时间边界**：Agent 工具收发格式化时间字符串，不直接传 BigInt / 十进制 instant。工具层通过 Calendar parse/format 转换到 facade 的 `Instant`。
- **回滚边界**：现有 simulation rollback 方案不作为当前依赖，世界引擎第一版不承诺 tick rollback / revert slice。
- **schema 演化边界**：第一版不做 schema 版本化或历史 mutation 自动迁移。schema 是当前项目合同；修改 schema 后如影响旧 mutation，先由作者 / Agent 显式修正。

## 待讨论：模糊时间（已有初步构想，未定论）

- 需求确定要支持「三百年前」「很久以前」这类模糊时间。
- 初步构想（未定论）：时间点是 `exact / fuzzy(anchor ± span, relativeTo) / unknown(before/after)` 三态；模糊比较返回「确定早 / 确定晚 / 区间重叠无法确定」三态，重叠时引擎可提示作者确认先后。
- 该方案是否纳入第一版、如何与切面结合，留待后续。

## Verification / Test

- 第一版重点验证：时间比较、reduce 截断、同 instant 写入合并、补过去后的 re-settle、`queryState` 投影与 `listLimit`。

## Implementation Walkthrough

- （尚未开始实现。）

## TODO / Follow-ups

- 实现第一版 Calendar：项目 canonical 格式 parse/format 对称可逆；完整单位层级、gregorian / fantasy-simple 预设、不规则进位换算与缓存策略可后续细化。
- 定论模糊时间方案是否进第一版。
- 讨论补过去的产品交互：同 instant 合并时 title/summary/kind 如何处理，是否需要用户确认。
- 厘清与现有 plot + simulation（events.jsonl / memory.jsonl / runs / ticks）的迁移或共存边界。
