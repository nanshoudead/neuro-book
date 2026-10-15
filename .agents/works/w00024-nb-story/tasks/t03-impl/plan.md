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

- 依赖：`@notnotype/nb-runtime`（只用 `./remote`）、`typebox`、`@notnotype/nb-ui`、`vue`、`vue-router`、`sigma` 3.0.3、`@sigma/node-border` 3.0.0、`@sigma/utils` 3.0.0、`graphology`、`graphology-layout-forceatlas2`、`graphology-layout-noverlap`（版本照草稿 worktree 的 `package.json`）；devDependencies 照 dev-panel，另加 `playwright-core`（根已有，按根版本）。
- 脚本：`test`（`bun test`）、`test:e2e`（先 `build:web` 再跑 Playwright）、`typecheck`（三份配置）、`build:web`、`nbstory`。
- 核心库不用 Bun 专有接口，也不碰界面：以后插件在 NeuroBook 的 Node 环境里直接调用它。

### `src/core/dataset.ts`、`src/core/position.ts`（数据与位置）

- 从 w00005 `t27-v9-schema-gold/schema.ts` 搬“编译后的数据集”那一段类型（`Dataset`、`Entity`、`Statement`、`Secret`、`Knowledge`、`Episode`、`LedgerEntry`、`Question`、`Summary`、`Arc`、`Beat`、`TimeAnchor`、`Mention`、`SourceChapter`）与常量表；草稿 schema（zod）不搬。
- 导入时的校验用 typebox 写一份数据集 schema：顶层 `schema === "neurobook.memory.v9"`、各数组存在且元素有 `id`/`at`；不对每条记录逐字段严格校验（数据由同一管线产出，严格校验只会拖慢导入）。不符时 `unsupported_format`。
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
- 导入的原子性：先写到 `<书库>/.importing-<随机>/`，写完 `rename` 成 `<书 id>/`；目标已存在时 `rename` 失败（`ENOTEMPTY`/`EEXIST`）→ 删掉临时目录、报 `book_exists`。两次并发导入恰有一次 `rename` 成功。启动时不清扫别人的 `.importing-*`；`books.list` 只列含 `book.json` 的正式目录。中途被杀留下的 `.importing-*` 由下一次导入顺手清掉超过一小时的。
- 删除：`rename` 成 `.removed-<代号>` 再递归删除，删除前已开始的查询用的是内存里的那一代（见下一节），不受影响。
- 阅读状态：先写 `reading.json.<随机>.tmp` 再 `rename`，后到者整份覆盖；超过 64 KiB 报 `state_too_large`。没有文件时返回全书开头、`view` 为 `null`。
- 书库版本：`library.json` 或 `book.json` 的 `format` 不认识时只读，写入类方法报 `unsupported_format`。

### `src/core/book-index.ts`（按一代建的索引）

- `openBook(library, id)` 读 `book.json` 拿到代号，按 `(id, 代号)` 从进程内缓存取索引，没有就读 `graph.json` 建一份；缓存最多留 4 份，按最近使用淘汰。一次查询从开始就持有这份索引对象，之后删除、重新导入都不影响它（`story.queries` 时序第 2 条）。
- 索引内容：按 id 的各类记录表；按 `at` 排好的各类记录数组（可见性过滤用二分）；按段的称呼与“引用这一段的记录”表；按秘密的身份说法；按人的知情记录（按 `at` 排）；最新一批主线的批次表（`through` → 主线列表）。

### `src/core/projection.ts`（不剧透的统一出口）

- `project(index, P)` 返回一个只读视图：每类记录只含 `at <= P` 的，并提供 `ref(id)`：关联对象不可见时返回 `undefined`，调用方据此省略引用（`story.queries` 输出 1）。所有查询都只经这个视图取数，不直接摸索引里的数组；这是“过滤在核心库里做”的唯一入口，测试的全量不剧透检查也针对它。
- 例外只有 `source.read` 的本章 P 之后段落（输出 14），在 `queries/source.ts` 里单独处理。

### `src/core/identity.ts`（合并、显示名、视角）

- 确定的身份连接：`family === "identity"`、`certainty === "certain"`、`kind` 为 `fact` 或 `belief` 的说法，`about` 里的两个对象相连。
- 读者视角：P 时可见的确定连接做并查集，得到点；只有不确定连接的一对给 `identity: "uncertain"`（输出 3）。
- 角色视角 C：C 自己的几个对象先合并；每条确定连接看 C 在 P 之前对这条说法或其秘密的最新知情状态（同一位置以秘密为准），知道或读到才合并；读者合并而 C 不合并的给 C 的状态或 `no-record`（输出 5）。可选视角列表 = P 时有知情记录的人物。
- 显示名（输出 4）：可见主名 → 出现最多的称呼 → “未具名身份”；重名时次要的加简短说明（取 `note` 或类别）。搬 t27 `query.ts` 的 `displayName`、`uniqueName`、`identityGroups` 作起点，按 Spec 改合并依据。

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
- 数值对账：`ledger` 记录里已有程序算的 `running` 与 `check`；`gap` 按原文报数减累加值重算，第一笔不是 `set` 时 `relative: true`（输出 10）。搬 t27 `ledgerState`。
- 主线：取 `through <= P 的章` 中最大的那一批（输出 13）；未收录的情节标“未归入主线”。
- 段落概要：`beat` 的 `to` 段也可见时才给（输出 14）。
- 关系词推断（输出 16）：先取 `summaries` 里 `relations` 方面的归纳；没有时按 `kinship` → `social` 的 `label` → `membership` 的先后取第一条。
- 故事线的行（输出 18）：按 P 之前参与情节数取前若干（默认 12）个对象，按两两同场次数用确定性的贪心排列（交汇最多的放中间，依次往两侧放），同分按 id。
- 排序都带最后一级按 id 的比较，保证同一代同一参数结果相同（时序第 1 条）。

### `src/core/cursor.ts`、`src/core/errors.ts`、`src/core/api.ts`

- 游标：`base64url(JSON{g: 代号, h: 参数摘要, o: 偏移})`；参数摘要是去掉 `cursor`、`limit` 后按键排序的参数 JSON 的 SHA-256 前 16 位。代号或摘要不符报 `cursor_invalid`（时序第 4 条）。跨进程、跨重启都能用，因为它只依赖数据与参数。
- `StoryError {code, message, candidates?}`，`code` 取 F1 到 F12；附 HTTP 状态码表 `HTTP_STATUS`。
- `createStoryApi({library})` 返回 `{call(method, params)}`：按合同的 input schema 校验（`validationProblems`，失败 `invalid_params`）→ 解析 `book` 与对象名 → 调查询函数 → 返回 `{ok: true, value}` 或 `{ok: false, error}`。命令行与独立服务都只经它调用，保证两种形式结果相同（`story.queries` 验收 8、`story.cli` 输出 1）。

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
- `registry.ts`（`story.cli` 副作用与数据）：登记 `<书库>/.serve.json = {instance, url, port, pid}`。写入用排他创建（`open(..., "wx")`）；已存在时先判定有效（`fetch(url)` 能连上且响应头实例号相同），无效就 `rename` 成 `.serve.json.stale-<随机>` 再删、重试排他创建；有效则启动失败（退出码 3）并给出地址。两次并发启动只有一个排他创建成功。撤销时读回文件、实例号是自己的才删。
- 网页产物不在时 `serve` 先跑一次 `vite build`（照 dev-panel `src/server/build.ts` 的输入摘要做法，简化为只看 `src/web`、`vite.config.ts`、nb-ui 包与 `bun.lock`）。

### `src/cli/`（命令行）

- `main.ts`：一张命令表 `{name, method, positionals, options, format}` 对应 `story.cli` 输入表的每一行；通用选项 `--book`、`--library`、`--json`、`--at`、`--limit`、`--cursor`；参数名连字符转驼峰后原样交给 `api.call`。未知命令或参数退出码 2 并打印用法；查询失败 1；`serve` 启动失败 3。
- `format/`：每条命令一个给人读的格式化函数，出处写“章.段”；`--json` 输出 `{"ok": true, "data"}` / `{"ok": false, "error"}`，标准输出只此一份。
- 查看器地址：读登记、判定有效，有效时在给人读的输出末尾附 `<url>/book/<书 id>/<页面>?at=…&entity=…&tab=…`（`story.viewer` 边界与兼容）。
- `serve` 命令才 `import` 服务端代码。

### `src/web/`（查看器）

- **入口与客户端**：`client.ts` 定义 `StoryClient.call(method, params, {signal})`（类型从合同推出）与 `provide`/`inject` 的键；`http-client.ts` 用 `fetch('/api/rpc/<方法>')` 实现，401 转成 F1 页面。页面组件只 `inject` 客户端（`story.viewer` 边界与兼容第 2 条），以后插件换一个实现即可。
- **外壳**（`shell/`）：nb-ui 的 `createGrid`、`GridRenderer`、`useGridLayout`（`packages/nb-ui/src/components/layout/`、`src/composables/useGridLayout.ts`）搭导航、主区、抽屉三栏；收起与阈值规则照工作台外壳的 `layout.ts` 的做法，不引用它。宽度三档按根元素的 `ResizeObserver` 判定。偏好（导航收起、抽屉宽度）存 `localStorage`，读写包 try/catch。
- **阅读状态与路由**（`state/`）：一个 `useReading()` 存位置、视角、页面、对象、页签；`vue-router` 路由 `/book/:id/:page?`，查询串与状态双向同步。打开书时先 `reading.get`，再按“地址写明的优先”合并（`story.viewer` 输出 4）。保存：最后一次变化后 1 秒防抖，`visibilitychange` 为 hidden 与 `pagehide` 时立即用 `fetch(..., {keepalive: true})`；同一时刻一个在途，在途时变化记“脏”，完成后再存最新一份（时序第 1 条）。位置变化时给每个页面的请求换一个 `AbortController` 并带递增序号，旧序号的结果丢弃（时序第 3 条）。
- **页面**（`pages/`）：全书总览、关系图、全书图、人物、秘密、数值、悬念、时间线、情节、原文、说明与统计，各一个组件，只负责取数与排版。
- **部件**（`parts/`）：`RefLink`（出处，点开抽屉原文）、`NameLink`（名字，点开人物卡）、`RecordTags`（明说、角色的说法、角色认为、推断）、`PagedList`（按需分页取数、虚拟滚动、标题写总数）、`EntityCard`（四页签）、`SourceExcerpt`、`LedgerChart`（阶梯线，纯 SVG）。能用 nb-ui 现成组件（Tabs、Accordion、ScrollArea、Badge、Input……）的不另写。
- **图**（`graph/`）：从草稿 worktree 搬 `sigma-kit.ts`（配色、标签绘制、聚焦 reducer、横排带描边的线上字与避让）、`StoryGraph.vue`（改名 `RelationGraph.vue`）、`StoryLine.vue`；`StoryGraph3D.vue` 与 3d-force-graph 不搬。数据从 `graph.relations`/`graph.book`/`graph.storyline` 取，排版在浏览器里算：力导向用 forceatlas2 固定迭代次数加 noverlap，初始位置由点 id 的哈希给出，保证同一数据同一结果（`story.viewer` 输出 25）；同心、环形按草稿。切层或门槛时用 `animateNodes` 平滑移动；`ResizeObserver` → `sigma.resize()` + `refresh()`（输出 27）。人物卡里的小图用同一套部件、固定环形排版（输出 29）。
- 组件说明照 dev-panel 的做法：在组件头写用途与约束，不在 Component Lab 登记场景（Lab 属于 `packages/neuro-book`，以后接成插件时再登记）；界面验证靠真实服务加 Chromium 的 e2e 与截图。

### `skill/`（给外部 Agent 的 Skill）

- `SKILL.md`：触发说明、从仓库运行的方式（`bun <仓库>/packages/nb-story/src/cli.ts`，或在 `packages/nb-story` 下 `bun run nbstory`）、答题步骤、知情题规则、答案格式、防剧透、以原文为准（`story.cli` 输出 8 到 14）。
- `references/commands.md`：每条命令的用途、参数与一个例子，由命令表生成后人工校对，随命令变化同步。

### `tests/fixtures/`（样例书）

- `sample-100ch.json.gz`：t34 `run-med-100/dataset-v9.json` 的 gzip（约 856 KB），测试解压后导入临时书库。按根 AGENTS.md，小说数据可以进 Git；来源写进 `tests/fixtures/README.md`。
- 另由 `tests/fixtures/tiny-book.ts` 生成几章的小书，专测并发导入、游标、一代、读写冲突这类与数据量无关的合同。

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
| S1 | 包骨架、`dataset.ts`、`position.ts`、`library.ts`、样例书 fixture、文档登记 | `bun test tests/library.test.ts` |
| S2 | `contract.ts`（全部方法的 schema）、`errors.ts`、`cursor.ts`、`api.ts`、`book-index.ts`、`projection.ts`、`identity.ts`、`books.ts`、`entities.ts`、`secrets.ts` | `bun test tests/queries-*.test.ts` |
| S3 | `ledger.ts`、`questions.ts`、`timeline.ts`、`episodes.ts`、`source.ts`、`search.ts`、`graph.ts`；全量不剧透检查 | 同上，加 `tests/spoiler-sweep.test.ts` |
| S4 | `src/cli/`：命令表、格式化、`--json`、退出码、查看器地址（地址部分先按登记文件做，S5 后联调） | `bun test tests/cli.test.ts` |
| S5 | `src/server/`：serve、auth、rpc、static、registry、产物构建 | `bun test tests/server.test.ts` |
| S6 | 网页：客户端、外壳、阅读状态与路由、全书总览、人物与人物卡、秘密、说明与统计、原文 | `typecheck`、`build:web`、本机 serve 后浏览器自检 |
| S7 | 网页：数值、悬念、时间线、情节、长列表、搜索 | 同上 |
| S8 | 网页：关系图、人物卡小图、全书图（故事线与按关联） | 同上 |
| S9 | e2e：`story.viewer` 验收 1 到 8；宽屏、平板两档截图；`story.queries` 验收 11 | `bun run --cwd packages/nb-story test:e2e` |
| S10 | Skill 与命令参考；用 Claude Code 跑 `story.cli` 验收 5，答案与判分进 Task 证据 | 见“验证” |

S1 到 S5 不依赖界面，可以先合并一次让命令行与 Skill 早点能用；S6 起是网页。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `story.queries` 输出 1、验收 1 | `tests/spoiler-sweep.test.ts`：样例书在 1、8、38、100、38.57 调全部只读方法，递归检查结果里每个出处与 id 的成立位置 |
| `story.queries` 输出 2 到 19 | `tests/queries-*.test.ts` 按组各一份（输出编号写在用例名里） |
| `story.queries` 验收 2、3、4 | `tests/queries-identity.test.ts`、`queries-secrets.test.ts` |
| `story.queries` 验收 5、6、7 | `tests/queries-ledger.test.ts`、`queries-episodes.test.ts`、`queries-source.test.ts` |
| `story.queries` 验收 8 | `tests/server.test.ts`：同一组参数进程内与 HTTP 逐字段比较 |
| `story.queries` 验收 9、10，F1 到 F11 | `tests/library.test.ts`、`tests/cursor.test.ts`（真进程中途结束导入；两个子进程并发导入） |
| `story.queries` 验收 11、F12 | `tests/viewer-login.e2e.ts` |
| `story.cli` 输出 1 到 7、F1 到 F3、验收 1、2 | `tests/cli.test.ts`（子进程跑真实命令） |
| `story.cli` 验收 3、4 | `tests/server.test.ts`（真 serve 子进程；强杀后再启动；并发启动）、`tests/viewer-url.e2e.ts` |
| `story.cli` 输出 8 到 14、验收 5 | Skill 审阅加一次外部 Agent 评测，记录进 Task 证据 |
| `story.viewer` 输出 1 到 33 | S6 到 S8 浏览器自检；验收场景覆盖的由 e2e 断言 |
| `story.viewer` 验收 1 到 8、F1 到 F5 | `tests/viewer-*.e2e.ts`，每个验收场景一份或一组 |

## 验证

- 每片：`bun run --cwd packages/nb-story typecheck`、`bun run --cwd packages/nb-story test`（或该片的测试文件）；`bun run governance:check` 看新包的测试写法警告。
- 端到端：`bun packages/nb-story/src/cli.ts import <样例书> --title …` 到临时书库 → `serve` → 用打印的链接在 Chromium 打开，宽屏与平板各走一遍 `story.viewer` 验收 1 到 5（Smoke）；命令行跑 `story.cli` 验收 1 到 4。
- e2e 照 `docs/testing/README.md` 的浏览器 E2E：Playwright 在 Node 里跑、`channel: "chrome"`、被测服务由用例自己起停。跑之前停掉多余的开发服务（包括 t01 草稿的 4217）。
- `story.cli` 验收 5：在仓库外的临时目录里，用 Claude Code（记下版本与模型）读 Skill 后回答 16 道题各 3 遍；判分由一个独立的 omp 会话按提案评测的判分方式做，确定性检查（引用出处、不提阅读位置之后）用脚本做。
- 明确不验证：手机宽度只看能显示；不跑 NeuroBook 内的插件形态。

## 不做与风险

- 不做：内置问答、3D 图、插件接入、发布安装包、书库管理界面（只有命令行导入与删除）。
- **数据规模**：100 章 5.4 MB 的图整份读进内存建索引，单本书在百 MB 以内都没问题；更大的书要换存储，第一版不处理。
- **1 秒判据**：人物卡记录页签上千条，靠服务端分页加前端虚拟滚动；若首屏超时，先看索引里的按人分组是否命中，再考虑预计算。
- **合同与插件通道的错误码**：进程内与 HTTP 的参数错误报 `invalid_params`；以后走插件通道时路由层会先报 `invalid-input`。接插件时在提供方保持 `invalid_params` 不变，或在 Spec 里写明两者的对应，留到接插件时定。
- **登记判定的网络请求**：命令行每次查询都要判定登记是否有效（一次本机请求），连不上时有 300 毫秒超时，不拖慢查询。
- **草稿搬运**：草稿里的图代码是为截图写的，搬过来时要补清理（`kill` Sigma 实例、停布局 worker）与错误路径；不把草稿的假数据结构带进产品代码。
