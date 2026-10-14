# t16 实施计划：nbdev 命令行修补

## Context

- **为什么做**：开发者 2026-10-14 让按 autonomous-delivery 处理 [后续清单](../../followups.md) 的“试用建议”。这是第一档的六条，都是 Agent 用 nbdev 时实际碰到、修了就少一次返工或空等的毛病：
  1. `artifact publish` 把产物目录里所有未跟踪的文件一起提交：Agent 检查页面时写进去的截图被提交过（`b86961ff5` 删掉），10-14 一天里有两个 Agent 报了；
  2. 提问标记不合规时，普通输出只说“有 7 处不合规”，要加 `--json` 才看得到是哪一行、哪道题；
  3. `answers --wait --json` 退出时 stdout 为空，接它的管道直接报错；
  4. `nbdev shot` 在 Lab 里找不到组件时一直等到超时（两分钟）；
  5. `task new` 一律把租约记在调用者名下，只登记、不开工的 Task 每次都要再 `release`；
  6. `work new`、`task new` 的输出列出全部撞号，里面大多与这次领号无关。
- **核实过的事实**（2026-10-14，master `612552810`）：
  - 第 3 条：用真实 `nbdev` 实测，`--timeout` 到点、SIGTERM、SIGINT 都会输出带 `wait_timeout`、`wait_interrupted` 的 JSON 外壳，退出码 4。没接的只有 SIGHUP（终端关闭、宿主收 pane 时发），它走缺省处理直接结束进程，stdout 为空；SIGKILL 接不住。所以这条只补 SIGHUP，并在合同里写明 SIGKILL 之后 stdout 为空时怎么办。
  - 第 1 条：[Proposal](../../../../../docs/proposals/dev-panel.md) 第 203 行把 `contentHash` 定为“入口与它引用的本地文件的摘要”；实现与 [文件格式](../../../../../packages/dev-panel/docs/file-formats.md#发布记录-versionsvnjson) 写成了“产物目录里 Git 会跟踪的全部文件”。这次改回 Proposal 的口径，不算偏离已接受的设计。
  - 第 4 条：Lab 的调试接口 `window.__nbLab.components()` 已经给出可截图的组件清单（`packages/neuro-book/src/plugins/lab/web/LabShell.vue`），清单在 Lab 挂载时就定了；`lab-shot.ts` 的 `openLab` 只等 `state().component === 组件`，组件不在清单里时永远等不到。
- **工作方式**：autonomous-delivery。计划审查走 omp（后端与命令行），实现交给 opus 编码子代理，在集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`）上逐片提交。集成分支不 push（见 [Work README](../../README.md#实施)）。

## 关键设计

### `packages/dev-panel/src/core/artifacts.ts` 与 `questions.ts`：产物的文件集

新增 `artifactFileSet(mainRoot, ref, {entry, seeds})`，返回 `{files: ArtifactFile[]; unreferenced: string[]}`。

- **候选**：`listArtifactFiles` 列得到的文件（Git 不忽略、磁盘上还在、不是符号链接，去掉 `versions/`、`answers/`）。文件集只从候选里取。
- **种子**：
  1. 入口 `entry`；
  2. 已跟踪的文件（`git ls-files --cached`）；
  3. 上一版发布记录的 `files`（见下一节）；
  4. 上一版题表里 `page` 不为 `null` 的页面：旧版本的题所在页面只要还在磁盘上，就不会因为没被链接而被当成“页面里没有了”；
  5. 本次的 `--include`。
- **闭包**：从全部种子出发做广度遍历，对纳入文件集的每个可解析文件继续收集引用，直到集合不再增长。种子本身引用的文件同样会被追到（计划审查第 2 条）。
  - HTML 页（`.html`、`.htm`）：元素的资源属性（`src`、`href`、`poster`、`srcset`）。`script`、`style`、`template`、`noscript` 元素**自己的**属性照样收，只是不进入它们的子节点去找提问标记（计划审查第 1 条）。另外收内联 `<style>` 与 `style` 属性里的 `url(...)`、`@import`，以及内联 `<script type="module">` 里字面量的静态 import 与 `import("…")`；
  - `.css`：`url(...)` 与 `@import`；
  - `.js`、`.mjs`：字面量的 `import … from "…"`、`import "…"`、`import("…")`；
  - 引用的归一化沿用 `checkReferences`：去掉 `?`、`#`，跳过带协议的、`//` 开头的、`/` 开头的、指向产物目录之外的，百分号解码，解码失败按字面。引用检查（`missing_reference`、`reference_outside_artifact`）与文件集**共用同一份引用图**，不各自解析。
- **`srcset` 按 HTML 的候选语法解析**（计划审查第 5 条）：URL 是一段不含空白的字符，后面是描述符，候选之间用逗号分隔。URL 自身含逗号的（`assets/a,b.png 1x`）与 `data:` URL 不会被切开。不再用 `split(",")`。
- `unreferenced`：候选里、不在文件集里的文件（都是未跟踪的），仓库根相对路径。
- `artifactContentHash` 的输入改成文件集。算法本身（路径、NUL、文件 sha256、换行）不变。
- 为了让 `nbdev status` 继续不加载 parse5，解析器在 `artifactFileSet` 里动态 `import`，与发布路径现在的做法一样。

不变量：

- 已跟踪的文件与上一版记下的文件都在种子里，所以已经发布过的内容不会因为这次修改，从哈希、提交与题表里掉出去；
- 有题的旧页还在磁盘上时，也不会被当作删了。

### 发布记录加 `files`

- `versions/v<N>.json` 加字段 `files`：这一版文件集里的路径，相对产物目录，按 UTF-8 字节序排列。只有 `publish` 动作写新的清单；其他动作（`close`、`ask` 等）沿用上一版的，与 `contentHash` 相同。Task 的提问集为 `null`。
- 旧记录没有这个字段时按空清单读，读取不报错。`schema` 仍是 `nbdev.artifact-version/v1`：只加了一个可选字段，旧读者会忽略它。
- **为什么要记**（计划审查第 3 条）：发布记录先落盘、`git add` 后执行。`git add` 失败（`git_lock_timeout`、`git_failed`）时，`--include` 的文件还没有被跟踪。有了 `files`，面板与下一次发布都能按记录找回完整的集合，不依赖提交是否成功；按原命令重跑也只补交，不出新版本。

### `packages/dev-panel/src/core/artifact-ops.ts`：发布

- `publishArtifact` 改用 `artifactFileSet`，种子见上：
  - 提问标记只解析文件集里的 HTML 页，`questions_in_script` 只看文件集里的脚本；
  - 图片体积与引用检查也只看文件集；
  - 要提交的页面文件是 `changedArtifactFiles` 与文件集的交集。
- `unreferenced` 非空时给新警告 `unreferenced_files_not_committed`（`details.paths`），消息写明数量，并提示“页面要用的话就在页面里引用它，或者用 `--include` 列出”。
- `--include <路径>`（可重复）：路径相对产物目录，校验沿用 `assertEntry` 的写法；文件不存在或被 Git 忽略时报 `usage`，不写任何东西。列过一次的文件会记进 `files`，以后的发布不用再列。
- 兼容：旧产物目录里如果有未跟踪的杂项文件，新哈希会与上一版的不同，下一次发布会出新版本（页面与题没变也一样）。这只发生一次，接受。答复里记的 `contentHash` 只是复制下来的版本信息，没有地方拿它与最新的哈希比较（计划审查“未发现问题的方面”已核实），所以旧答复不受影响。

### `packages/dev-panel/src/server/views.ts`：面板的“发布后有改动”

`unpublishedChanges` 改为按 `artifactFileSet` 算哈希，种子与发布时相同：入口、已跟踪的、最新一版的 `files`、最新一版题表里的页面（没有 `--include`，它已经记在 `files` 里）。否则产物目录里只要有一张未跟踪的截图，面板就会一直显示“有未发布的改动”。

### `packages/dev-panel/src/cli/output.ts`：普通输出带出明细

- 新增按错误码、警告码给出明细行的函数 `detailLines(entry)`。普通输出时，在 `错误 [...]`、`警告 [...]` 那一行之后逐条打印，每条缩进两格，最多 20 条，超出的写“另有 N 条，加 --json 看全部”。
- 这次只给下面几种写明细，其余的码不变：

  | 码 | 一条的写法 |
  |---|---|
  | `invalid_questions` | `<page>:<line>:<column> 题 <questionId>：<message> [<code>]`（`ask` 的没有页面与行号，只写题号） |
  | `unreferenced_files_not_committed` | 文件路径 |
  | `missing_reference`、`reference_outside_artifact` | `<page>:<line> <target>` |
- `--json` 的外壳不变。

### `packages/dev-panel/src/cli/artifact-commands.ts`：`answers --wait` 接 SIGHUP

- 等待时同样监听 SIGHUP，处理与 SIGTERM 相同（`wait_interrupted`）。
- [命令行合同](../../../../../packages/dev-panel/docs/cli.md#answers---wait)写明：被 SIGKILL 结束时 stdout 为空，调用方把“退出码不是 0、stdout 为空”当作需要重挂。Claude Code 的 TaskStop 先发 SIGTERM，所以通常仍有外壳。

### `packages/dev-panel/src/core/operations.ts` 与 `src/cli/main.ts`：撞号只报相关的，`--no-lease`

- **只报相关的撞号**：`reportConflicts` 加一个参数，传入这次领的号，只保留涉及它的撞号组：
  - `work new`：Work 号与它的首个 Task 号；
  - `task new`：这个 Work 里的这个 Task 号。

  匹配键：Work 撞号按 `kind` 加 `wNNNNN`，Task 撞号按 `kind` 加完整 `workId` 加 `tNN`，不拿裸的 `t01` 与别的 Work 比。按现在的领号规则（扫描到的最大号加 1，撞号也在同一份扫描里），正常领号时相关撞号总是 0 组（计划审查第 6 条），这里的过滤只是为了以后领号规则变了也不会漏报。

  `data.conflicts` 只放这些，另给 `data.otherConflicts`（其余撞号的组数）；`number_conflicts` 警告只在有相关撞号时给。普通输出在 `otherConflicts > 0` 时加一行“另有 N 组撞号与这次领号无关，见 nbdev status”。`registry import`、`status` 不变，照旧列全部。
- **`--no-lease`**：`work new`、`task new` 接受 `--no-lease`，给了就不取得租约、不写 pane 标签，`data.lease` 为 `null`。调用者照常解析，登记表里的 `by` 照常记调用者（计划审查第 4 条：`by` 是登记的事实，与租约无关）；因为不调 `touchCallerLease`，未知调用者也不会得到 `caller_unknown`。提交失败但号已领时同样不取。命令行合同“自动取得与续期”一节写明这个例外。面板的新建接口不受影响。

### `packages/neuro-book/scripts/lab-shot.ts`：组件不在清单里时立即失败

- `openLab` 的等待条件加一种立即返回的情形：`window.__nbLab` 已经就位，且 `components()` 里没有要截的组件。返回后抛出错误，说明组件不在 Lab 的组件清单里，列出清单里的前若干个组件，并提示“开发服务运行中新建的组件文件或场景，要重启开发服务才进清单”。
- 场景同理：给了 `--scene`、但 `scenes(组件)` 里没有这个场景时立即失败。
- `nbdev shot` 不用改：`lab:shot` 非零退出时它报 `shot_failed`，带 stderr 的末尾，这条提示会出现在里面。
- 旧应用的 `lab:shot`（`packages/neuro-book-legacy`）不改。

## Spec 与文档改动

- `packages/dev-panel/docs/file-formats.md` 的“发布记录”：`contentHash` 改为按文件集算，写明种子与闭包的规则；发布记录加 `files` 字段。
- `packages/dev-panel/docs/cli.md`：
  - 命令表加 `artifact publish --include`，`work new`、`task new` 加 `--no-lease`；
  - “写什么”里改写 `artifact publish` 的提交范围；
  - 写命令的 `data` 加 `otherConflicts`，并改写 `conflicts` 的含义；
  - 警告表加 `unreferenced_files_not_committed`；
  - “`answers --wait`”一节加 SIGHUP 与 SIGKILL；
  - “`--json` 外壳”一节写明普通输出会给出哪几种明细。
- `docs/specs/ui/component-lab.md` 场景 14：加一句“组件或场景不在 Lab 的清单里时立即失败，并提示重启开发服务”。
- [后续清单](../../followups.md)：这六条的“去向”写 t16。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | 文件集、发布、面板的 `unpublishedChanges`、`--include`，对应的文档 | `bun run --cwd packages/dev-panel typecheck`，`bun test` 跑 `src/core/artifacts.test.ts`、`tests/artifacts-cli.test.ts`、`tests/artifacts-write.test.ts`、`tests/panel-core.test.ts` |
| S2 | 普通输出的明细行；SIGHUP | `tests/artifacts-cli.test.ts`、`tests/cli.test.ts` |
| S3 | 撞号只报相关的，`--no-lease` | `tests/cli.test.ts`、`tests/leases-cli.test.ts` |
| S4 | `lab-shot.ts` 立即失败，Lab Spec 一句 | `packages/neuro-book` 的 typecheck；真实开发服务上对一个不存在的组件跑 `bun run lab:shot -- -c NoSuchThing --url …`，确认几秒内失败、提示正确 |

每片单独提交（Conventional Commit，`feat(dev-panel)`、`fix(dev-panel)`，S4 为 `fix(neuro-book)`）。收口时跑 dev-panel 全量：`TMPDIR=/dev/shm/… bun run --cwd packages/dev-panel test`，以及 typecheck、`build:web`。

## 验收映射

dev-panel 的行为合同是包内的 `docs/cli.md` 与 `docs/file-formats.md`，没有编号，按条目写：

| 合同条目 | 覆盖 |
|---|---|
| 发布只提交文件集，未引用的未跟踪文件不提交，给 `unreferenced_files_not_committed` | `tests/artifacts-cli.test.ts` 新场景：产物目录里放一张未引用的截图、一张被 `<img>` 引用的图、一个由 CSS `url()` 引用的字体、一个 `<script src>` 引用的模块和它 import 的第二个模块、一个由 `--include` 列出的 JSON，发布后看提交的文件列表与警告 |
| 闭包：已跟踪的旧页新加的图片、`--include` 列出的 CSS 引用的字体都被提交 | 同上，第二次发布：入口改为只链接 r2，修改仍被跟踪的 r1 并给它加一张新图 |
| `srcset` 里含逗号的路径与 `data:` URL 不被切开，不出伪引用警告 | 同上，一个场景 |
| `git add` 失败后重跑原命令只补交、不出新版本，面板不误报改动 | `tests/artifacts-cli.test.ts`：持有真实的 `index.lock` 让第一次发布报 `git_lock_timeout`，放锁后按原命令重跑；未链接、但有题的页面上的题不被记为取代 |
| `contentHash` 按文件集算；只多出未引用的未跟踪文件时哈希不变、不出新版本 | `src/core/artifacts.test.ts` 改写现有的哈希用例；`artifacts-cli` 里加一个文件后再发布，期望 `unchanged: true` |
| `--include` 指向不存在或被忽略的文件报 `usage`，不写 | `tests/artifacts-cli.test.ts` |
| 面板对未引用的截图不标“有未发布的改动” | `tests/panel-core.test.ts`（或现有的产物视图用例） |
| 普通输出逐条列出 `invalid_questions` 的明细 | `tests/artifacts-cli.test.ts` 用不带 `--json` 的调用断言 stdout 与 stderr |
| `answers --wait` 收到 SIGHUP 时输出 `wait_interrupted` 外壳、退出码 4 | `tests/artifacts-cli.test.ts` 现有的 SIGTERM 场景扩成 SIGTERM 与 SIGHUP 两种 |
| `task new`、`work new` 不再列出与本次领号无关的撞号 | `tests/cli.test.ts`：夹具里放两组旧撞号（一组 Work、一组 Task），真实 `work new`、`task new` 的 `conflicts` 为空、`otherConflicts` 为 2、不给 `number_conflicts`；之后 `status` 与 `registry import` 仍列出两组完整的撞号。相关撞号的过滤用一个纯函数的单元测试覆盖 |
| `--no-lease` 不取租约，登记表的 `by` 仍是调用者 | `tests/leases-cli.test.ts`：成功与提交失败两条路径 |
| `lab:shot` 组件不在清单里时立即失败 | 手动：真实开发服务（见“验证”） |

## 计划审查

2026-10-14 omp（默认模型）审查，报告存为 [evidences/plan-review.txt](evidences/plan-review.txt)：阻断 0、重要 5、建议 1，全部成立，已改进本计划：

1. HTML 解析器跳过 `script` 等元素，会漏收 `<script src>`：改为收这些元素自己的属性；
2. 种子不做闭包，已跟踪的旧页与 `--include` 列出的文件引用的东西会漏交：改为对全部种子做闭包；
3. `git add` 失败后面板与重跑找不回 `--include`，没被链接的有题页面会被当作删了：发布记录加 `files`，上一版题表里的页面也作种子；
4. `--no-lease` 不该连带不认调用者：只跳过租约，登记的 `by` 照记；
5. `srcset` 按逗号切分会切坏含逗号的路径：按候选语法解析；
6. 相关撞号在正常领号时不可能出现：验收改为“旧撞号全部计入 `otherConflicts`”，相关撞号的过滤用纯函数测。

## 验证

- 每片跑上表的受影响测试；收口跑 dev-panel 全量、typecheck、`build:web`，`TMPDIR` 指到 `/dev/shm` 下按任务命名的目录。
- 合入 `master` 后重启面板 4400（`bun run --cwd packages/dev-panel service:restart`），用真实仓库在一个 `.local` 下的临时产物上手动发一次，确认截图不进提交。
- S4 在真实开发服务上验证：`nbdev dev start` 起集成分支的 `packages/neuro-book`，对不存在的组件跑 `nbdev shot -- -c NoSuchThing`，期望几秒内 `shot_failed`，提示里有“重启开发服务”。
- 未验证的边界：脚本里动态拼出来的 `import` 路径追踪不到，只能靠 `--include`；SIGKILL 之后的空输出只写进合同，没有办法测。

## 不做与风险

- 不处理被 Git 忽略、却被页面引用的文件（例如 `*.log`）：它们本来就提交不了，现有的 `missing_reference` 也不报它们。收益小，不做。
- 不改 `nbdev shot` 去解析 `lab:shot` 的错误文案：要区分错误就得按文案分支，违反规则。
- 风险：广度遍历的 JS 与 CSS 正则可能漏掉少见写法。漏掉的文件如果已跟踪，照样在文件集里；没跟踪的会出现在 `unreferenced_files_not_committed` 里，会话能看到并用 `--include` 补上，不会悄悄丢文件。
