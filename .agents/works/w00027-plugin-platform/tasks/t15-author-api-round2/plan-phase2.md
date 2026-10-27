# t15 第二期计划：应用的 npm 包与 `nbook` 命令行

## 1. Context

开发者 2026-10-24 定：应用与 SDK 一起发 npm（同一个版本号）；命令行按受众分 `nbook`（用户与 Agent，随应用）与 `nbooke`（作者，在 SDK 包里）。2026-10-25 定：`nbook` 的状态根缺省按平台的数据目录；第一版是启动加插件管理；发行方向经 omp 审查修订（[evidences/p2-direction-review-omp.txt](evidences/p2-direction-review-omp.txt)）后确认：第二期只做 npm 包；一个状态根只跑一个服务端实例；状态根的版本与降级门禁到桌面端再定；目录包、桌面壳、服务器部署后置（见 Task README 的“当前状态”）。2026-10-27 定：计划按本稿推进；作品管理命令（旧应用的 `workspace project`/`node`）以后并进 `nbook` 的子命令，不另做命令，本期不做；GitHub Actions 的整理放进第三期；计划做深度审查（多个 Sonnet 加少量 Opus，另加 omp）。

第一稿的深度审查（第 9 节）之后，开发者 2026-10-27 定了四件事：

- D1 实例认领从“锁目录 + 地址文件 + 健康检查”改成监听状态根的本地套接字（同 VS Code 的 `claimInstance`）：锁目录靠 10 秒心跳判活，进程暂停超过 10 秒就被接管，同一状态根跑起两个实例（三位审查者实测）；套接字由内核持有，暂停时不会被接管，崩溃后立即释放（实测 7 毫秒重新认领）。
- D2 `nbook start` 前台运行。后台运行（注册成操作系统的服务，由 `nbook service …` 管，停止与查看也放在 `service` 下）本期不做，记为后续：实现前先调研有没有现成的第三方库，没有就自己做一个包。审查实测前台运行时关终端（SIGHUP）不走停止序列（退出码 129），所以前台要补上 `SIGHUP`。
- D3 单实例成为硬不变量后，本期删掉为“同一状态根多个服务端”做的插件版本租约。
- D4 `nbook plugin install` 执行命令本身算确认，不做交互确认；降级或有插件会受阻时要 `--yes`。

期望结果：`bun add -g @notnotype/neuro-book` 之后，`nbook` 在前台启动本地服务并打开浏览器，再运行一次就打开已在运行的实例；`nbook plugin install <插件的 dist>` 之后重启服务，装上作者构建的插件。作者从构建到用户安装这条路在命令行上闭合。本期产出能装的 tarball，真正发布、版本号与文档治理在第三期。

依据：[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（决定 6 不含新应用）、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)、[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md)、[`runtime.projects`](../../../../../docs/specs/runtime/projects.md)。

工作方式：主会话实现；每片自跑验证、单独提交；收口跑全量 e2e，后端实现审查派 omp，插件页与 Lab 的改动派 Sonnet。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 命令行解析（嵌套子命令、帮助、未知选项报错） | `commander`（仓库已用：nb-story、llmlint，`^14`），用 `exitOverride` 与 `configureOutput` 映射退出码与中文文案 | 子命令、帮助与错误都现成；它的用法错误缺省退出 1、内置文案是英文、`isDefault` 子命令会把拼错的命令报成“too many arguments for 'start'”（审查实测），这三处由我们包一层；否决 `node:util` 的 `parseArgs`（没有子命令与帮助） |
| 实例认领 | `node:net` 监听状态根的 Unix 域套接字（Windows 用命名管道），认领那一步用现有 `holdLock` 包住 | 内核持有，进程活着（含被暂停）就占着、死了立即释放，没有过期时间；顺带给出“第二次启动问已有实例要地址、请它停止”的通道。否决锁目录加地址文件（暂停接管、崩溃后 10 秒窗口、端口复用误判）；否决 `flock` 的 FFI（Bun 没有内置，三平台各写一份） |
| 打开浏览器 | `open`（sindresorhus，新增依赖，打进 bundle） | 三平台与 WSL 都处理了；打包后退回系统的 `xdg-open`，找不到时 reject（审查实测）。否决手写分支 |
| 平台数据目录 | 手写一个函数（约 15 行），同 `src/server/user-directories.ts` 的做法 | 否决 `env-paths`：目录名加 `-nodejs` 后缀、Windows 多一层 `Data`、macOS 用小写名，与已定路径不同 |
| 第三方许可声明 | 服务端：`bun build --metafile` 取实际打进 bundle 的包，读各包的许可文本；页面：Vite 8 的 `build.license` | 只列实际打进去的包，不列全部依赖；否决 `license-checker` 一类按依赖树列的工具（多列、少列都有） |
| npm 包打包 | 照 SDK 的 `plugin-sdk/pack.ts`：生成暂存目录与清单，`bun pm pack`；导入扫描复用 `scripts/release/packages.ts` 的 `scanScript`（已处理抬头行） | 服务端产物已自含依赖（上一轮实测）；否决直接发应用源码包 |

## 3. 关键设计

### 3.1 实例认领：`src/server/instance.ts`（新）、`src/server/start.ts`、`src/server/host.ts`

- `claimStateRoot({stateRoot, kind, version}, report)`，`kind` 为 `product`、`development`、`fixture`：
  1. 建状态根目录（认领的物理前提，不算写状态）。失败为 `unwritable`。
  2. 在 `<状态根>/server.claim.lock` 上 `holdLock`（只持有到监听成功，毫秒级），挡住两个启动者同时看到残留套接字、一方删掉另一方刚建的套接字。
  3. 连套接字：有应答为 `{ok: false, reason: "running", instance}`；连上但 3 秒内没应答为 `unresponsive`（实例被暂停或卡死，不接管）；`ECONNREFUSED`/`ENOENT` 说明是残留文件，删掉后监听，成功为 `{ok: true, claim}`。
- 套接字路径：`<状态根>/server.sock`；字节长度超过 100（Unix 套接字路径上限 104 到 108）时改用 `${XDG_RUNTIME_DIR ?? os.tmpdir()}/nbook-<状态根真实路径的 sha256 前 16 位>.sock`。Windows：`\\.\pipe\nbook-<同一哈希>`（Bun 在 Windows 上监听命名管道有失败的报告，未核实，见第 8 节）。
- 协议：一行一个 JSON。`{type: "hello"}` 应答 `{schema: 1, pid, version, kind, status: "starting" | "ready" | "stopping", url?, rpcUrl?, startup?}`，`startup` 是运行中实例的启动集合（插件 id、版本、状态，给 `nbook plugin list`）。本期只有 `hello`；以后的 `nbook service stop` 等在这个协议上加请求，`schema` 留了演进余地。认领一成功就应答 `starting`，所以“已认领、还没监听”的窗口里第二次启动也拿得到实例。连接上的写入错误（对方已断开时的 EPIPE）就地吞掉并记诊断：实测暂停后恢复的实例往已关闭的连接写会抛出、拖垮进程。
- `startServer` 的选项加必填的 `claim`：监听后 `claim.publish({url, rpcUrl, startup})`；`stopped` 结算后、以及装配失败抛出前 `claim.release()`（关监听、删自己的套接字文件）。不变量由类型保证：任何宿主（产品、开发、`fixture-entry.ts`、以后的桌面壳）不先认领就起不了服务端。进程内的测试用真实的认领（临时状态根，毫秒级），不另做测试句柄。
- 入口：`main.ts`、`development-main.ts`、`fixture-entry.ts` 先认领再 `prepareInstalledPlugins`；取不到时写致命诊断 `runtime.state-root.busy`（带实例的 pid 与地址，或“没有应答”）并以 1 退出。`process.ts` 的 `runServerProcess` 改收已认领的句柄，`process.exit` 只留在它的最外层；装配失败时在同一个 `try/finally` 里放下插件准备结果与认领。
- `kind: "development"` 的实例不应答 `url`（开发会话的后端没有页面，页面在 Vite 那边），`nbook` 遇到它报“该状态根正由开发服务使用”。
- 停止信号：`host.ts` 的 `DEFAULT_SIGNALS` 加 `SIGHUP`，走与 `SIGTERM` 相同的有序停止（审查实测关终端时退出码 129、没有停止记录）。
- 版本一致：服务端启动时记下 `project.js` 的大小与修改时间，拉起项目子进程前核对，变了就拒绝（`project-unavailable`，说明“应用文件已更换，重启服务后再打开”）。全局包原地升级会在运行中的服务端脚下换掉 `project.js`（审查实测作品打不开）。页面资源的同类问题记为后续。
- 删除插件版本租约（D3）：`pins.ts`、`startup.ts` 写租约与按租约推迟回收、`version-in-use` 失败码与插件页对它的处理、相关注释（`record.ts`、`inventory.ts`、`startup.ts` 里的“另一个服务端”）。登记表的跨进程写入锁保留：命令行离线写登记表时服务端可能在跑。

### 3.2 `nbook` 命令行：`src/cli/`（新）

- `main.ts`：commander 程序 `nbook`。程序级选项 `--state-root`、`--json`（任何子命令前后都可写）；不给子命令等于 `start`；拼错的子命令报“不认识的命令 x，可用：…”；帮助与错误文案中文。入口先核对 `Bun.version` 满足 `engines.bun`，不满足打印可读的错误、以 2 退出。`--version` 打印产品版本、Bun 版本与缺省状态根。
- 退出码：0 成功，1 失败，2 用法错误（commander 的错误经 `exitOverride` 映射）；`start` 运行服务端时透传服务端的退出码（0、1、75、76）。
- 输出：结果写标准输出，提示与诊断写标准错误；`--json` 时标准输出只有一个 JSON 对象，成功 `{ok: true, ...}`，失败 `{ok: false, code, message, problems?}`，失败码沿用 plugin-install 的失败表，命令行另加的码写进 `runtime/cli.md`。服务端的 JSON 致命诊断由 `nbook` 映射成一行中文、留在日志里。
- `state-root.ts`：`defaultStateRoot(platform, env, home)`：Linux `${XDG_DATA_HOME:-~/.local/share}/neuro-book`（`XDG_DATA_HOME` 不是绝对路径时忽略，同 XDG 规范）；macOS `~/Library/Application Support/NeuroBook`；Windows `%LOCALAPPDATA%\NeuroBook`（没有时 `~\AppData\Local\NeuroBook`）。取值顺序：`--state-root` > `NBOOK_STATE_ROOT`（空串算没给） > 缺省；相对路径按当前目录解析。只读的命令（`plugin list`）不建状态根。
- `start [--port] [--rpc-port] [--no-open] [--safe-mode]`（前台运行，终端拥有服务的寿命）：
  1. 问实例（`hello`）：`ready` 就打印地址，不带 `--no-open` 就打开，以 0 退出；`starting` 就等到 `ready`（上限 60 秒，按状态轮询）；版本与自己的 `PRODUCT_VERSION` 不同时报“运行中的是 X，已安装 Y，重启服务后换成新版本”、以 1 退出；开发实例与没有应答的实例以 1 退出并说明。已有实例时给了 `--port` 等参数就打印一行“已有实例，忽略 --port”。
  2. 没有实例：本进程认领并运行服务端（同 `main.ts`，配置由参数与状态根组出）。监听后打印地址，不带 `--no-open` 就打开浏览器。`--json` 时就绪后在标准输出写一行 `{ok, url, rpcUrl, pid, version, started}`，`started` 区分“这次启动的”与“已在运行的”：Agent 把命令放到后台、读这一行拿地址。Ctrl-C（SIGINT）、关终端（SIGHUP）、SIGTERM 都走有序停止。
  3. 只给 `--port` 时 RPC 端口取 `port + 1`。
  4. 打开浏览器失败（无桌面、SSH）只打印一行提示；`SSH_CONNECTION` 存在或 Linux 上没有 `DISPLAY`/`WAYLAND_DISPLAY` 时不尝试打开，提示端口转发。
  5. `--safe-mode` 等于 `NEURO_BOOK_SAFE_MODE=1`：插件拖垮启动时的入口（plugin-install 的前置条件写的是 Manager 与桌面版提供，现在由命令行提供）。
- `plugin`（离线写登记表，不经服务端，同 VS Code 的 `code --install-extension`）：
  - 用 `createPluginInventory`，`builtin` 给产品清单的内置插件，`startup` 取运行中实例 `hello` 应答里的启动集合，没有实例时为空集合。这样 `list` 与插件页走同一个 `itemOf`：内置与第三方都列，待生效的变化、离线就能算出的不登记原因（清单无效、入口缺失、引擎不兼容）都有；运行问题（激活失败）只有服务端知道，`list` 末尾给出日志目录。
  - `install <目录> [--yes]`：先 `inspect`，打印完全信任的声明、关系（新装、升级、降级）、重启后会受阻与没核对的插件；降级或有受阻插件时要 `--yes`，否则以 2 退出、码 `confirmation-required`（D4：命令行调用本身算确认，不另做交互确认）。参数不是目录时补一句“先用 `nbooke build` 构建，传 dist 目录”；`manifest-invalid` 逐条打印出错字段；`already-installed` 提示 `nbooke build --dev`。
  - `enable`、`disable`、`uninstall <id>`：结果写目标状态与“重启服务后生效”；`uninstall` 保留数据（本版不提供 `--delete-data`）。
  - 诊断（`record`）写状态根的日志目录，与服务端的诊断同一格式。
- 构建：`build:server` 增加 `bun build src/cli/main.ts --target bun --outfile dist/server/nbook.js`（第一行 `#!/usr/bin/env bun`，构建后核对保留）。Web 根取 bundle 旁的 `../web`，可由参数覆盖（测试注入）。
- 作者侧文字改指命令行：`plugin-sdk/cli.ts` 的 `create` 收尾提示、`plugin-sdk/README.md`、`plugin-sdk/examples/README.md`、`plugin-sdk/template/README.md` 里“设置 → 插件 → 安装…”的地方，两条路都写，命令行在前，并写明先 `bun add -g @notnotype/neuro-book`。

### 3.3 npm 包：`scripts/pack-app.ts`（新）

- 前置：`bun run build`（服务端构建加 `--metafile`）。暂存目录 `dist/app-package/`，只清自己上次生成的（同 `pack.ts` 的 `clearPreviousSdk`，靠目录里的标记文件）。
- 内容：`server/nbook.js`、`server/project.js`、`web/**`、`LICENSE`、给用户的 `README.md`、`THIRD-PARTY-NOTICES.md`（服务端 metafile 里的包与许可文本，加 Vite 生成的页面许可清单）、字体许可（`OFL-Fraunces.txt`、codicon 的许可）、生成的 `package.json`。`main.js` 不进包。
- `package.json`：`name` `@notnotype/neuro-book`、`version` `PRODUCT_VERSION`、`description`、`type: module`、`bin: {nbook: "./server/nbook.js"}`、`files`、`engines.bun`、`license: AGPL-3.0-only`、`repository`（含 `directory`）、`publishConfig.access: public`，没有 `dependencies`。字段按 `scripts/release/packages.ts` 的发布门禁写，第三期接进发布时不必改产物结构。
- 打包前核对：两个 bundle 用 `scanScript` 扫导入，只许内置、`node:`、`bun:` 与已知的两处插件入口 `import(file)`；`new Worker`、`import.meta.resolve` 出现即失败。三项版本断言：清单的 `version`、`bun <暂存>/server/nbook.js --version`、同目录 SDK tarball 的版本都等于 `PRODUCT_VERSION`。然后 `bun pm pack`。
- README：需要 Bun ≥ 最低版本、不能用 Node 运行；安装只写 `bun add -g @notnotype/neuro-book`，不写 `bunx nbook`（npm 上的 `nbook` 是别人的包）；升级前先停掉运行中的服务；AGPL 的源码位置与构建所用提交。
- 源码包仍是 `private: true`：只有暂存目录能发。接进 `release:publish` 在第三期。脚本 `build:app-package`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| 新 ADR 0033（动手前再核对编号） | 新应用的交付：发构建产物（补充 ADR 0029 决定 6）；应用包自带 `nbook`；状态根缺省平台数据目录；一个状态根一个实例、用套接字认领；`nbook start` 前台运行，后台运行（系统服务）另做；发行的两个维度；目录包、桌面壳、服务器部署另写提案；不恢复旧 Manager 及其各项能力的去向；`docs/adr/README.md` 加一行 |
| 新 Spec `runtime/cli.md`（`runtime.cli`） | 子命令、选项、标准输出与标准错误、`--json` 形状、退出码（按子命令）、失败码；状态根的取值与缺省；`start` 在无实例、启动中、运行中、版本不同、开发实例、没有应答时的行为；插件子命令的离线语义与确认；验收场景；`docs/specs/README.md` 注册表加一行 |
| `runtime/server-host.md` | 实例认领：套接字、协议、`runtime.state-root.busy`、`SIGHUP`、`project.js` 被更换时拒绝拉起；Smoke 段加单实例场景；“已安装插件……尚未实现”两处改成现状 |
| `runtime/plugin-install.md` | 删租约与 `version-in-use`；“多个服务端进程”改成“服务端与命令行”，删掉不实的 `runtime.projects` 引用；输出 1 到 3 加命令行入口，输出 2.2 写明命令行调用即确认；验收 15 改写；安全模式由 `nbook start --safe-mode` 提供 |
| `runtime/projects.md` | 第 21、175 行补“同一状态根只有一个服务端”的前提；第 111 行与验收 17 的“两个服务端进程打开同一作品”改成不同状态根的情形或删 |
| `runtime/stall-watchdog.md` | “Manager 删除遗留租约锁”等句与新的认领机制对齐 |
| `ui/component-lab.md` | 验收 22 不改措辞（“先后”与单实例相容），e2e 改成先停第一个再起第二个 |
| `docs/modules/monorepo-boundaries.md` | 新应用的交付链：npm 包已有，其余另行设计 |
| 代码注释 | `stats-writer.ts`、`dev/sample.ts`、插件平台后端里“另一个服务端”的说法 |
| 插件 SDK 示例 | `focus` 示例的注释、`07-focus.test.ts` 的“同一状态根上的两个服务端”改成多窗口的情形；`examples/README.md` 同步 |
| 作者侧文字 | 见 3.2 末条 |
| 应用包给用户的 README（暂存进包里） | 见 3.3 |

## 5. 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 实例认领与 `startServer` 的 `claim`；三个入口；`SIGHUP`；`project.js` 核对；Lab 场景 22 改成先后；server-host、projects、stall-watchdog 的 Spec | 3.1 | 类型检查；`instance.test.ts`：两个真实进程认领同一状态根，第二个拿到第一个的 pid；`SIGSTOP` 后第二个报没有应答、不接管；`SIGKILL` 后立即重新认领；两个进程同时认领恰好一个成功；长路径改用运行时目录；`src/server` 测试：`main.js` 与 `fixture-entry` 各一次 busy，RPC 端口被占与插件装配失败后认领已放下，`SIGHUP` 有序停止；`lab.e2e.ts` 场景 22 |
| S2 | 删插件版本租约（D3）；插件场景 15 与 `07-focus` 改写；plugin-install Spec | 3.1 末条 | `plugins.test.ts`、`plugin-sdk/` 测试；插件页的 DOM 测试与插件 e2e |
| S3 | `nbook start`、状态根缺省、打开浏览器；`runtime/cli.md` 的启动部分 | 3.2 | `src/cli` 的进程测试：测试里把 `src/cli/main.ts` 与 `src/project/main.ts` 构建到临时目录（实测服务端构建 0.08 秒），Web 根注入一个只有 `index.html` 的目录；`HOME`、`XDG_DATA_HOME`、`LOCALAPPDATA` 指到临时目录；`PATH` 里放记录参数的假 `xdg-open`，观察“打开”；启动后服务可用、`--json` 的就绪行；再 `start` 得到同一 pid、`started: false`；启动中再 `start` 等到同一实例；SIGINT、SIGHUP 有序停止、套接字消失；版本不同（构建时 `--define` 另一个版本号）报错；`defaultStateRoot` 三平台取值 |
| S4 | 插件子命令；作者侧文字；`runtime/cli.md` 的插件部分 | 3.2 | 进程测试：装示例插件的 `dist`、`list --json`（服务端运行时标准输出仍是合法 JSON，带待生效变化）、启停、卸载；降级与有受阻插件时不带 `--yes` 以 2 退出；`plugin-sdk/` 的 `create` 场景测试 |
| S5 | npm 包暂存、许可声明与 tarball；ADR 0033、monorepo-boundaries；tarball 冒烟脚本 | 3.3 | `pack-app.test.ts`（用临时产物）：白名单、版本断言、导入扫描、残留保护；`smoke:app-package`（自己构建、真实产物）：临时 `BUN_INSTALL` 里 `bun add -g <tgz>`，`nbook start --no-open`，经 RPC 登记并打开一个作品（同 smoke S7，项目子进程起来），Playwright 打开地址到 `data-rpc-state=online`，`plugin install` 示例插件，停止再启动后服务端报告插件已激活，SIGINT 停止 |

收口：全量 e2e；实现审查（后端 omp，插件页与 Lab 的改动 Sonnet）。

## 6. 验收映射

写 Spec 时给条目编号，这里先按场景列：

- 实例认领（server-host 新条目）：第二个进程报 busy 带地址、暂停不接管、崩溃后立即重新认领、同时认领只有一个、所有入口都认领、装配失败放下认领、`SIGHUP` 有序停止 → S1 的进程测试；打包产物的单实例场景 → `smoke:server`。
- `project.js` 被更换时拒绝拉起 → S1 的 `src/server` 测试（运行中替换文件）。
- `nbook start`（cli）：启动、已有实例、启动中、版本不同、开发实例、`--no-open`、打开浏览器、状态根取值 → S3 的进程测试与 `state-root` 单测。
- 插件子命令（cli、plugin-install 输出 1 到 3、8 的命令行入口）→ S4 的进程测试。
- 服务端运行时命令行写登记表（plugin-install 验收 15 改写）→ `plugins.test.ts`。
- Lab 验收 22 → `lab.e2e.ts`。
- npm 包可安装、可启动、项目子进程可起、页面可连、插件重启后激活 → `smoke:app-package`；包内容与版本 → `pack-app.test.ts`。

## 7. 验证

- 每片的自跑验证见第 5 节；收口跑类型检查、`bun run test:affected`、`smoke:server`、`smoke:app-package` 与全量 e2e。
- 端到端：从 tarball 装进临时目录，`nbook` 启动后浏览器打开打印的地址能进工作台；`nbook plugin install` 一个用 `nbooke build` 构建的示例插件，重启服务后插件页列出它。
- 未验证边界：Windows 与 macOS 实机（状态根缺省只按代码与单测；命名管道、`open` 未在这两个平台跑，测试记录实际跑的平台）；真实 `bun publish` 与从 registry 安装（第三期）；Bun 最低版本 1.3.14 由审查者手工跑过一次 S7，`smoke:app-package` 只在本机的 Bun 上跑。

## 8. 不做与风险

- 不做：后台运行与 `nbook service`（注册成系统服务；先调研现成的库，没有就自己做一个包）；目录包、单文件、桌面壳、Docker 与服务器部署（各自另写提案）；状态根的版本与降级门禁（开发者定到桌面端再做）；`nbook project`、`nbook config`（作品管理等新应用的内容模型重建后并进 `nbook`）；页面资源在运行中被升级替换的保护（后续）；GitHub Actions 的整理（第三期）；接进 `release:publish` 与真正发布、两个包的发布顺序与半途失败（第三期）。
- 风险：Windows 上 Bun 监听命名管道有失败的报告（Bun 1.3.14，未核实是否已修）。新应用在 Windows 上整体未验证（server-host 的已知限制），本期不为它另做一套认领；Windows 支持立项时先验证这一条。
- 风险：有人手工删掉 `server.sock`，下一次启动会认领成功，与仍在运行的实例并存。不防，在 Spec 的已知限制里写明。
- 风险：`open` 在没有桌面环境时可能静默成功却什么也没打开：总是打印地址。

## 9. 深度审查的处理

审查者：omp（后端与代码事实，实测）、Opus（架构与上游选择）、Sonnet ×3（命令合同与体验、npm 包与安装、测试与 Spec）。报告存为 [evidences/p2-plan-review-*.txt](evidences/)。条数：omp 阻断 1、重要 5；Opus 重要 5、建议 2；Sonnet 命令合同重要 10、建议 5；Sonnet 打包重要 4、建议 5；Sonnet 测试重要 9、建议 3。下表按主题合并，几位都提的写在一行。

| 主题（提出者） | 处理 |
|---|---|
| 锁目录被暂停接管、同一状态根两个实例；失锁只记诊断（omp 阻断，Opus、Sonnet 命令、Sonnet 测试） | 成立。改用套接字认领（3.1，D1）；本会话实测暂停时新启动只等不接管 |
| 取锁在 `runServerProcess` 里、取不到就退出，“等锁过期再试”无法实现；已认领未就绪的窗口第二次启动报 busy；health 探测无超时（Opus、Sonnet 命令、Sonnet 测试、omp） | 成立。认领提到入口最外层，句柄传进 `startServer`；认领成功即应答 `starting`；探测 3 秒超时 |
| `fixture-entry.ts` 不经 `runServerProcess`，测试与 e2e 的服务端不受约束（omp、Sonnet 测试）；桌面壳会绕过（Opus） | 成立。`claim` 是 `startServer` 的必填选项 |
| 状态根不存在时取锁失败；只读、被占、不存在混成一种（omp、Sonnet 命令） | 成立。认领先建目录；结果分 `running`、`unresponsive`、`unwritable`、失败 |
| 装配失败时租约与锁不收口，`process.exit` 在共享函数里（omp） | 成立。同一个 `try/finally` 放下；`process.exit` 只在最外层 |
| 开发会话的后端没有页面地址，`nbook` 会打开 API 端口（omp） | 成立。开发实例不应答 `url`，`nbook` 报“正由开发服务使用” |
| SIGKILL 后 10 秒内开发服务重起进入 503 死状态（Sonnet 测试）；崩溃窗口测不了（Sonnet 测试） | 套接字认领后不存在 |
| 关终端 SIGHUP 不走停止序列；前台阻塞 Agent；与 `code` 相反（Opus、Sonnet 命令） | 成立。加 `SIGHUP`；`--json` 就绪行给放到后台的 Agent；后台运行（系统服务）记为后续（D2） |
| 失锁后租约是唯一兜底还是多余，需定（Opus） | 硬不变量，删租约（D3） |
| 全局包升级换掉运行中服务端的 `project.js`；`nbook start` 静默打开旧版本（Opus、Sonnet 打包实测） | 成立。版本不同时报错并提示重启服务；拉起项目子进程前核对 `project.js`；页面资源记后续 |
| 退出码 0/1/2 与服务端的 75/76 冲突，commander 缺省 1（Sonnet 命令、Sonnet 测试） | 成立。按子命令定；`exitOverride` 映射 |
| 只有 `list` 有 `--json`；失败码只在文本里；提示行污染 JSON（Sonnet 命令、Sonnet 测试） | 成立。程序级 `--json`，失败带码；提示走标准错误 |
| `install` 丢了信任声明与受阻预览；`--yes` 含义含糊（Sonnet 命令、Opus） | 成立。都打印；降级或有受阻时要 `--yes`（D4） |
| `list` 只读原始登记表，与插件页不一致（Sonnet 命令、Opus） | 成立。用实例应答的启动集合走同一个 `itemOf` |
| commander 体验：拼错命令、选项在子命令前、英文文案（Sonnet 命令） | 成立。见 3.2 `main.ts` |
| 只给 `--port` 时 RPC 端口冲突；已有实例时静默忽略参数；SSH 下的打开（Sonnet 命令） | 成立。`port + 1`；打印“忽略”；SSH 时不尝试打开 |
| 只读命令会建出拼错的状态根；`--version` 内容；Bun 版本自检（Sonnet 命令、Sonnet 打包） | 成立。见 3.2 |
| 安全模式现在没有入口（Sonnet 命令） | 成立。`--safe-mode` |
| 作者侧四处文字仍指插件页（Sonnet 命令） | 成立。S4 改 |
| `cli.md` 缺的九类条目（Sonnet 命令） | 成立。写 Spec 时逐条覆盖 |
| `scanImports` 遇抬头行抛错、盲区大（Sonnet 打包） | 成立。复用 `scanScript`；运行证据由 `smoke:app-package` 给；`Worker`/`import.meta.resolve` 断言为 0 |
| 包里没有第三方许可声明、字体许可、AGPL 源码位置（Sonnet 打包） | 成立。metafile 与 Vite `build.license` 生成；README 写源码位置 |
| tarball 验收没测项目子进程、页面、重启后插件激活（Sonnet 打包、Sonnet 测试） | 成立。`smoke:app-package` |
| 进程测试依赖 `dist/`（Sonnet 测试） | 成立。测试自己构建到临时目录，Web 根可注入 |
| 打开浏览器、Ctrl-C、真实家目录隔离没有测试（Sonnet 测试） | 成立。假 `xdg-open`、临时 `HOME` |
| 打包脚本与发布门禁分叉、残留文件、版本断言（Sonnet 打包） | 成立。按门禁字段写清单；只清自己的暂存目录；三项版本断言 |
| ADR 编号 0032 已占用；注册表行没列（Sonnet 测试） | 成立。改 0033，加两行登记 |
| 单实例后变假的 Spec 与注释：projects、stall-watchdog、`focus` 示例、`sample.ts` 等（Sonnet 测试） | 成立。加进第 4 节 |
| Lab 场景 22 改成别名丢了“进程重启后偏好仍在”（Sonnet 测试） | 成立。改成先停再起，Spec 措辞不变 |
| `engines.bun` 没有约束力、npm 用户只见 `env: bun` 报错（Sonnet 打包） | 接受取舍：README 写明，入口自检版本；不做 Node 写的转发入口（多一层进程与信号转发） |
| `bunx nbook` 会装到别人的包（Sonnet 打包） | 成立。文档只写全名；不加别名 bin |
| 两个包同号半途发布失败、发布顺序（Sonnet 打包） | 第三期处理，记入第三期计划 |
| 主线程阻塞 5 到 10 秒锁被判残留（Sonnet 测试） | 套接字认领后不存在 |
| Windows、macOS 的预期没写（Sonnet 打包） | 第 7、8 节写明 |

## 10. 实现审查的处理

前端与命令行使用（Sonnet，[evidences/p2-impl-review-sonnet.txt](evidences/p2-impl-review-sonnet.txt)）：重要 3、建议 10，修正 `ede24f850`，Spec `71f14b613`。

| 发现 | 处理 |
|---|---|
| `help` 子命令以 2 退出、`--json help` 多一个失败对象 | 成立。`commander.help` 按 `exitCode` 区分；测 `help start`、`plugin help install` 以 0 退出 |
| `--state-root ""` 静默回落到真实的缺省状态根 | 成立。显式的空串报 `usage`；单测与进程测试 |
| 服务端启动失败时不走命令行的输出约定 | 成立。`runServerProcess` 加 `onStartupFailed`（启动中被停止不算），`nbook start` 写 `startup-failed` 与 `causes`；Spec 失败表加这一码；测 Web 根不存在 |
| commander 的英文残留、子命令帮助没有全局选项 | 成立。按错误码组中文说明，用法行与命令列表自己拼，`showGlobalOptions` |
| 清单无效时第一条问题重复 | 成立。有逐条问题时只列问题；测每条只出现一次 |
| 路径不存在也提示 `nbooke build` | 成立。提示改成确认路径并传 `dist` 目录 |
| 已有实例时 `--safe-mode` 被静默忽略 | 成立。实例不是安全模式时提示；Spec 输出 6 |
| 示例 README 的安装没带 `--state-root`、开发服务装不进去；SDK README 没说命令行降级要 `--yes` | 成立。示例写 `--state-root .dev-state`，SDK 与模板 README 写明状态根要一致与 `--yes`；`install` 的结果写出状态根 |
| 文档要求 `bun add -g @notnotype/neuro-book`，包第三期才发布 | 接受：应用包与 SDK 包同一次发布（第三期），发布前核对这四处 |
| cli.md 没写插件命令的结果字段 | 成立。输出 12、13 写上 `preview`、`plugin`、`stateRoot`、`restartRequired`、`problems`；测试断言 |
| focus 示例两处“几个服务端”残留 | 成立。改成“几个请求” |
