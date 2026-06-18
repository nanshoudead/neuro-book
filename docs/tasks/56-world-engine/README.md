# World Engine (世界引擎)

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

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
- Verification surface：模型层单测（时间比较、reduce 截断、模糊时间三态比较）；后续接入真实 simulation workflow。
- Constraints：第一版不破坏现有 plot / simulation 既有数据；时间真相源单一，显示层可换不影响已存数据。
- Boundaries：先做设计与核心模型，不急于改 Agent profile / 前端。
- Iteration policy：每轮讨论确定一块（时间 → 切面 → subject → reduce → 迁移），定论写回本文档。
- Blocked stop condition：遇到与现有 plot/simulation/agent 架构冲突且无法在不制造技术债的前提下解决时，停止并报告。

## Current State

- 仅完成**时间系统**的方向定论（见下）。timeline 数据结构、切面 schema、subject 模型、reduce 表示、与现有 plot+simulation 的迁移关系**均未讨论**。
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
- 显示模块（Calendar）的初步构想（**待后续单独细化，不作为本轮定论**）：
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

- **引擎不预设世界观**。引擎层只认识抽象概念（`Subject` / `Slice` / `Instant` / `Mutation` / `Reducer` / `reduce()`），不知道「HP」「魔力」是什么。现代都市没有等级魔力、修真世界没有信用分 —— 世界观差异全部由**项目自己的 schema** 表达。引擎对项目 schema 的关系 ≈ SQLite 引擎对你的表结构。
- **reducer 绑定到「属性」，不绑定到「mutation」**：这是消除「同一属性这次 append 下次 set」混淆的关键。schema 里声明 `hp → track` 一次，之后所有打在 `hp` 上的 mutation 都不再自带 reducer，引擎自动按 schema 查。这样加属性 ≈ schema 加一行（成本接近「mutation 自带 reducer」的灵活度），但 reducer 由属性唯一决定（规范）。
- **schema 定义方式（本轮定论）**：
  - **项目内配置文件（YAML/JSON）**，放在 Project Workspace（具体目录待定，如 `simulation/schema/` 或世界引擎专属目录）。作者和 Agent 可直接读写，跟着项目走；运行时用 TypeBox 校验。符合项目「文件化 Workspace」大方向。代价：失去 TS 编译期类型检查，靠运行时校验。
  - **按「类型」声明**：character / quest / location / item… 各一份 schema，subject 是某类型的实例。100 个 NPC 共享一份 character schema。
- **内置 reducer 库（由真实例子验证得出）**：

| reducer | 语义 | 例子 |
| --- | --- | --- |
| `append` | 只增不减的流 | events 经历流 |
| `set` | 后值盖前值的单值 | location、quest.status、mind |
| `track` | 记新老 `{from, to, instant}` 的单值，reduce 出当前值 + 完整变迁轨迹 | hp、level、age、progress（能画血量曲线 / 成长史） |
| `merge` | 按 key 合并 / 覆盖单条的字典 | memory（by topic） |
| `collection` | 可增删单个元素的集合 | 背包物品、宗门弟子 |

  - `track` 是 `set` 做不到的关键：`set` 只留最终值丢了历史；HP/等级用 `track` 既能查当前值也能查变迁轨迹（属性粒度的事件溯源）。
  - `collection` 是「背包」例子逼出来的：背包物品增减既非纯 append（会被取走）也非 set（非整体覆盖）。

### 已明确：用真实例子验证模型（结论：模型站得住）

- **魔幻人物**：character schema 用 hp/level/mp(track)、location(set→ref)、memory(merge by topic)、events(append)、mind(set) 表达，全部成立。换现代都市世界只改 schema（去 mp/level，加 phone_battery/bank_balance），引擎代码不改。
- **任务状态**：quest **本身是一个 subject**（status:set / progress:track / log:append / giver:set→ref）。**原则：能独立演变状态的东西就是 subject，不论是不是「人」** —— 印证最初「王国、大陆也是 subject」。
- **subject 关联**：关系不是独立第三种东西，就是一个 reducer 为 `set` / 值为「指向另一 subject 的引用 ref」的属性（location→ref(location)、giver→ref(subject)）。关系随时间演变自动纳入切面 + reduce。
- **背包是不是 subject**：判断标准 = 它有没有「独立的、需随时间追踪的状态/信息」。普通背包 = 人物的一个 `collection` 属性；特殊背包（诅咒口袋、会损坏的须弥戒）有独立状态 → 独立 subject/entity，内含物用 `contains: ref[]` 关联。这与现有 simulation entity 规则一致。

### 待讨论（尚未定论）

1. **`collection` reducer 是否纳入第一版**（背包 / 成员列表需要它）。
2. **subject 关联第一版是否定为「单向引用 + 反查遍历」**（vs 双向维护）：单向简单且无双向不一致风险；反查（如「宗门有哪些弟子」）通过遍历 character 找 `sect == xx宗`。
3. schema 配置文件的**具体目录与字段格式**（attr 如何声明 reducer / type / ref / enum / key）。
4. timeline 容器本身的数据结构（切面如何索引、排序、存储位置：文件 vs Project SQLite）。
5. **subject 模型与现有 `simulation/subjects/`（subject.md / soul.md / events.jsonl / memory.jsonl / mind.md / state.md）的复用还是替换**：现有 simulation 是「覆盖式当前状态」（state.md 不断被改写，无法重算任意时刻），世界引擎是「事件溯源可重算」，两者范式不同，迁移边界待定。
6. 与现有 plot + simulation（runs / ticks）的迁移或共存关系。

## 待讨论：模糊时间（已有初步构想，未定论）

- 需求确定要支持「三百年前」「很久以前」这类模糊时间。
- 初步构想（未定论）：时间点是 `exact / fuzzy(anchor ± span, relativeTo) / unknown(before/after)` 三态；模糊比较返回「确定早 / 确定晚 / 区间重叠无法确定」三态，重叠时引擎可提示作者确认先后。
- 该方案是否纳入第一版、如何与切面结合，留待后续。

## Verification / Test

- （待实现后补充）时间比较、reduce 截断、模糊时间三态比较的单测。

## Implementation Walkthrough

- （尚未开始实现。）

## TODO / Follow-ups

- 细化显示模块 Calendar：单位层级配置、format 模板配置、内置 gregorian + fantasy-simple 两套预设、不规则进位换算与缓存策略。
- 定论模糊时间方案是否进第一版。
- 讨论 timeline / 切面 / subject / reduce 数据模型。
- 厘清与现有 plot + simulation（events.jsonl / memory.jsonl / runs / ticks）的迁移或共存边界。
