# t18 实施计划：Agent 自助验收

## Context

- **为什么做**：开发者 2026-10-14 让按 autonomous-delivery 处理 [后续清单](../../followups.md) 的第三档。两条都来自 Agent 的实际报告：
  1. 新 worktree 里起的开发服务是空的，没有作品；Agent 要手动建样例目录、写进 `.dev-state/projects.json` 才能打开工作台；
  2. `nbdev shot` 只能截 Lab 里的组件；要截打开了作品的真实工作台，只能自己写 Playwright 脚本。

  两条合起来，Agent 改了工作台以后，能用两条命令自己起服务、截图验收，不用每次各写一份脚本。
- **现状**（集成分支 `f31ebe9b4`）：
  - `nbdev shot` 是薄包装：地址与输出目录由 nbdev 定，截图逻辑全在目标 checkout 的 `lab:shot` 里（`packages/dev-panel/src/dev/shot.ts`，[命令行合同](../../../../../packages/dev-panel/docs/cli.md#开发服务worktree查找与截图t14)）。这个分工 t14 定过（Proposal 待决问题 14：`shot` 只做薄包装）；
  - neuro-book v2 的作品是一个带 `.nbook/project.json`（`{schema: 1, id}`）的目录，登记在状态根的 `projects.json` 里（`{schema: 1, projects: [{id, name, path}]}`）。状态根缺省是包内被 Git 忽略的 `.dev-state/`，每个 worktree 一份（`src/server/dev/config.ts`）；
  - 登记表每次读取都重读文件，服务不用重启就能看到新登记的作品（`src/server/projects/registry.ts` 的模块头）；
  - 打开作品的地址是 `/?project=<短名>`（`src/plugins/projects/web/open-project.ts` 的 `projectUrl`）；
  - e2e 里建作品就是写身份文件、写登记表（`e2e/bookshelf.e2e.ts`、`e2e/editor-area.e2e.ts`），没有现成的样例作品。
- **工作方式**：autonomous-delivery。nbdev 一侧是后端，审查派 omp；`page:shot` 与样例作品在 neuro-book 包里，也按后端与脚本审。实现交给 opus 编码子代理。

## 关键设计

按 t14 的分工，**应用相关的知识留在目标 checkout 的包脚本里**，nbdev 只负责找到包、传参数、定输出位置、收口：

- 样例作品是什么、怎么登记，只有 neuro-book 自己知道；
- 怎样算页面就绪，也只有它自己知道。

### `packages/neuro-book/scripts/dev-sample.ts`（包脚本 `dev:sample`）：放一份样例作品

- 样例内容放在 `packages/neuro-book/scripts/dev-sample/`，入库：几章短小的原创正文、一份人物笔记、一份大纲，总共几 KB。不用第三方素材。
- 脚本用 `readDevConfig` 算出状态根（与 `dev` 同一份配置、同样的环境变量），把样例复制到 `<包目录>/.dev-sample/sample/`，写身份文件，然后登记进 `projects.json`，短名是 `sample`。
  - `.dev-sample/` 加进根 `.gitignore`；
  - 不放进状态根里面，因为 `checkProjectDirectory` 拒绝登记状态根。
- **重复运行**：
  - 登记表里已有 `sample` 且目录还在，什么都不改；
  - 目录被删了就重建并更新登记；
  - 已有同名登记、但路径不是样例目录时，报错退出，不覆盖别人的作品。
- **与服务端同时写登记表**：服务端的写入只在进程内串行。脚本按服务端的写法写临时文件再改名，并且只在登记表里没有 `sample` 时才写。服务端只在用户新建、登记、移出作品时写表，与脚本撞上的窗口很小。这个风险在模块头写明。
- 输出一行 JSON：`{"name": "sample", "path": "…", "created": true|false}`，nbdev 按字段读。

### `packages/neuro-book/scripts/page-shot.ts`（包脚本 `page:shot`）：截产品页面

- 参数：
  - `--url <开发服务地址>`；
  - `--path <路径，含查询串>`，缺省 `/`；
  - `--click <选择器>`，可重复，按顺序点；
  - `--wait-for <选择器>`，可重复，截图前等它们都可见；
  - `--window <宽x高>`，缺省 `1440x900`；
  - `--full-page`；
  - `--scale`；
  - `--theme light|dark`，用浏览器的 `prefers-color-scheme` 模拟；
  - `--out <目录>`。
- 就绪的判据：`load` 事件，加上 `document.fonts.ready`，加上 `--wait-for` 里的选择器都可见。点击之后再等一次 `--wait-for`。不按固定时长等待：不给 `--wait-for` 时只等前两项。
- 输出：
  - 截图 `page.png`；
  - `report.json`：最终地址、窗口尺寸、页面错误，以及控制台的 error 与 warning。
- 浏览器的起法沿用 `lab-shot.ts`：Node 运行，`channel: "chrome"`，可以用 `--browser-executable` 指定浏览器。

### `packages/dev-panel/src/dev/dev-ops.ts` 与 `src/cli/dev-commands.ts`：`dev start --sample`

- 新参数 `--sample`。在起服务或复用服务之前，在包目录里运行 `bun run dev:sample`，环境与起服务时相同。
  - 包里没有 `dev:sample`：报 `sample_unavailable`（退出码 3）；
  - 脚本失败：报 `sample_failed`（退出码 1，带 stderr 的末尾），不起服务；
  - 成功：在 `READY` 那一行之后加一行 `SAMPLE <地址>/?project=<短名>`（`--json` 时为 `{"event": "sample", "name", "url"}`）。
- 复用已有服务时照样运行 `dev:sample`：登记表每次读取都重读，不用重启。
- 不用 `--sample` 时行为完全不变。

### `packages/dev-panel/src/dev/shot.ts` 与 `src/cli/dev-commands.ts`：`shot --page`

- 新参数 `--page <路径>`，例如 `--page '/?project=sample'`。给了就运行目标包的 `page:shot`，传 `--url <地址> --path <路径> --out <目录>`，`--` 之后的参数照旧原样转交，`--click`、`--wait-for` 走这里。
- 包里没有 `page:shot` 报 `shot_unavailable`，与没有 `lab:shot` 同一个码；`details.script` 写明缺的是哪个脚本。
- 地址、输出目录、`TMPDIR` 的规则与现有的 `shot` 完全相同。

## Spec 与文档改动

- `packages/dev-panel/docs/cli.md`：
  - 命令表加 `dev start --sample`、`shot --page`；
  - “开发服务、worktree、查找与截图”一节写两者的行为；
  - 错误码表加 `sample_unavailable`（3）、`sample_failed`（1）。
- `packages/neuro-book/README.md`（或包的 AGENTS 入口里讲开发服务的那一段）：写 `dev:sample`、`page:shot` 两个脚本。
- `docs/specs/runtime/projects.md`：不改。样例作品只是一个普通的已登记作品，不是产品行为。
- 待确认清单：
  - 样例作品放在 `<包目录>/.dev-sample/`；
  - 样例的内容；
  - `page:shot` 的缺省窗口 1440×900。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | neuro-book 的 `dev:sample` 与样例内容、`.gitignore` | 在集成分支 worktree 里跑两次 `bun run --cwd packages/neuro-book dev:sample`，看登记表与输出；`bun run dev` 起来后打开 `/?project=sample` 能进工作台 |
| S2 | neuro-book 的 `page:shot` | 对 S1 起的服务跑 `bun run --cwd packages/neuro-book page:shot -- --url … --path '/?project=sample' --wait-for '[data-editor-area]' --out /dev/shm/…`，看截图 |
| S3 | nbdev 的 `dev start --sample`、`shot --page`，合同与测试 | dev-panel typecheck；`tests/dev-live.test.ts`、`tests/find-shot.test.ts` 加场景 |

S1、S2 改 neuro-book 包，S3 改 dev-panel，文件不重叠。但 S3 的真实验收要用到 S1 与 S2，所以按顺序做。

## 验收映射

| 合同条目 | 覆盖 |
|---|---|
| `dev start --sample` 先放样例再起服务，打 `SAMPLE` 行 | `tests/dev-live.test.ts`：夹具包里放一个假的 `dev:sample`（写一个文件、打一行 JSON）与假的 `dev` 脚本，断言顺序与输出 |
| 没有 `dev:sample` 报 `sample_unavailable`；脚本失败报 `sample_failed`、不起服务 | 同上 |
| 复用时也运行 `dev:sample` | 同上 |
| `shot --page` 运行 `page:shot`，传路径与输出目录；没有脚本报 `shot_unavailable` | `tests/find-shot.test.ts`：夹具包里放一个假的 `page:shot`，记录收到的参数 |
| `dev:sample` 重复运行不改、同名不同路径时报错 | 一份单元测试（neuro-book 包内，用临时状态根） |
| 真实工作台截得出来 | 手动：集成分支上 `nbdev dev start --sample`，再 `nbdev shot --page '/?project=sample' -- --wait-for '[data-editor-area]'`，截图记进证据 |

## 验证

- 收口跑 dev-panel 全量、typecheck；neuro-book 包跑 typecheck 与新单元测试。
- 真实验收见上表最后一行，在集成分支的 worktree 上做，用完 `nbdev dev stop`。
- 未验证的边界：`page:shot` 在旧应用（`packages/neuro-book-legacy`）上没有对应脚本，`shot --page` 指向旧应用时报 `shot_unavailable`。这是预期行为，不另做。

## 不做与风险

- 不在 nbdev 里写 Playwright 逻辑：违反 t14 定下的分工，而且 nbdev 不知道各应用的就绪判据。
- 不做“截图前登录”“截多步流程”。需要时用 `--click` 拼；更复杂的流程还是写 e2e。
- 风险：样例脚本与服务端同时写 `projects.json`。见“关键设计”，接受。
