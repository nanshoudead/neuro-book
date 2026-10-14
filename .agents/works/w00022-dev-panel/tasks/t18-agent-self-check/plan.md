# t18 实施计划：Agent 自助验收

## Context

- **为什么做**：开发者 2026-10-14 让按 autonomous-delivery 处理 [后续清单](../../followups.md) 的第三档。两条都来自 Agent 的实际报告：
  1. 新 worktree 里起的开发服务是空的，没有作品；Agent 要手动建样例目录、写进 `.dev-state/projects.json` 才能打开工作台；
  2. `nbdev shot` 只能截 Lab 里的组件；要截打开了作品的真实工作台，只能自己写 Playwright 脚本。

  两条合起来，Agent 改了工作台以后，能用两条命令自己起服务、截图验收，不用每次各写一份脚本。
- **现状**（集成分支 `f31ebe9b4`）：
  - `nbdev shot` 是薄包装：地址与输出目录由 nbdev 定，截图逻辑全在目标 checkout 的 `lab:shot` 里（`packages/dev-panel/src/dev/shot.ts`，[命令行合同](../../../../../packages/dev-panel/docs/cli.md#开发服务worktree查找与截图t14)）。这个分工 t14 定过（Proposal 待决问题 14：`shot` 只做薄包装）；
  - neuro-book v2 的作品是一个带 `.nbook/project.json`（`{schema: 1, id}`）的目录，登记在状态根的 `projects.json` 里（`{schema: 1, projects: [{id, name, path}]}`）。状态根缺省是包内被 Git 忽略的 `.dev-state/`，每个 worktree 一份（`src/server/dev/config.ts`）；
  - 登记表每次读取都重读文件；写入只由后端进程做，进程内串行，没有跨进程的锁（`src/server/projects/registry.ts` 的模块头，`docs/specs/runtime/projects.md` 输出第 1、2 条）。登记表在后端进程里创建（`src/server/start.ts`）；开发模式下后端是 `bun run dev` 监督的子进程，环境由 `src/server/dev/run.ts` 的 `backendEnv` 给出（继承监督进程的环境）；
  - 页面就绪有统一的标记：`PageOutlet` 的根元素带 `data-window-state="ready"` 与 `data-rpc-state="online"`（`src/web/PageOutlet.md`），e2e 都先等它；
  - 打开作品的地址是 `/?project=<短名>`（`src/plugins/projects/web/open-project.ts` 的 `projectUrl`）；
  - e2e 里建作品就是写身份文件、写登记表（`e2e/bookshelf.e2e.ts`、`e2e/editor-area.e2e.ts`），没有现成的样例作品。
- **工作方式**：autonomous-delivery。nbdev 一侧是后端，审查派 omp；样例作品与 `page:shot` 在 neuro-book 包里，也按后端与脚本审。实现交给 opus 编码子代理。

## 关键设计

按 t14 的分工，**应用相关的知识留在目标应用里**，nbdev 只负责找到包、传参数、定输出位置、收口：

- 样例作品是什么、怎么登记、打开它的路径是什么，只有 neuro-book 自己知道；
- 怎样算页面就绪，也只有它自己知道。

原计划用一个单独的包脚本 `dev:sample` 直接写 `projects.json`。计划审查指出这样会有两个写者，与后端的整表替换互相覆盖；复用别人的服务时，状态根还可能对不上。所以改为**由开发服务的后端自己放样例**：后端是登记表唯一的写者，用的也是它自己的状态根（计划审查第 1 到 4、6 条）。

### nbdev 与应用之间的约定

- `nbdev dev start --sample` 给开发脚本的环境加 `NBDEV_SAMPLE=1`。这个变量名属于 nbdev 的合同，写进 [命令行合同](../../../../../packages/dev-panel/docs/cli.md)，任何应用都可以按它准备样例数据。
- 应用准备好后，在日志里打一行 `[dev] open-path <同源路径>`，告诉 nbdev 打开样例的地址；准备失败打 `[dev] sample-failed <原因>`，服务照常运行。这两种行与现有的 `[dev] page-ready`、`[dev] backend-ready` 一样，由 nbdev 的日志读取器认出（`src/dev/ready.ts`）。
- nbdev 只用 `new URL(<同源路径>, <就绪地址>)` 拼出地址，不知道 `/?project=` 这类应用路由；路径不是同源的相对路径时忽略这一行，并给警告。

### `packages/neuro-book/src/server/dev/sample.ts`：后端启动时放样例

- 开发配置（`src/server/dev/config.ts`）读 `NBDEV_SAMPLE`，后端的启动配置带 `devSample: boolean`。只有开发模式会设它，生产启动不读这个变量。
- 后端在项目登记就绪之后、`/api/runtime/health` 返回 200 之前，调用 `seedDevSample(registry, {stateRoot, packageRoot})`：
  - 样例的父目录是 `<包目录>/.dev-sample/`（加进根 `.gitignore`）。先用现有的 `checkProjectDirectory` 判断它能不能登记，例如状态根被设成 `.` 或 `.dev-sample` 时会被拒绝；不能登记就打 `sample-failed` 并带上原因，不写任何东西；
  - 登记表里已有短名为 `sample` 的作品：只确认目录与身份还能打开（走后端打开作品时的同一套校验），能打开就沿用；目录不在了，按原 id 重建目录与身份（保留 id），再补回样例内容；身份损坏或 id 冲突时打 `sample-failed`，不覆盖；
  - 没有 `sample`：用登记表现有的 `create`（新建作品，与界面上“新建作品”同一条路径）建目录与身份，再把样例内容复制进去；
  - 登记表本身损坏（`registry-invalid`）时打 `sample-failed`，不改它。
- 样例内容放在 `packages/neuro-book/src/server/dev/sample/`，入库：几章短小的原创正文、一份人物笔记、一份大纲，总共几 KB，不用第三方素材。只在作品目录里缺这些文件时复制，不覆盖用户在样例里改过的文件。
- 成功后打 `[dev] open-path ` 加上 `projectUrl("sample")`（`src/plugins/projects/web/open-project.ts`，含编码规则），短名以登记表实际给的为准。
- 后端因为改文件而重启时会再跑一次：已有就沿用，不重复写。
- 写入都经后端自己的登记表实例，所以合同“登记表只由服务端进程写入”不变，`docs/specs/runtime/projects.md` 不改。同一个状态根同时起两份后端（端口顺延后的第二份）会互相覆盖登记，这是现有的限制，与样例无关，不在本 Task 处理。

### `packages/dev-panel/src/dev/dev-ops.ts`、`ready.ts` 与 `src/cli/dev-commands.ts`：`dev start --sample`

- `--sample` 是启动选项，与 `--ready-pattern`、`--work --task` 一样记进进程登记（`sample: true`）。复用已在跑的服务时，`sample` 与它起时不同，就照现有规则给 `reused_with_different_options`（`details.differences` 里带 `sample`），不另起一份。这样复用别人的服务时，不会出现“样例写进 B、服务读的是 A”的错位（计划审查第 2 条）。
- 读日志认就绪的地方同时认 `open-path` 与 `sample-failed` 两种行。
  - 新起的服务：`READY` 那一行之后紧接一行 `SAMPLE <地址> run=<runId>`，`--json` 时为 `{"event": "sample", "url", "runId"}`；
  - 复用的服务：从日志开头读，同样紧接在 `READY … reused` 之后；
  - `NOT_READY` 之后补出的 `READY` 后面也跟一行 `SAMPLE`；没有 `READY` 就没有 `SAMPLE`，`EXITED` 之后不补发；
  - 到 `READY` 时日志里既没有 `open-path` 也没有 `sample-failed`：给警告 `sample_not_reported`（应用不支持样例，或还没准备好）；
  - 见到 `sample-failed`：给警告 `sample_failed`，带原因。服务照常运行，退出码规则不变。
- 不加新的子进程，所以没有新的截止与信号问题（计划审查第 4 条随这个改法消失）。

### `packages/neuro-book/scripts/page-shot.ts`（包脚本 `page:shot`）：截产品页面

- 参数：
  - `--url <开发服务地址>`；
  - `--path <路径，含查询串>`，缺省 `/`；
  - 步骤：`--click <选择器>` 与 `--wait-for <选择器>` 可以各自重复，**按命令行里出现的顺序依次执行**；
  - `--window <宽x高>`，缺省 `1440x900`；
  - `--full-page`；
  - `--scale`；
  - `--theme light|dark`，用浏览器的 `prefers-color-scheme` 模拟；
  - `--timeout <秒>`：每一步的上限，缺省 120，首次打开要编译；
  - `--out <目录>`。
- **就绪**（计划审查第 5、7 条）：
  1. 打开页面后先等应用自己的就绪标记：`[data-window-state="ready"][data-rpc-state="online"]` 可见，再加上 `document.fonts.ready`。这一步与参数无关，所以不给任何 `--wait-for` 时也不会截到加载页；
  2. 然后按顺序执行步骤：`--click` 点击（Playwright 的自动等待保证可点），`--wait-for` 等选择器可见。点击后要等的新界面写在它后面的 `--wait-for` 里，例如 `--click '[data-shelf-settings]' --wait-for '[data-settings-window]'`；
  3. 最后再等一次 `document.fonts.ready`，然后截图。
  - 不按固定时长等待。
- 输出：
  - 截图 `page.png`；
  - `report.json`：最终地址、窗口尺寸、执行过的步骤、页面错误，以及控制台的 error 与 warning。
- 浏览器的起法沿用 `lab-shot.ts`：Node 运行，`channel: "chrome"`，可以用 `--browser-executable` 指定浏览器。
- 包的说明里给两条常用写法：截书架；打开样例、点开第一章再截图。第二条要写出点击后等文件标签与正文的选择器（按 `e2e/editor-area.e2e.ts` 实际等的东西）。

### `packages/dev-panel/src/dev/shot.ts` 与 `src/cli/dev-commands.ts`：`shot --page`

- 新参数 `--page <路径>`，例如 `--page '/?project=sample'`。给了就运行目标包的 `page:shot`，传 `--url <地址> --path <路径> --out <目录>`；`--` 之后的参数照旧原样转交，步骤参数走这里，顺序保持不变。
- 包里没有 `page:shot` 报 `shot_unavailable`，与没有 `lab:shot` 同一个码，`details.script` 写明缺的是哪个脚本，调用方按 `details.script` 区分。
- 地址、输出目录、`TMPDIR` 的规则与现有的 `shot` 完全相同。

## Spec 与文档改动

- `packages/dev-panel/docs/cli.md`：
  - 命令表加 `dev start --sample`、`shot --page`；
  - “开发服务、worktree、查找与截图”一节写 `NBDEV_SAMPLE`、`[dev] open-path`、`[dev] sample-failed` 的约定，`SAMPLE` 事件的顺序，`sample_not_reported`、`sample_failed` 两个警告，以及 `--sample` 参与复用比较；
  - 警告表加这两个码；
  - `shot_unavailable` 的 `details.script`。
- `packages/dev-panel/docs/file-formats.md` 的进程登记：加 `sample` 字段。
- `packages/neuro-book/README.md`（或包的 AGENTS 入口里讲开发服务的那一段）：`NBDEV_SAMPLE` 与样例作品、`page:shot` 两条常用写法。
- `docs/specs/runtime/projects.md`：不改。样例走后端自己的登记表，写者仍只有一个。
- 待确认清单：
  - 样例作品放在 `<包目录>/.dev-sample/`，以及它的内容；
  - `page:shot` 的缺省窗口 1440×900；
  - 由后端在开发模式下放样例：生产代码多了一个只在开发模式启用的分支。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | neuro-book 后端放样例（`sample.ts`、样例内容、开发配置、`.gitignore`） | 单元测试（见验收映射）；集成分支 worktree 里 `NBDEV_SAMPLE=1 bun run --cwd packages/neuro-book dev`，看日志的 `open-path`，打开它能进工作台；再起一次确认不重复写 |
| S2 | neuro-book 的 `page:shot` | 对 S1 起的服务跑 `bun run --cwd packages/neuro-book page:shot -- --url … --path '/?project=sample' --out /dev/shm/…`，不加任何步骤也截到工作台；再加打开第一章的步骤 |
| S3 | nbdev 的 `dev start --sample`、`shot --page`，合同与测试 | dev-panel typecheck；`tests/dev-live.test.ts`、`tests/find-shot.test.ts` 加场景 |

S1、S2 改 neuro-book 包，S3 改 dev-panel，文件不重叠。但 S3 的真实验收要用到 S1 与 S2，所以按顺序做。

## 验收映射

| 合同条目 | 覆盖 |
|---|---|
| 后端放样例：首次新建、再次沿用、目录被删后按原 id 重建、样例父目录不能登记时 `sample-failed` 且不写、登记表损坏时不改 | neuro-book 的单元测试，用真实临时状态根与 `createProjectRegistry`（沿用 `src/server/testing/projects.ts` 的夹具），断言登记表与作品目录 |
| 放样例不打断其他登记：样例与 `register` 都经同一个登记表实例，两项都保留 | 同上，一个用例里先后与并发调用 |
| `dev start --sample` 设 `NBDEV_SAMPLE=1`，`READY` 后紧接 `SAMPLE`；复用时从日志开头读；`sample-failed` 与没有报告时的两个警告；`--sample` 参与复用比较 | `tests/dev-live.test.ts`：夹具包里放一个假的 `dev` 脚本，按环境变量打不同的日志行 |
| `open-path` 不是同源相对路径时忽略并给警告 | 同上 |
| `shot --page` 运行 `page:shot`，传路径、输出目录，步骤参数顺序不变；没有脚本报 `shot_unavailable` 并带 `details.script` | `tests/find-shot.test.ts`：夹具包里放一个假的 `page:shot`，记录收到的参数 |
| 真实工作台截得出来 | 手动：集成分支上 `nbdev dev start --sample`，再 `nbdev shot --page <SAMPLE 给的路径>`，不加步骤截一张，加“打开第一章”的步骤截一张，确认图里是样例作品与正文；截图记进证据 |

## 验证

- 收口跑 dev-panel 全量、typecheck；neuro-book 包跑 typecheck 与新单元测试。
- 真实验收见上表最后一行，在集成分支的 worktree 上做，用完 `nbdev dev stop`。
- 未验证的边界：旧应用（`packages/neuro-book-legacy`）不认 `NBDEV_SAMPLE`、没有 `page:shot`，`--sample` 时给 `sample_not_reported`，`shot --page` 报 `shot_unavailable`。这是预期行为，不另做。

## 计划审查

2026-10-14 omp（默认模型）审查，报告存为 [evidences/plan-review.txt](evidences/plan-review.txt)。t18 部分阻断 1、重要 6，全部成立：

1. 单独的脚本写登记表，会与后端的整表替换互相覆盖（阻断）：改由后端自己放样例；
2. 复用服务时脚本按调用者的环境写，可能写进另一个状态根：同上，并让 `--sample` 参与复用比较；
3. 样例路径与身份没有走现有校验：改用登记表的 `create` 与打开作品的校验，目录重建时保留 id；
4. 前置脚本没有截止与信号收口：不再有前置脚本；
5. `load` 与字体就绪不代表工作台就绪：`page:shot` 先等应用的就绪标记；
6. 打开样例的地址由 nbdev 拼应用路由，违背薄包装：改由应用在日志里报 `open-path`；
7. 点击前后用同一组 `--wait-for` 表达不了点击后的新界面：步骤按出现顺序执行。

## 不做与风险

- 不在 nbdev 里写 Playwright 逻辑：违反 t14 定下的分工，而且 nbdev 不知道各应用的就绪判据。
- 不做“截图前登录”“截多步流程的每一步”。需要时用步骤参数拼；更复杂的流程还是写 e2e。
- 风险：生产代码里多了一个只在 `NBDEV_SAMPLE=1` 时启用的分支。它只由开发配置打开，生产启动不读这个变量。这是取舍：换来的是登记表只有一个写者。
