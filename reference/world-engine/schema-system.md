# World Engine — Schema 系统

> 本文讲清 World Engine 中 **schema（主体模式）** 的概念与契约：subject type / attr / kind / op / reduce 语义 / ref / default。读者是需要设计或理解某个项目 schema 的 Agent 与作者。本文只教原理与契约，不教「第一步做什么」的操作步骤（那是 skill 的职责）；理解这里的概念后，你应能自己判断该怎么写 schema、怎么打 mutation。

## 1. schema 的定位

World Engine 是一个事件溯源（event sourcing）系统：世界不存「当前状态」，只存**切面（slice）序列**；任意时刻的世界状态 = 该时刻之前所有切面按时间排序后 **reduce** 得来。切面里的每一条变更叫 **mutation**，描述「对某个 subject 的某个属性做某种操作（op）」。

引擎本身**不预设世界观**。引擎层只认识抽象概念（subject / slice / instant / mutation / op / reduce），不知道「HP」「魔力」「修为」是什么。世界观差异**全部由项目自己的 schema 表达**。引擎对项目 schema 的关系，约等于 SQLite 引擎对你的表结构：引擎提供通用机制，schema 告诉它「这个世界里某一类 subject 有哪些属性、每个属性用什么语义叠加」。

- schema 是**项目级资产**，一份 YAML（或 JSON）配置文件，放在 **Project Workspace 顶层的 `world-engine/` 目录**，即 `world-engine/schema.yaml`。
- schema **不进 SQLite**。Project SQLite 只存切面（timeline）：subject 身份、slice、mutation。schema 是当前项目的「合同」，切面只引用属性名与 op，不内嵌 schema。
- schema **按「类型（type）」声明**：`character` / `location` / `item` / `faction` / `world` / `quest`…。一个 **subject（主体）** 是某个 type 的实例（100 个 NPC 共享同一份 `character` schema）。subject 不限于智慧生物 —— 王国、大陆、世界本身、任务都可以是 subject，判断标准是「它有没有需要随时间追踪的独立状态」。
- `schema.yaml` 显式存在时根配置必须是 object；空文件或缺文件按**空 schema** 处理（此时所有属性都是动态属性，见 §8）。
- 第一版**不做 schema 版本化 / 自动迁移**。改 schema 不会自动重写历史 mutation。若改动影响旧数据，先由作者或 Agent 显式修正。

## 2. kind：属性的「op 语义类」

每个属性声明一个 **kind**，kind 决定它**接受哪些 op、reduce 时怎么叠加**。这是 op 全集与 schema 的接缝，也是理解整个系统的核心一张表。

| kind | 接受的 op | reduce 语义 | 典型属性 |
| --- | --- | --- | --- |
| `scalar` | `set` / `add` / `unset` | `set` 重置为绝对值；`add` 在前值上累加（仅数值）；当前值 = 按 instant 顺序应用最后的结果 | hp、level、location(ref)、status、mind |
| `list` | `set` / `listAppend` / `unset` | `set` 整组替换；`listAppend` 在末尾追加；当前值 = 按序应用后的有序数组 | events 经历流、quest.log |
| `collection` | `set` / `collectionAdd` / `collectionRemove` / `unset` | `set` 整组替换；`add`/`remove` 按 stable JSON 值增删；当前值 = 现存元素集合 | 背包物品、附魔、宗门弟子 |
| `object` | 对子字段 / key 做 `set`/`add`/`unset`，或整体 `set` | 嵌套结构；有 `fields` = 固定结构，无 `fields` 只有 `itemType` = 开放 key 字典 | equipment{head,chest}（固定）、memory by topic（开放） |

要点：

- **`list` 与 `collection` 必须分开**。`list` 是**只增的有序流**（经历流、日志，逆操作 = 砍末尾），顺序就是叙事顺序，故意**不支持中间插入**。要往「过去」补一条经历，正确做法是**在更早的 instant 插一个切面**，而不是在现有 list 中间插元素 —— 否则会破坏「events 顺序 = 切面 instant 顺序」这条不变量。`collection` 是**可增删的无序集合**（背包、弟子名册，逆操作 = 反向增删），按 stable JSON 值去重。
- **`list` / `collection` 的 `set` 是整组替换**：value 必须是数组，数组项按 `itemType` 校验。日常追加经历仍优先用 `listAppend`，增删集合项仍优先用 `collectionAdd` / `collectionRemove`；`set` 留给「整组重置」（subject 创建时的 default 初始化也走这条普通合法语义）。
- **`object` 统一了固定结构与开放字典**（不再分 map / object 两个 kind），详见 §4。

## 3. op 全集与语义

op 是 mutation 的动词。全集如下，所有 op 都受属性 kind 约束（§2 表已列出每个 kind 接受哪些 op）：

| op | 作用 | reduce 语义 |
| --- | --- | --- |
| `set` | 设单值（含覆盖、含嵌套路径） | 后写覆盖前值 |
| `add` | 数值相对增量（scalar 数值专用） | 基于当前数值累加；缺基准返回 `broken-relative` |
| `unset` | 删除一个属性 / key | 删除当前路径 |
| `listAppend` | 只增有序流追加（经历） | 基于当前 list 追加；缺基准返回 `broken-relative` |
| `collectionAdd` | 可增删无序集合加元素 | 基于当前 collection 按 stable JSON 去重追加 |
| `collectionRemove` | 可增删无序集合删元素 | 基于当前 collection 按 stable JSON 删除；缺基准 / 不存在返回 `broken-relative` |

### set vs add：为什么要区分

`scalar` 数值属性**同时支持 set 与 add**，两者语义不同，选择哪个有架构后果：

- **`set` = 绝对值**：「等级升到 5」「status 改成 done」。后写覆盖前值，与历史无关。
- **`add` = 相对增量**：「扣 20 血」「国库 +1000」。基于 reduce 出的当前数值累加，**仅对数值类型有效**。

`add` 的价值是**架构性的，与 LLM 算力无关**：

- `add` **可交换、对「往前插切面」稳定**。如果你在某条 `add` 之前再插入一个变更切面，后续 `add` 的增量不变，reduce 会自动得到正确结果。
- `set` 是绝对值，**对插入敏感**。在一条 `set hp=50` 之前插一个改 hp 的切面，那条 `set` 仍然把 hp 钉死在 50，可能不是作者想要的。
- 因此：**记录连续变化（伤害、收入、消耗）优先用 `add`**；只有「这一刻就是这个绝对值」才用 `set`。

第一版的边界（务必记住）：

- **mutation 不存旧值字段**，后端**不自动改写后续切面**。声明式的 mutation 序列是唯一真相源。
- 在过去插入 / 修改绝对值时，引擎用 **A issues** 提醒作者确认语义，而不是自动修复：`base-shifted` 表示本次过去的绝对修改改变了下游相对 op 的累加基准；`masked` 表示本次修改会被下游某个绝对 op 覆盖。A issues 是**一次性提醒**，不落库，确认语义即可。
- **没有 track、没有专门的「历史曲线」存储**。「hp 随时间的曲线」= 遍历所有打在 hp 上的 mutation（每条都带 instant + op + 值），从切面序列直接 reduce 出轨迹。reduce 出「当前值」和 reduce 出「历史轨迹」用的是同一批数据，只是聚合方式不同。

### add 的数值约束

`add` 的 reduce 结果必须仍是**有限数（finite number）**，否则显形为 `broken-relative` E issue（持久数据错误，必须修）。`int` 值必须是 JS safe integer，`int add` 的累加结果也必须保持 safe integer（避免 JSON number 超出安全整数范围后丢精度）；`float` 输入只要求有限数。

### 与 JSON Patch 的关系（注脚，非合同）

op 集合受 JSON Patch (RFC 6902) 启发但**不严格对齐**。`set` ≈ `replace`/`add`，`unset` ≈ `remove`，`listAppend` ≈ 追加到 `path/-`，`collectionAdd`/`collectionRemove` 是「按值」而非「按 index」增删，`add`（数值）是 JSON Patch 没有的扩展。不直接采用 JSON Patch 命名，是因为 JSON Patch 的 `add` 一名三义（靠 path 末尾形态决定语义）可读性差；我们按属性 kind 决定语义、op 名字一眼定义。

## 4. object：固定结构与开放字典

`object` 一个 kind 覆盖两种形态，区别只在「有没有声明 `fields`」：

- **有 `fields`：固定 schema 结构**。子字段是预先声明的固定 key（如装备槽位 head / chest / weapon），每个子字段有自己的类型。
- **只有 `itemType`、没有 `fields`：开放 key 字典**。key 在运行时增减（如 `memory` 按 topic 存看法），所有 value 共享同一个 `itemType`。

两种形态都用**路径**做 `set` / `unset`：

- 固定结构：`equipment.head` set 一个 ref(item)，只影响 head 槽位，保留逐槽位历史；整体 `set equipment = {...}` 留给「换一整套装备」。
- 开放字典：`memory.师门` set 一段文本，新增 / 改写「师门」这个 topic 下的看法；`unset memory.师门` 删掉这个 topic。

**日常优先打细路径**（`equipment.head`、`memory.师门`），保留逐 key 的演化历史；整体 `set` 只用于真正的整体替换。

## 5. ref 引用规则

subject 之间的关系不是独立的第三种东西，**就是一个值为「引用」的普通属性**（kind 通常是 scalar，op 是 set）。

- 引用串统一写成 **`subject://<id>`**，纯 id，**不编码 type**，对齐项目 `{kind}://{targetId}` 惯例（同构于 `thread://22`）。
- **单一 scheme 覆盖所有 subject 类型**：character / item / location / faction 都是 subject，只是 type 不同；type 从 `WorldSubject` 表查，不进 URI。
- schema 里属性写 `type: ref(<subjectType>)`，`<subjectType>` 必须是同一份 schema 已声明的 subject type，用于**校验目标 subject 的 type 是否匹配**与编辑期提示，但**不改变存储的 ref 串**（存储恒为 `subject://<id>`）。

两条核心规则：

1. **不双向冗余存**。关系只在一边存。人物身上存 `equipment.weapon = subject://sword-01`，物品身上**不**再存 `equippedBy`。「这把剑被谁装备」靠**反查**（遍历找哪个 character 的 `equipment.*` 等于这把剑）。同理阵营不存 `members`，「凤凰阵营有谁」靠反查 `character.faction == subject://phoenix`。双向冗余在切面回退时极易不一致，所以禁止。
2. **reduce 不自动解引用（惰性显式解）**。`reduce(艾莉娜, t).equipment.weapon` 返回引用值 `subject://sword-01` **本身**，不会把剑的状态嵌进来。要剑的状态，调用方自己再 `reduce(sword-01, t)`。原因：自动解引用会引发递归、循环引用、「解到哪一层停」难题。**reduce 永远只算单个 subject，指针不自动跟进去**；谁要关联视图，谁自己组合多个 reduce 结果。

ref id 全局唯一（`WorldSubject.id` 主键），不能为空，不能带首尾空白；写入 `subject://<id>` 时内部的 `<id>` 也遵守同一规则。

## 6. attr path 规则

`attr` 是路径字符串，**点号（`.`）是运行时路径分隔符**，天然支持深入嵌套结构（`equipment.head`、`memory.师门`、`stats.hp`）。

由此推出两条命名约束：

- **schema attr 名不能含点号、不能含首尾空白、不能为空**。因为点号被保留作路径分隔符 —— 如果 attr 名里出现点号，`memory.师门` 就无法区分「单 key 里带点号」和「memory 下的 师门 子路径」，产生不可寻址歧义。
- **运行时 attr path 每段必须非空、不能含首尾空白**。

**开放 object 的 key 可以用中文等稳定段名**（如 `memory.师门`、`memory.家乡`）。约束的是「段名形状」（非空、无首尾空白、无点号），不限制语言。

## 7. default 与初始化

schema 属性可声明 `default`，它决定 subject **创建时**要不要写一个「初始化切面」：

- **声明了非空 `default`**：创建 subject 时，会在该 subject 的起始 instant 生成或追加一组 `kind=init` 的 `set` mutation，把初值写进切面。这样 reduce 从切面序列即可拿到已声明的初值，**切面序列自包含**，不需要「reduce 时回查 schema 兜底」的特殊逻辑。
- **没有 default**：只注册 subject 身份，**不创建空切面**（保持「切面 = 状态变更」这条约束，不存在没有 mutation 的切面）。

初始化追加的边界：自动追加**只允许落到同 instant 已有的 `kind=init` 切面**。如果该时刻已经有 `event` / `backstory` 等非 init 切面，引擎会拒绝自动追加（返回 409），要求改用 `edit_world_slice` 显式合并，或换一个初始化时间 —— 避免 subject 创建悄悄改写普通事件切面。

**default 在 schema 加载期校验形状 / 类型**：`int` 必须是整数（且是 safe integer），`float` 必须是有限数，`enum` 必须命中取值集合，`list` / `collection` default 必须是数组，固定 `object.fields` default 不允许多余 key，开放 `object` default 会逐 key 校验。`ref(type)` default 先校验 `subject://<id>` 形状；目标 subject 是否真实存在、type 是否匹配，则在创建 subject 写入 init mutation 时校验（这依赖 Project SQLite 当前数据）。

## 8. 校验宽松度（定论：宽松）

schema **不是强约束，而是「建议结构 + 已知属性的 op 语义」**：

- mutation 打在 schema **未声明**的属性上是**允许**的（动态属性）。**未知属性默认按 `scalar` 处理。**
- 已知属性按声明的 kind 校验 op 是否合法、value 类型是否对。
- 这样 Agent 不必「先改 schema 才能记一个新属性」—— 想给角色记一个 schema 里没写的临时属性，直接打 mutation 即可。

宽松的是「属性是否声明」，**严格的是值的合法性**：mutation value 必须是严格 JSON 值，`NaN` / `Infinity` / `Date` 等非普通对象 / 嵌套 `undefined` 都会被拒绝；已声明属性的 op-kind 组合不合法也会被拒绝。

## 9. 稳定 key 约束（汇总）

schema 与运行时入参里的「key」必须可稳定引用，相关命名约束汇总如下：

- **subject type 名**：不能为空，不能含空白，不能含括号。这套规则同时用于 schema type 声明、运行时 `create_world_subject(type)` / `get_world_state(type)` / `list_world_subjects(type)` 入参，以及 `ref(<type>)` 校验。`ref(<type>)` 必须指向同一 schema 已声明的 subject type，悬空 ref 在 schema 加载阶段就报错。
- **attr 名**：不能为空，不能含首尾空白，不能含点号（点号是路径分隔符，见 §6）。
- **subject id**：不能为空，不能含首尾空白；`subject://<id>` 内部的 id 同样。
- **slice kind 标签**：`WorldSlice.kind` 是 timeline / UI / 日志的过滤标签，**不参与 reduce**；允许项目自定义，省略时默认 `event`，但显式传入时不能为空、不能含首尾空白。

补充：schema 中显式的 `desc` 必须是字符串；`enum` 候选必须是非空数组且按 stable JSON 唯一（对象 enum 的 key 顺序不构成不同候选）。

## 10. 属性字段格式与典型奇幻 schema 示例

一个属性的完整可选字段：

```yaml
# 一个属性的完整可选字段
<attrName>:
    kind:     scalar | list | collection | object          # 必填，决定 op 语义
    type:     int | float | text | bool | enum | ref(<type>)  # 值类型（scalar 值 / 元素值）
    enum:     [...]            # kind=scalar 且 type=enum 时的取值集合
    ref:      <subjectType>    # type=ref 时指向的 subject 类型（仅校验，不改存储串）
    fields:   { ... }          # kind=object 且为固定结构时的子字段（递归同结构）
    itemType: <type>           # kind=list / collection 的元素类型；kind=object 无 fields 时的 value 类型（开放字典）
    default:  <value>          # subject 创建时写入「初始化切面」的初值（见 §7）
    desc:     "..."            # 给作者 / Agent 看的说明
```

一个覆盖 character / location / item / faction / world 的典型奇幻 schema：

```yaml
# 文件示意：<project>/world-engine/schema.yaml
subjectTypes:

    # —— 人物（玩家与 NPC 共用）——
    character:
        desc: 有主观知识、会行动、会隐藏信息的角色
        attrs:
            # 数值属性：scalar，靠切面序列 reduce 出当前值与历史曲线
            hp:        { kind: scalar, type: int,  default: 100, desc: 当前生命值 }
            maxHp:     { kind: scalar, type: int,  default: 100 }
            mp:        { kind: scalar, type: int,  default: 0 }
            level:     { kind: scalar, type: int,  default: 1 }
            age:       { kind: scalar, type: int }

            # 当前所在地：scalar + ref（关系即引用属性，单向存）
            location:  { kind: scalar, type: ref(location) }

            # 当前心理 / 状态文本：scalar text，后盖前
            mind:      { kind: scalar, type: text }

            # 装备栏：object 固定结构，子字段是固定槽位，每槽位是 ref(item)
            equipment:
                kind: object
                fields:
                    head:   { type: ref(item) }
                    chest:  { type: ref(item) }
                    weapon: { type: ref(item) }

            # 背包：collection，物品可增删（不是 list，因为会取走）
            inventory: { kind: collection, itemType: ref(item) }

            # 认知记忆：object 开放字典（无 fields，只有 itemType），key=topic 运行时增减改
            memory:    { kind: object, itemType: text, desc: "key=角色当前认定的称呼，value=看法" }

            # 经历流：list，只增有序
            events:    { kind: list, itemType: text }

            # 关系：指向阵营，单向存。「阵营有哪些成员」靠反查
            faction:   { kind: scalar, type: ref(faction) }

    # —— 地点 ——
    location:
        attrs:
            name:    { kind: scalar, type: text }
            control: { kind: scalar, type: ref(faction), desc: 当前控制方 }

    # —— 物品（有独立状态才作为 subject）——
    item:
        desc: 需要独立追踪状态的物品（普通物品可只作为 character.inventory 的元素，不必建 subject）
        attrs:
            durability: { kind: scalar, type: int }
            # 附魔：collection，可增删多个附魔
            enchants:   { kind: collection, itemType: text }
            # 注意：不存 equippedBy。「被谁装备」靠反查 character.equipment.* == 本 item

    # —— 阵营 / 王国（非智慧生物也是 subject）——
    faction:
        attrs:
            name:     { kind: scalar, type: text }
            treasury: { kind: scalar, type: int, desc: 国库 }
            # 不存 members 列表（避免双向）。成员靠反查 character.faction == 本 faction

    # —— 世界本身（也是一个 subject，承载世界级大事件）——
    world:
        desc: 世界本身，记录世界级大事件与全局状态
        attrs:
            events:   { kind: list, itemType: text, desc: 世界大事件流 }
```

跑几条 mutation 验证 op + reduce（时间一律用项目日历字符串，Agent 工具 / HTTP 公开入参禁止 raw `instant:<number>`）：

```jsonc
// 切面 @ "星辉历312年 5月5日 14:00"：艾莉娜受伤、捡到剑、装上、对师门改观
{
    "time": "星辉历312年 5月5日 14:00",
    "title": "城北遭遇战",
    "mutations": [
        // scalar add：相对增量更稳健（扣 30 血）
        { "subjectId": "erina", "attr": "hp",               "op": "add",           "value": -30 },
        // collection 加：捡到一把剑进背包
        { "subjectId": "erina", "attr": "inventory",        "op": "collectionAdd", "value": "subject://sword-01" },
        // object 细路径 set：把剑装到武器槽
        { "subjectId": "erina", "attr": "equipment.weapon", "op": "set",           "value": "subject://sword-01" },
        // object 开放字典 by key：对「师门」的看法改了
        { "subjectId": "erina", "attr": "memory.师门",       "op": "set",           "value": "怀疑" },
        // list 追加：写一条经历
        { "subjectId": "erina", "attr": "events",           "op": "listAppend",    "value": "在城北被伏击，捡到一把旧剑" }
    ]
}
```

reduce 出的状态：hp 在前值上减 30、inventory 含 `subject://sword-01`、equipment.weapon = `subject://sword-01`、memory.师门 = "怀疑"、events 末尾多一条。

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口。
- [subject-lifecycle.md](subject-lifecycle.md)：subject 注册、init slice、切面演化、reduce、查询契约。
- [recording-principles.md](recording-principles.md)：记录什么、记录到什么粒度。
- [calendar-system.md](calendar-system.md)：时间真相源与时间入参边界。
- [docs/tasks/56-world-engine/schema-design.md](../../docs/tasks/56-world-engine/schema-design.md)：schema 字段格式、kind/op 语义、ref 规则与完整示例（底层契约真相源）。
