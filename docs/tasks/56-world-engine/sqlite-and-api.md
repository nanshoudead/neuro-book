# World Engine — SQLite Schema 与 API 设计草案

> 本文件是 [README.md](README.md) 的子文档，承载 Project SQLite 表结构与世界引擎 API 契约。
> 状态：**草案 / 讨论中**，未定论。配套模型见 [schema-design.md](schema-design.md)。
> 项目惯例对齐：Prisma + libSQL adapter、Project SQLite（`.nbook/project.sqlite`）、按 projectPath 缓存 client、facade → service → repository 分层、写操作走 `$transaction`、后端 class 模式。

## 1. 存储分层（定论）

- **schema（subject 类型定义）= 项目配置文件**（YAML/JSON），**不进 SQLite**。放 Project Workspace 顶层 **`world-engine/`** 目录（如 `world-engine/schema.yaml`；时间显示配置后续放 `world-engine/calendar.yaml`）。`world-engine/` 与 `lorebook/world/` 子目录不冲突。
- **subject 引用格式 = `subject://<id>`（纯 id）**：对齐项目 `{kind}://{targetId}` 惯例（同构于 `thread://22`），单一 scheme 覆盖所有 subject 类型（character/item/location/faction…，type 从 `WorldSubject` 表查，不编码进 URI）。id 全局唯一，反查 `value = '"subject://<id>"'` 直接命中。未来可加进 `shared/reference-core.ts` 的 kinds，让正文 `@subject://erina` 自然提及。
- **Project SQLite 只存运行态**：subject 实例、切面（slice）、逐条变更（mutation）。**与现有 plot 表共用同一个 `project.sqlite`**（一套 Prisma schema 维护，model 用 `World*` 前缀隔离）。
- **mutation 一行一条（关系化）**：reduce 走 `(subjectId, instant)` 索引直接取相关 subject 的行，反查 / 曲线都是带索引 SQL。
- **instant 用 SQLite INTEGER（64 位）**：原生整数索引，排序 / 范围查询飞快。上限约 2920 亿年（秒为刻）。API 层仍是 `bigint`，仅存储层用 64 位；超 64 位再升级编码，API 不变。
- **同一 instant 只允许一个切面**：`WorldSlice.instant` 唯一。同一时刻的多 subject / 多属性变化全部合并进同一个 slice；目标 instant 已有 slice 时，`writeSlice` 第一版默认合并 mutations 到已有 slice。
- **reduce 在应用层算**：DB 只负责「高效取出某 subject ≤t 的全部 mutation，按 (instant, mutation seq) 排好」；按 op 叠加状态由应用层 reduce 函数完成（SQL 无法表达 object 路径 / collection 增删）。

### 第一版范围（最小化）

- **第一版只做**：subject 实例 + 切面写入 / 同 instant 合并 + `getWorldState`（全量调试）+ `queryState`（业务 / Agent 入口）+ `listSlices` + 最小 re-settle。
- **第一版不做**（推到后续）：`WorldSnapshot` 缓存、`findReferers` / `getAttrHistory` 等细分查询、回退 API。`old` 列进第一版，但它是 re-settle 维护的派生缓存，不是权威真相。

## 2. SQLite 表结构（Prisma schema 草案，第一版最小）

```prisma
// —— subject 实例：身份注册表（不含状态，状态全靠切面 reduce）——
model WorldSubject {
  id        String   @id            // subject 稳定 id，如 "erina"（ref 指向它）
  type      String                  // schema 里的类型名：character / quest / faction…
  name      String   @default("")   // 人读名（冗余便于列表展示，非状态真相）
  createdAt DateTime @default(now())
  mutations WorldMutation[]
  @@index([type])
}

// —— 切面：一个时间点 + 一组变更的容器 ——
model WorldSlice {
  id        String   @id @default(cuid())
  instant   BigInt                  // 唯一时间真相源（INTEGER 64 位），可负
  title     String   @default("")
  summary   String   @default("")
  kind      String   @default("event")  // event / init / correction… 便于区分初始化切面
  createdAt DateTime @default(now())
  mutations WorldMutation[]
  @@unique([instant])               // 同一时间点只能有一个切面
  @@index([instant])                // reduce 截断 + timeline 排序主索引
}

// —— 逐条变更：reduce 的原子单位 ——
model WorldMutation {
  id        String   @id @default(cuid())
  sliceId   String
  subjectId String
  instant   BigInt                  // 冗余自所属 slice，便于 (subjectId, instant) 复合索引直接取
  seq       Int      @default(0)    // 同切面内 mutation 的应用顺序
  attr      String                  // 属性路径，如 "hp" / "equipment.weapon" / "memory.师门"
  op        String                  // set / add / unset / listAppend / collectionAdd / collectionRemove
  value     String?                 // 新值 / 增量 / 追加内容（JSON 编码，null 表示 unset 等）
  old       String?                 // 逆操作信息（JSON，已结算缓存；第一版暂不依赖它做 O(1) 回退）
  slice     WorldSlice    @relation(fields: [sliceId], references: [id], onDelete: Cascade)
  subject   WorldSubject  @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  @@index([subjectId, instant, seq])     // ★ reduce 单 subject 主索引
  @@index([subjectId, attr, instant])    // 属性历史 / HP 曲线（后续查询用）
  @@index([attr])                          // 反查引用（后续查询用）
}
```

> `WorldSnapshot` 表第一版不建。reduce 直接从头叠（`fromInstant = -∞`），结果一致；subject/切面规模变大后再引入缓存。

### 切面 kind 集合

`WorldSlice.kind` 是切面的分类标签，**主要给 UI / timeline 列表 / 过滤 / 日志用，不影响 reduce 语义**（reduce 只看 mutations，不看 kind）。

| kind | 用途 |
| --- | --- |
| `event` | 默认。世界里实际发生的事件（战斗、对话、出生、移动…） |
| `init` | 单个 subject 创建时写 default 的初始化切面；world subject 的 init 切面同时锚定纪元（`instant=0`） |
| `correction` | 作者后期修正 / 补设定（往前插切面、修正历史），可特殊样式提醒「这是事后补的设定」 |
| `bootstrap` | 模板创建项目时的批量预制切面（预制 subject、世界观初值）。与 init 区分：bootstrap = 项目级模板初始化，init = 单个 subject 创建 |

**校验严格度**：枚举但允许扩展。未知 kind 默认按 `event` 处理，不报错。模板不强制约束，后续可加 `tick`、`battle`、`dream` 等特殊 kind。这与「mutation 可打未声明属性」的宽松校验风格一致。

### 关键设计说明

- **`instant` 在 mutation 冗余存一份**：避免 reduce 时 join slice。复合索引 `(subjectId, instant, seq)` 让「取 erina 在 ≤t 的全部变更并排好序」是一次纯索引扫描。
- **排序规则**：`WorldSlice.instant` 唯一，时间轴只按 instant 排序；同一切面内用 `WorldMutation.seq` 表达 mutation 应用顺序（如先 set hp 再 listAppend events）。reduce 排序键 = `(instant, mutation.seq)`。
- **`value` / `old` 用 JSON 字符串**：op 的载荷类型多样（数字 / 字符串 / ref / 对象），统一 JSON 编码，应用层按 attr 的 kind 解析。
- **后续查询索引已预留**：`(subjectId, attr, instant)` 与 `(attr)` 索引为 HP 曲线、反查引用预留，第一版不暴露对应 API 但表结构已支持。

## 3. 世界引擎 API 契约（第一版最小）

分层对齐 plot：`WorldEngineFacade`（按 projectPath 建 client、事务边界）→ services（slice 写入、reduce、schema 校验）→ repositories（Prisma 访问）。

```typescript
/** 唯一时间真相源 */
type Instant = bigint;

/** 一条变更 */
interface MutationInput {
    subjectId: string;
    attr: string;                  // "hp" / "equipment.weapon" / "memory.师门"
    op: "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove";
    value?: unknown;               // 新值 / 增量 / 元素；unset 省略
}

/** 写一个切面的输入 */
interface SliceInput {
    instant: Instant;
    title?: string;
    summary?: string;
    kind?: string;                 // 默认 "event"
    mutations: MutationInput[];
}

/** 某 subject 在某时刻 reduce 出的状态（ref 不展开，惰性） */
interface SubjectState {
    subjectId: string;
    type: string;
    attrs: Record<string, unknown>;  // hp:50, equipment:{weapon:"ref:..."}, memory:{...}, events:[...]
}

/** 全量世界状态 = 截断点 + 所有 subject 的状态 */
interface WorldState {
    instant: Instant;              // reduce 截断点（默认最新）
    subjects: SubjectState[];
}

class WorldEngineFacade {
    // —— subject 实例 ——
    /** 创建 subject + 生成「初始化切面」写入 schema default 初值 */
    createSubject(projectPath: string, input: { id: string; type: string; name?: string; at: Instant }): Promise<void>;

    // —— 切面写入 ——
    /** 写一个切面（校验 mutation 合法性，写 slice + mutation 行）。
     *  instant 决定落点；若该 instant 已有 slice，第一版默认合并 mutations 到已有 slice。*/
    writeSlice(projectPath: string, input: SliceInput): Promise<{ sliceId: string }>;

    // —— 状态查询（reduce）——
    /** 全量 reduce：instant（默认最新）的全量世界状态。给 UI / 调试 / 导出用，agent 不直接用（会爆 token）。*/
    getWorldState(projectPath: string, at?: Instant): Promise<WorldState>;

    /** 细粒度查询（agent / 常规业务用）：按 subject / type / 属性投影 / 时刻过滤，避免一次拉全量。
     *  - subjectIds: 只 reduce 这些 subject；省略则按 type 过滤；都省略则全部（慎用）。
     *  - type: 只 reduce 该类型的 subject。
     *  - attrs: 属性投影白名单（如 ["hp","location"]）；省略返回全部属性。
     *  - at: reduce 截断点，默认最新。
     *  - listLimit: list/collection 属性最多返回多少条（如 events 只取最近 N 条），防止超长。*/
    queryState(projectPath: string, query: {
        subjectIds?: string[];
        type?: string;
        attrs?: string[];
        at?: Instant;
        listLimit?: number;
    }): Promise<SubjectState[]>;

    // —— timeline ——
    /** 列切面（按 instant）。range 省略 + limit 取最近 N 个；支持时间段过滤。*/
    listSlices(projectPath: string, query?: {
        from?: Instant;
        to?: Instant;
        limit?: number;          // 最近 N 个（按 instant desc 取，再正序返回）
        withMutations?: boolean; // 是否带每个切面的 mutation 明细，默认 false 只给元数据
    }): Promise<Array<{ id: string; instant: Instant; title: string; summary: string; kind: string; mutations?: MutationInput[] }>>;
}
```

> 后续按需补充：`getAttrHistory`（HP 曲线）、`findReferers`（反查引用）、`editSlice` / `deleteSlice` / `revertSlice`（编辑与回退）。表结构与索引已为它们预留，不需要改 schema。re-settle 是写入 / 编辑 / 删除链路的内部能力，不单独作为 Agent API 暴露。

## 4. reduce 算法（应用层，伪代码）

```
getWorldState(at = 最新):
  subjects = 取所有 WorldSubject
  for s in subjects:
    rows = 取 WorldMutation
           WHERE subjectId=s.id AND instant<=at
           ORDER BY instant, seq
    state = {}
    for m in rows:
      state = applyOp(state, m.attr, m.op, decode(m.value))   # set/add/unset/listAppend/collection*
    收集 { subjectId: s.id, type: s.type, attrs: state }
  return { instant: at, subjects }
```

- `applyOp` 按 attr 的 kind（从项目 schema 配置加载）决定叠加语义；未声明属性默认 scalar。
- 第一版无 snapshot，从头叠；规模变大后再引入缓存，结果不变。

## 5. re-settle（第一版最小）

`old` 是派生缓存，`value` / `op` / `attr` 才是声明式真相。任何会改变过去链条的写入都要触发 re-settle。

第一版触发：

- `writeSlice` 写入的 instant 早于某 subject 的最新 mutation。
- 同 instant 合并导致已有 slice 增加 mutation。
- 后续加入 `editSlice` / `deleteSlice` 时，同样走本流程。

第一版范围：

- 按 subject 粗粒度重算，不做 attr/path 级优化。
- 对本次切面触及的每个 subject，从该 instant 开始读取该 subject 的后续 mutation，按 `(instant, seq)` 排序。
- 从该 instant 之前的状态开始 reduce，逐条重新计算需要记录 old 的 mutation，并更新其 `old`。
- `add` 这类逆操作不依赖 old，但仍可在同一流程中保持一致。

## 6. queryState 与 getWorldState 的关系

- `getWorldState`：返回某一时刻所有 subject 的完整状态。用于 UI 调试、导出、开发验证，不作为 Agent 工具暴露。
- `queryState`：返回某一时刻被 subjectIds / type / attrs / listLimit 收窄后的状态。用于 Agent、常规业务查询和前端局部视图，是第一版正式能力。

## 7. 遗留待定

- subject 身份元数据（type / name 之外是否需要更多）是否也用切面承载，还是固定在 WorldSubject 表。
- 模糊时间（fuzzy / unknown）如何落到 instant INTEGER（可能需要额外的「时间不确定性」列）。
- 后续优化：snapshot 缓存策略、re-settle attr/path 级优化、回退 / 编辑切面 API、细分查询（单 subject / 属性历史 / 反查引用）。
