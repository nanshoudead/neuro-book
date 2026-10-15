# nb-story 第一版实施计划

## Context

剧情图谱第一版：把 w00005 t34 抽好的 V9 小说记忆图做成能单独使用的查看器、命令行与给外部 Agent 的 Skill。行为合同已定、已提交：

- [`story/queries.md`](../../../../../docs/specs/story/queries.md)：书库、按阅读位置与视角的查询、接口合同、独立服务的 HTTP；
- [`story/viewer.md`](../../../../../docs/specs/story/viewer.md)：网页查看器；
- [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)：`nbstory` 命令与 Skill。

依据：[剧情图谱提案](../../../../../docs/proposals/novel-story-app.md)（包名 `nb-story`、一个包分目录、合同照 w00017 的 `defineRemoteService` 写法、在 master 的新工作树上实现、第一版不做内置问答）、[V9 记忆图提案](../../../../../docs/proposals/novel-memory-v9.md)；[t01 的界面决定 1 到 26](../t01-ui-design/README.md#决定)（图用 Sigma.js，草稿在 `.worktree/w00024-t01-drafts`）；[t02 的决定 1 到 7](../t02-specs/README.md#决定)。

工作方式：

- 在 worktree `.worktree/w00024-t03-impl`（分支 `feat/w00024-nb-story`，从 master 开）里编码，主会话自己写；不派编码子代理。
- 按切片提交；每片自跑验证后提交，全部完成后按审查规则审查（前端交 Sonnet 审查者，核心库、服务与命令行交 omp），再合入。
- 不改 `packages/nb-memory`、`packages/neuro-book` 与其它包的源码；根 `package.json` 的 `workspaces` 是逐个列出的，加一行 `packages/nb-story`，`bun.lock` 随之变化。

## 关键设计

### `packages/nb-story/`（包与目录）

照 dev-panel 的布局（`packages/dev-panel/package.json`、`tsconfig.core.json`）：

```text
packages/nb-story/
  package.json        @notnotype/nb-story，private，bin nbstory → src/cli.ts
  AGENTS.md           引用 ../../AGENTS.md；目录职责、验证命令
  tsconfig.json       服务端与命令行（Bun）
  tsconfig.core.json  只含 src/core、src/contract；types 只给 node，bun 映射到 types/no-bun-in-core.d.ts
  tsconfig.web.json   vue-tsc，src/web
  vite.config.ts      网页构建到 dist/web
  playwright.config.ts
  src/core/  src/contract/  src/server/  src/cli/  src/web/
  skill/     SKILL.md 与 references/
  tests/     bun test 与 *.e2e.ts；fixtures/
  types/no-bun-in-core.d.ts
```

- 依赖：`@notnotype/nb-runtime`（只用 `./remote`）、`typebox`、`@notnotype/nb-ui`、`vue`、`vue-router`、`sigma` 3.0.3、`@sigma/node-border` 3.0.0、`@sigma/utils` 3.0.0、`graphology`、`graphology-layout-forceatlas2`、`graphology-layout-noverlap`（版本照草稿 worktree 的 `package.json`）；devDependencies 照 dev-panel，另加 `@playwright/test`（版本照 `packages/neuro-book`）。
- 脚本：`test`（`bun test`）、`test:e2e`（先 `build:web` 再跑 Playwright）、`typecheck`（三份配置）、`build:web`、`nbstory`。
- 核心库不用 Bun 专有接口，也不碰界面：以后插件在 NeuroBook 的 Node 环境里直接调用它。

### `src/core/dataset.ts`、`src/core/position.ts`（数据与位置）

- 从 w00005 `t27-v9-schema-gold/schema.ts` 搬“编译后的数据集”那一段类型（`Dataset`、`Entity`、`Statement`、`Secret`、`Knowledge`、`Episode`、`LedgerEntry`、`Question`、`Summary`、`Arc`、`Beat`、`TimeAnchor`、`Mention`、`SourceChapter`）与常量表；草稿 schema（zod）不搬。
- 数据集类型由 TypeBox schema 推出（单一来源）：按编译后各类记录分别定义（`sources` 没有 id 与 at，`mentions`、`summaries` 没有 id），覆盖查询会解引用的全部字段，对象允许多出的字段。导入时整份校验（样例书约 30 ms），不符时 `unsupported_format`。
- `position.ts`：`parsePosition("38" | "38.57")`、`formatRef`、`comparePosition`、`visibleAt(at, P)`；只给章时 P 取这一章最后一段。搬自 t27 `query.ts` 前几行。

### `src/core/library.ts`（书库、导入、一代、阅读状态）

落盘：

```text
<书库>/library.json          {format: 1}
<书库>/<书 id>/book.json      {format: 1, id, title, generation, importedAt, source, chapters, paragraphs, extractedThrough}
<书库>/<书 id>/graph.json     导入的数据文件原样
<书库>/<书 id>/reading.json   {position, view, savedAt}
<书库>/.serve.json           服务登记（story.cli，见“src/server/”）
```

- 一代的代号：导入时生成的随机串（`randomUUID`），不复用。
- 导入的原子性：先写到 `<书库>/.importing-<随机>/`，写完 `rename` 成 `<书 id>/`；目标已存在时 `rename` 失败（`ENOTEMPTY`/`EEXIST`）→ 删掉临时目录、报 `book_exists`。两次并发导入恰有一次 `rename` 成功。`books.list` 只列含 `book.json` 的正式目录。中途被杀留下的 `.importing-*` 不自动清：判断不了主人是否还活着，留着只占磁盘。
- 删除：`rename` 成 `.removed-<随机>` 再递归删除。
- 固定一代（`pinBook`）：先打开 `graph.json`，再读 `book.json`，最后核对路径上的 `graph.json` 与打开的是同一个 inode。书目录只会整体移走、从不移回，核对通过时读到的信息与打开的文件属于同一代；不通过就重来（这次查询从新的一代开始）。之后删除、重新导入都不影响已打开的文件。这个窗口只有几微秒，测试只覆盖“固定之后换代仍读到原来那一代”，窗口内的正确性靠这段推理（产品代码不加测试钩子）。
- 阅读状态：先写 `reading.json.<随机>.tmp` 再 `rename`；`rename` 的那一刻就是“写进书库”，后改名的整份生效（一次调用的区间完全包住另一次时排在它之后，仍可线性化）；超过 64 KiB 报 `state_too_large`。没有文件时返回全书开头、`view` 为 `null`。
- 书库版本：`library.json` 或 `book.json` 的 `format` 不认识时只读，写入类方法报 `unsupported_format`。

### `src/core/book-index.ts`（按一代建的索引）

- `openBookIndex(library, id)` 先 `pinBook` 固定一代，按 `(书库, id, 代号)` 从进程内缓存取索引，没有就从固定的文件读数据建一份；缓存最多留 4 份，按最近使用淘汰。一次查询从开始就持有这份索引对象，之后删除、重新导入都不影响它（`story.queries` 时序第 2 条）。
- 索引内容：按 id 的各类记录表；按 `at` 排好的各类记录数组（可见性过滤用二分）；按段的称呼与“引用这一段的记录”表；按秘密的身份说法；按人的知情记录（按 `at` 排）；最新一批主线的批次表（`through` → 主线列表）。

### `src/core/projection.ts`（不剧透的统一出口）

- `new BookView(index, P)` 是只读视图，给出深投影后的记录（`story.queries` 输出 1）：顶层 `at > P` 的不出现；自带位置的子项各按自己的位置过滤（对象的称呼、悬念进展、情节连接 `links[].at`、时间点延迟交代的 `clockAt`/`dateAt`）；指向不可见记录的引用整项省略（说法的 `rel`/`premises`/`secret`、秘密名下的说法、知情记录所指的说法或秘密、悬念进展的 `answer`、情节的参与者、账目的物品、主线所含情节）。所有查询都只经这个视图取数，不直接摸索引里的数组；新查询要用到别的引用字段时先在视图里补过滤。
- 例外只有 `source.read` 的本章 P 之后段落（输出 14），在 `queries/source.ts` 里单独处理。

### `src/core/identity.ts`（合并、显示名、视角）

- 身份连接只在 `book-index.ts` 判定一处：`family === "identity"`、`neg === false`、`about` 恰好是两个不同的已知对象；其中 `certainty === "certain"` 且 `kind` 为 `fact` 或 `belief` 的是确定的。读者合并、角色合并、秘密矩阵读者格与图的边都用这一份。
- 读者视角：P 时可见的确定连接做并查集，得到点；只有不确定连接的一对给 `identity: "uncertain"`（输出 3）。
- 角色视角 C：C 自己的几个对象先合并；每条确定连接看 C 在 P 之前对这条说法或其秘密的最新知情状态（同一位置以秘密为准），知道或读到才合并；读者合并而 C 不合并的给 C 的状态或 `no-record`（输出 5）。可选视角列表 = P 时有知情记录的人物。
- 点的 id 取组成它的第一个人物（没有人物时取最早出现的对象），合并前后人物卡与地址里的 id 都能用。
- 显示名（输出 4）：可见主名 → 出现最多的称呼 → “未具名身份”；重名时出场少的加简短说明（对象的整理标签截短，或类别）。搬 t27 `query.ts` 的 `displayName`、`uniqueName`、`identityGroups` 作起点，按 Spec 改合并依据。

### `src/core/queries/`（各组查询）

一组一个文件，导出纯函数 `(view: ProjectedBook, params) => Result`，结果类型取自合同的 `Static<>`：

| 文件 | 方法 |
|---|---|
| `books.ts` | `books.list`、`book.import`、`book.remove`、`book.info`、`book.stats`、`reading.*` |
| `entities.ts` | `entities.list`、`entity.card`、`entity.knowledge`、`entity.statements`、`entity.episodes` |
| `secrets.ts` | `secrets.matrix` |
| `ledger.ts` | `ledger.tracks`、`ledger.track` |
| `questions.ts` | `questions.list` |
| `timeline.ts` | `timeline` |
| `episodes.ts` | `episodes.list`、`arcs.list`、`chapter.digest` |
| `source.ts` | `source.read`、`source.records` |
| `search.ts` | `search` |
| `graph.ts` | `graph.relations`、`graph.book`、`graph.storyline` |

要点（规则以 Spec 为准，这里只写做法）：

- 秘密矩阵读者行：秘密名下身份说法里最早一条已成立的确定连接，或读者最新知情为知道或读到（输出 9）。搬 t27 `secretTable` 改写。
- 数值对账：`ledger` 记录里已有程序算的 `running` 与 `check`；`gap` 按原文报数减累加值重算；“相对/绝对”按是否已出现原文报出的余额判断（`set`，或带数值 `value` 的收支都算报数），到第一次报数为止 `relative: true`（输出 10）。搬 t27 `ledgerState`。
- 主线：取 `through <= P 的章` 中最大的那一批（输出 13）；未收录的情节标“未归入主线”。
- 段落概要：`beat` 的 `to` 段也可见时才给（输出 14）。
- 关系词推断（输出 16）：数据里 `relations` 方面的归纳是整句，不是关系词，不用。按这一对的亲属类说法（`label` 里出现的姐妹、母女等亲属词，没有时写“亲属”）→ 社交类说法 `label` 里出现的关系称谓（朋友、同桌、室友、搭档、对手、师徒……沿用 t01 草稿定稿时的词表）→ 所属类说法（写“所属”）的先后取第一个。
- 故事线的行（输出 18）：按 P 之前参与情节数取前若干（默认 12）个对象，按两两同场次数用确定性的贪心排列（交汇最多的放中间，依次往两侧放），同分按 id。
- 排序都带最后一级按 id 的比较，保证同一代同一参数结果相同（时序第 1 条）。

### `src/core/cursor.ts`、`src/core/errors.ts`、`src/core/api.ts`

- 游标：`base64url(JSON{g: 代号, h: 参数摘要, o: 偏移})`；参数摘要是去掉 `cursor`、`limit` 后按键排序的参数 JSON 的 SHA-256 前 16 位。代号或摘要不符报 `cursor_invalid`（时序第 4 条）。跨进程、跨重启都能用，因为它只依赖数据与参数。
- `StoryError {code, message, candidates?}`，`code` 取 F1 到 F12；附 HTTP 状态码表 `HTTP_STATUS`。
- `createStoryApi({library})` 返回 `{call(method, params)}`：按合同的 input schema 校验（失败 `invalid_params`）→ 解析 `book` 并固定一代 → 落定阅读位置与视角 → 调查询函数 → 按合同的 output schema 校验结果（不符是程序缺陷，抛普通错误，服务回 500）→ 返回 `{ok: true, value}` 或 `{ok: false, error}`。带着合法旧游标、书却已删除时报 `cursor_invalid`（F10），不报 `book_not_found`。命令行与独立服务都只经它调用，保证两种形式结果相同（`story.queries` 验收 8、`story.cli` 输出 1）。

### `src/contract/contract.ts`（接口合同）

- `export const storyContract = defineRemoteService({id: "nb-story/queries", version: 1, provider: "server", callers: ["browser"], methods: {"books.list": {...}, ...}})`；方法名就是 Spec 方法清单里带点的名字（`defineRemoteService` 只禁止空名、`$` 开头与 `events`、`at`）。
- 每个方法 `input`/`output` 用 typebox 写，`input` 一律 `additionalProperties: false`；`errors` 写这个方法可能给的业务失败码（码名用 Spec 的下划线写法，不与路由层的连字符码重名）。公开类型（`Position`、`Ref`、`RelationNode`、`RelationEdge`、`IdentityState`……）从 schema 用 `Static<>` 导出，网页与命令行共用。
- 合同文件同时是“机器可读的 schema 随包公开”（`story.queries` 方法清单第 4 条）：`package.json` 的 `exports` 给 `./contract`。

### `src/server/`（独立服务，Bun）

- `serve.ts`：`Bun.serve({hostname: "127.0.0.1", port})`，`port` 不给时取 0 让系统分配。顺序：监听 → 写登记 → 打印登录链接；SIGINT/SIGTERM：撤销自己的登记 → `server.stop(true)` → 退出（`story.cli` 输出 5）。
- `auth.ts`：口令 32 字节随机，进程内；`/login?token=` 恒定时间比较，对了建会话（随机 id 存进内存 Set，Cookie `HttpOnly; SameSite=Strict; Path=/`）并 302 到 `/`，不对返回 401 页面。会话没有闲置超时，进程退出即作废。写法参照 `packages/dev-panel/src/server/auth.ts`，不跨包引用；与它不同的是口令可重复使用、没有过期。
- `rpc.ts`：`POST /api/rpc/:method` → `api.call`，状态码按 `HTTP_STATUS`。
- `static.ts`：托管 `dist/web`；`/book/...` 等前端路由回退到 `index.html`；没有会话时页面请求返回 401 页面。
- 每个响应（含 401）带响应头 `x-nbstory-instance: <实例号>`，供命令行判断登记是否有效，不泄露书的内容。
- `registry.ts`（`story.cli` 副作用与数据）：单实例靠操作系统的文件锁。`serve` 打开 `<书库>/.serve.lock`，用 `flock(LOCK_EX | LOCK_NB)`（`bun:ffi` 调 libc；只支持 Linux 与 macOS）拿锁，拿到就一直持有到进程退出，进程怎么死锁都会被内核释放，没有判旧与回收。拿不到锁即已有服务：读 `.serve.json` 给出地址，退出码 3。持锁者监听后把 `{instance, url, port, pid}` 写临时文件再改名成 `.serve.json`（只有持锁者写，发布是原子的）；停止时先删 `.serve.json` 再停止监听、放锁。命令行判断登记是否有效仍按 Spec：地址能连上且响应头实例号相同。任何启动失败都先关掉已开的监听。
- 网页产物不在时 `serve` 先跑一次 `vite build`（照 dev-panel `src/server/build.ts` 的输入摘要做法，简化为只看 `src/web`、`vite.config.ts`、nb-ui 包与 `bun.lock`）。

### `src/cli/`（命令行）

- `main.ts`：一张命令表 `{name, method, positionals, options, format}` 对应 `story.cli` 输入表的每一行；每个位置参数与选项声明自己的解码器，先把命令行的文字解码成合同的参数形状（`--at 38.57` → `{chapter: 38, paragraph: 57}`，`read 38.48-81` → `from`/`to`，`para 38.57` → `chapter`/`paragraph`，数值选项转成数），再交给 `api.call` 按同一份 schema 校验；通用选项 `--book`、`--library`、`--json`、`--at`、`--limit`、`--cursor`。未知命令或参数退出码 2 并打印用法；查询失败 1；`serve` 启动失败 3。
- `format/`：每条命令一个给人读的格式化函数，出处写“章.段”；`--json` 输出 `{"ok": true, "data"}` / `{"ok": false, "error"}`，标准输出只此一份。
- 查看器地址：读登记、判定有效，有效时在给人读的输出末尾附 `<url>/book/<书 id>/<页面>?at=…&entity=…&tab=…`（`story.viewer` 边界与兼容）。
- `serve` 命令才 `import` 服务端代码。

### `src/web/`（查看器）

- **入口与客户端**：`client.ts` 定义 `StoryClient.call(method, params, {signal})`（类型从合同推出）与 `provide`/`inject` 的键；`http-client.ts` 用 `fetch('/api/rpc/<方法>')` 实现，401 转成 F1 页面。页面组件只 `inject` 客户端（`story.viewer` 边界与兼容第 2 条），以后插件换一个实现即可。
- **外壳**（`shell/`）：nb-ui 的 `createGrid`、`GridRenderer`、`useGridLayout`（`packages/nb-ui/src/components/layout/`、`src/composables/useGridLayout.ts`）搭导航、主区、抽屉三栏；收起与阈值规则照工作台外壳的 `layout.ts` 的做法，不引用它。宽度三档按根元素的 `ResizeObserver` 判定。偏好（导航收起、抽屉宽度）存 `localStorage`，读写包 try/catch。
- **阅读状态与路由**（`state/`）：一个 `useReading()` 存位置、视角、页面、对象、页签；`vue-router` 路由 `/book/:id/:page?`，查询串与状态双向同步。打开书时先 `reading.get`，再按“地址写明的优先”合并（`story.viewer` 输出 4）。保存：最后一次变化后 1 秒防抖，`visibilitychange` 为 hidden 与 `pagehide` 时立即用 `fetch(..., {keepalive: true})`（查看器的界面状态只有页面、对象、页签、视角等几个字段，序列化后远小于 keepalive 的 64 KiB 上限；超过 60 KiB 时改发普通请求并记一条诊断。服务端的 64 KiB 限额照 Spec 只算 `view`）；同一时刻一个在途，在途时变化记“脏”，完成后再存最新一份（时序第 1 条）。位置变化时给每个页面的请求换一个 `AbortController` 并带递增序号，旧序号的结果丢弃（时序第 3 条）。
- **页面**（`pages/`）：全书总览、关系图、全书图、人物、秘密、数值、悬念、时间线、情节、原文、说明与统计，各一个组件，只负责取数与排版。
- **部件**（`parts/`）：`RefLink`（出处，点开抽屉原文）、`NameLink`（名字，点开人物卡）、`RecordTags`（明说、角色的说法、角色认为、推断）、`PagedList`（按需分页取数、虚拟滚动、标题写总数）、`EntityCard`（四页签）、`SourceExcerpt`、`LedgerChart`（阶梯线，纯 SVG）。能用 nb-ui 现成组件（Tabs、Accordion、ScrollArea、Badge、Input……）的不另写。
- **图**（`graph/`）：从草稿 worktree 搬 `sigma-kit.ts`（配色、标签绘制、聚焦 reducer、横排带描边的线上字与避让）、`StoryGraph.vue`（改名 `RelationGraph.vue`）、`StoryLine.vue`；`StoryGraph3D.vue` 与 3d-force-graph 不搬。数据从 `graph.relations`/`graph.book`/`graph.storyline` 取，排版在浏览器里算：力导向用 forceatlas2 固定迭代次数加 noverlap，初始位置由点 id 的哈希给出，哈希相同的点按 id 顺序确定性地错开（noverlap 遇到完全重合的点会调 `Math.random()`），迭代到上限后检查剩余重叠、必要时再跑一轮，保证同一数据同一结果（`story.viewer` 输出 25）；“点、名字互不重叠”由 e2e 按浏览器里实际的标签矩形检查；同心、环形按草稿。切层或门槛时用 `animateNodes` 平滑移动；`ResizeObserver` → `sigma.resize()` + `refresh()`（输出 27）。人物卡里的小图用同一套部件、固定环形排版（输出 29）。
- 部件（`parts/`、`graph/` 里能拿 props 在别处渲染的零件）照组件规范与 dev-panel 写同名 `.md`（能力标签、props/emits/slots、关键状态）；页面与外壳按规范豁免。不在 Component Lab 登记场景（t03 决定 2）；界面验证靠真实服务加 Chromium 的 e2e 与截图。

### `skill/`（给外部 Agent 的 Skill）

- `SKILL.md`：触发说明、从仓库运行的方式（`bun <仓库>/packages/nb-story/src/cli.ts`，或在 `packages/nb-story` 下 `bun run nbstory`）、答题步骤、知情题规则、答案格式、防剧透、以原文为准（`story.cli` 输出 8 到 14）。
- `references/commands.md`：每条命令的用途、参数与一个例子，由命令表生成后人工校对，随命令变化同步。

### 测试的位置与样例书

- 测试与被测源码同目录（`src/core/library.test.ts` 这样），按 `docs/testing/README.md` 的“测试文件组织”；测试工具与子进程入口放 `testing/`（不含断言）；浏览器 e2e 放 `e2e/`，用包内声明的 `@playwright/test`（版本照 `packages/neuro-book`）由 Node 运行。
- `tests/fixtures/sample-100ch.json.gz`：t34 `run-med-100/dataset-v9.json` 的 gzip（约 856 KB），测试解压后导入临时书库（t03 决定 1）；来源写进 `tests/fixtures/README.md`。
- `testing/sample.ts` 的 `smallDataset(章数)` 截出前几章的小书，专测并发导入、游标、一代、读写冲突这类要跑很多轮、与数据量无关的合同。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/*.md` | 实现完成后补“实现合同”与证据，晋升由开发者批准；实现中发现 Spec 说不通先停下改 Spec |
| `docs/modules/monorepo-boundaries.md` | 登记 `nb-story` 包的职责与依赖方向（只依赖 nb-runtime 的 remote、nb-ui） |
| `AGENTS.md` 仓库结构图、`packages/AGENTS.md` 成员列表 | 加一行 `nb-story` |
| `packages/nb-story/AGENTS.md` | 新建 |

## 切片

每片在 worktree 里提交一次（大的可以拆成几次），提交前跑该片的验证命令与 `bun run --cwd packages/nb-story typecheck`。

| 片 | 内容（对应关键设计） | 自跑验证 |
|---|---|---|
| S1 | 包骨架、`dataset.ts`、`position.ts`、`library.ts`、样例书 fixture、文档登记 | `bun test src/core/library.test.ts` |
| S2 | `contract.ts`（全部方法的 schema）、`errors.ts`、`cursor.ts`、`api.ts`、`book-index.ts`、`projection.ts`、`identity.ts`、`books.ts`、`entities.ts`、`secrets.ts` | `bun test src/core` |
| S3 | `ledger.ts`、`questions.ts`、`timeline.ts`、`episodes.ts`、`source.ts`、`search.ts`、`graph.ts`；全量不剧透检查 | 同上 |
| S4 | `src/cli/`：命令表与解码器、格式化、`--json`、退出码、查看器地址（地址部分先按登记文件做，S5 后联调） | `bun test src/cli` |
| S5 | `src/server/`：serve、auth、rpc、static、registry（文件锁）、产物构建 | `bun test src/server` |
| S6 | 网页：客户端、外壳、阅读状态与路由、全书总览、人物与人物卡、秘密、说明与统计、原文；零件的同名文档 | `typecheck`、`build:web`、本机 serve 后浏览器自检 |
| S7 | 网页：数值、悬念、时间线、情节、长列表、搜索 | 同上 |
| S8 | 网页：关系图、人物卡小图、全书图（故事线与按关联） | 同上 |
| S9 | e2e：`story.viewer` 验收 1 到 8 与时序矩阵；宽屏、平板两档截图；`story.queries` 验收 11 | `bun run --cwd packages/nb-story test:e2e` |
| S10 | Skill 与命令参考；用 Claude Code 跑 `story.cli` 验收 5，答案与判分进 Task 证据 | 见“验证” |

S1 到 S5 不依赖界面，做完先合入一次（t03 决定 3），让命令行与 Skill 早点能用；S6 起是网页。

## 验收映射

测试文件与被测模块同目录；下表写到文件名为止。

| Spec 条目 | 覆盖 |
|---|---|
| `story.queries` 输出 1、验收 1 | `src/core/spoiler.test.ts`：经公开的 `api.call`，在 1、8、38、100、38.57 调全部只读方法。递归核对出处与 id 的成立位置只作辅助；另按项断言：显示名与称呼只用可见称呼、身份分组与按可见连接重算的分组相同、计数与总数等于视图里重算的条数、主线批次是最近一批、`toc` 里 P 所在章之后的标题为 null。全书元数据（`extractedThrough`、`book.stats.extraction`、书库列表）与本章之后的原文按 Spec 开例外。每项判据做一次变异检查 |
| `story.queries` 输出 2 到 19 | `src/core/queries/*.test.ts` 按组各一份（输出编号写在用例名里） |
| `story.queries` 验收 2、3、4 | `src/core/identity.test.ts`、`src/core/queries/secrets.test.ts`；另用构造的小书覆盖否定身份说法不合并 |
| `story.queries` 验收 5、6、7 | `src/core/queries/ledger.test.ts`（含首笔收支即报余额、相对账本后来首次报余额）、`episodes.test.ts`、`source.test.ts`；嵌套可见性（父可见子不可见、连接两端可见而连接未成立）在 `src/core/projection.test.ts` |
| `story.queries` 验收 8 | `src/server/server.test.ts`：同一组参数进程内与 HTTP 逐字段比较 |
| `story.queries` 验收 9、10，F1 到 F11 | `src/core/library.test.ts`（真进程中途结束导入；两个子进程并发导入；固定一代后换代）、`src/core/api.test.ts`（游标四组：删除未重导入、同 id 换代、参数改变、另一进程继续；结果按 output schema 校验） |
| `story.queries` 验收 11、F12 | `e2e/login.e2e.ts` |
| `story.cli` 输出 1 到 7、F1 到 F3、验收 1、2 | `src/cli/cli.test.ts`（子进程跑真实命令，按命令表逐条覆盖，含 `read` 范围、`para` 章段、`--at` 与数值选项） |
| `story.cli` 验收 3、4 | `src/server/server.test.ts`（真 serve 子进程；SIGKILL 后再启动；并发启动恰有一个成功）、`e2e/viewer-url.e2e.ts` |
| `story.cli` 输出 8 到 14、验收 5 | Skill 审阅加一次外部 Agent 评测，记录进 Task 证据 |
| `story.viewer` 输出 1 到 33 | S6 到 S8 浏览器自检；验收场景与时序矩阵覆盖的由 e2e 断言 |
| `story.viewer` 验收 1 到 8、F1 到 F5 | `e2e/viewer-*.e2e.ts`，每个验收场景一份或一组 |
| `story.viewer` 时序第 1、3、5 条，输出 4、25 | `e2e/viewer-timing.e2e.ts`：延后真实请求的返回后切换位置，看页面、人物卡与原文抽屉、搜索、图都不显示旧位置的内容；在途保存时继续操作，保存返回不回滚界面；变化后立即关闭页面，重新打开读到最新状态；地址里当前位置还不存在的对象与视角被去掉并提示；打开着的抽屉跨宽度档内容不变；同一排版重复两次坐标相同、点与标签矩形不重叠 |

## 验证

- 每片：`bun run --cwd packages/nb-story typecheck`、`bun run --cwd packages/nb-story test`（或该片的目录）；`bun run governance:check` 看新包的测试写法警告。
- 端到端：`bun packages/nb-story/src/cli.ts import <样例书> --title …` 到临时书库 → `serve` → 用打印的链接在 Chromium 打开，宽屏与平板各走一遍 `story.viewer` 验收 1 到 5（Smoke）；命令行跑 `story.cli` 验收 1 到 4。
- e2e 照 `docs/testing/README.md` 的浏览器 E2E：Playwright 在 Node 里跑、`channel: "chrome"`、被测服务由用例自己起停。跑之前停掉多余的开发服务（包括 t01 草稿的 4217）。
- `story.cli` 验收 5：在仓库外的临时目录里，用 Claude Code（记下版本与模型）读 Skill 后回答 16 道题各 3 遍；判分由一个独立的 omp 会话按提案评测的判分方式做，确定性检查（引用出处、不提阅读位置之后）用脚本做。
- 明确不验证：手机宽度只看能显示；不跑 NeuroBook 内的插件形态。

## 计划审查（2026-10-15）

一个 omp 会话审查本计划，报告 [evidences/plan-review.txt](evidences/plan-review.txt)：18 条（阻断 2、重要 13、建议 3）。处理已写进上文各节：一代的固定（1）、服务单实例改用文件锁（2）、导入目录不自动回收（4）、整份 schema 校验（5）、深投影（6）、否定身份说法（7）、相对余额判据（8）、命令行解码器（10）、游标优先级（11）、结果校验（12）、排版确定性（13）、防剧透按项断言（14）、查看器时序矩阵（15）、`@playwright/test`（16）、测试与源码同目录（17）、零件同名文档（18）。不改的两条：阅读状态以改名为写入时刻，仍可线性化（3）；查看器的界面状态远小于 keepalive 上限，服务端的 64 KiB 只算 `view`（9）。

## 不做与风险

- 不做：内置问答、3D 图、插件接入、发布安装包、书库管理界面（只有命令行导入与删除）。
- **数据规模**：100 章 5.4 MB 的图整份读进内存建索引，单本书在百 MB 以内都没问题；更大的书要换存储，第一版不处理。
- **1 秒判据**：人物卡记录页签上千条，靠服务端分页加前端虚拟滚动；若首屏超时，先看索引里的按人分组是否命中，再考虑预计算。
- **合同与插件通道的错误码**：进程内与 HTTP 的参数错误报 `invalid_params`；以后走插件通道时路由层会先报 `invalid-input`。接插件时在提供方保持 `invalid_params` 不变，或在 Spec 里写明两者的对应，留到接插件时定。
- **登记判定的网络请求**：命令行每次查询都要判定登记是否有效（一次本机请求），连不上时有 300 毫秒超时，不拖慢查询。
- **文件锁的平台**：单实例用 `flock`，只支持 Linux 与 macOS（与 dev-panel 一样不支持 Windows）。
- **草稿搬运**：草稿里的图代码是为截图写的，搬过来时要补清理（`kill` Sigma 实例、停布局 worker）与错误路径；不把草稿的假数据结构带进产品代码。
