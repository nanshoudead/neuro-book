# t15 第二期计划：应用的 npm 包与 `nbook` 命令行

## 1. Context

开发者 2026-10-24 定：应用与 SDK 一起发 npm（同一个版本号）；命令行按受众分 `nbook`（用户与 Agent，随应用）与 `nbooke`（作者，在 SDK 包里）。2026-10-25 定：`nbook` 的状态根缺省按平台的数据目录；第一版是启动加插件管理；发行方向经 omp 审查修订（[evidences/p2-direction-review-omp.txt](evidences/p2-direction-review-omp.txt)）后确认：第二期只做 npm 包；一个状态根只跑一个服务端实例；状态根的版本与降级门禁到桌面端再定；目录包、桌面壳、服务器部署后置（见 Task README 的“当前状态”）。2026-10-27 定：计划按本稿推进；作品管理命令（旧应用的 `workspace project`/`node`）以后并进 `nbook` 的子命令，不另做命令，本期不做；GitHub Actions 的整理放进第三期；计划做深度审查（多个 Sonnet 加少量 Opus，另加 omp）。

期望结果：`bun add -g @notnotype/neuro-book` 之后，`nbook` 启动本地服务并打开浏览器；`nbook plugin install <插件的 dist>` 装上作者构建的插件，重启后生效。作者从构建到用户安装这条路在命令行上闭合。本期产出能装的 tarball，真正发布、版本号与文档治理在第三期。

依据：[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)（决定 6 不含新应用）、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)、[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md)、[`runtime.projects`](../../../../../docs/specs/runtime/projects.md)。

工作方式：主会话实现；每片自跑验证、单独提交；收口跑全量 e2e，后端实现审查派 omp。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 命令行解析（嵌套子命令 `plugin list` 等、帮助、未知选项报错） | `commander`（仓库已用：nb-story、llmlint，`^14`） | 子命令、帮助与错误都现成；否决 `node:util` 的 `parseArgs`（没有子命令与帮助，nbooke 只有两个平铺子命令才用它） |
| 打开浏览器 | `open`（sindresorhus，新增依赖，打进 bundle） | 三平台的打开命令与 WSL 都处理了；打包后它退回系统的 `xdg-open`。否决手写 `xdg-open`/`open`/`start` 的分支 |
| 平台数据目录 | 手写一个函数（约 15 行），同 `src/server/user-directories.ts` 的做法 | 否决 `env-paths`：它给目录名加 `-nodejs` 后缀、Windows 多一层 `Data`、macOS 用小写名，与已定的路径不同，关掉后缀后剩下的只有三行分支 |
| 状态根的实例锁 | 现有 `holdLock`（`src/backend/locked-replace.ts`，proper-lockfile 的锁目录，进程活着时刷新） | 插件登记表与租约已用同一套；否决新写 `flock` 的 FFI（Bun 没有内置，三平台各写一份） |
| npm 包打包 | 照 SDK 的 `plugin-sdk/pack.ts`：生成暂存目录与清单，`bun pm pack` | 审查实测服务端产物已自含依赖；否决直接发应用源码包（11 个依赖、3 个 `workspace:`，与 bundle 无关） |

## 3. 关键设计

### 3.1 一个状态根只跑一个服务端实例：`src/server/instance.ts`（新）、`src/server/process.ts`

- `claimStateRoot(stateRoot, report)`：取 `<状态根>/server.lock`（`holdLock`，`stale` 取 proper-lockfile 缺省的 10 秒：活着的进程每 5 秒刷新，崩溃后 10 秒内再启动会看到锁还在）。取不到为 `{ok: false, running: InstanceInfo | null}`，`running` 读自下面的地址文件。
- 地址文件 `<状态根>/server.json`：`{schema: 1, pid, url, rpcUrl, version, startedAt}`，HTTP 与 RPC 都监听之后写（临时文件改名），停止时删除（只删自己写的：比对 `pid`）。读者不只信文件：`findRunning(stateRoot)` 要求锁被持有，且 `GET <url>api/runtime/health` 返回 200，两者都成立才算有实例在跑。
- `runServerProcess` 在 `prepareInstalledPlugins` 之前取锁；取不到时写致命诊断 `runtime.state-root.busy`（带地址文件里的地址）并以 1 退出，不监听、不动插件目录。锁随 `server.stopped` 之后与插件租约一起放下。`runServerProcess` 另收可选的 `config`（缺省仍从命令行与环境变量读），供 `nbook start` 在进程内调用。
- 不变量：取锁先于任何写状态根的动作（插件的待生效变化、登记表、日志之外的数据）；开发入口（`development-main.ts`）同样受锁约束。
- 受影响的既有行为：
  - Lab 场景 22（“同一状态根换端口再起一个开发服务”）改成同一个开发服务经另一个回环别名（`localhost` 与 `127.0.0.1`）打开：要测的是“另一个浏览器来源、另一个客户端身份读到同一份 shared 偏好”，不需要第二个进程。
  - `plugins.test.ts` 的“同一状态根上的两个服务端进程（场景 15）”改成服务端与离线命令行同时写登记表。
  - 插件版本的租约（`pins.ts`）在单实例下多余，本期不删（见第 8 节）。

### 3.2 `nbook` 命令行：`src/cli/`（新）

- `main.ts`：commander 程序 `nbook`，`--version` 打印产品版本；不给子命令等于 `start`。退出码：0 成功，1 失败，2 用法错误。
- `state-root.ts`：`defaultStateRoot(platform, env, home)`：Linux `${XDG_DATA_HOME:-~/.local/share}/neuro-book`；macOS `~/Library/Application Support/NeuroBook`；Windows `%LOCALAPPDATA%\NeuroBook`（没有时 `~\AppData\Local\NeuroBook`）。取值顺序：`--state-root` > `NBOOK_STATE_ROOT` > 缺省；不存在时建出来。
- `start.ts`：`nbook start [--state-root] [--port] [--rpc-port] [--no-open]`
  1. `findRunning`：已有实例时打印“NeuroBook 已在 <url> 运行”，不带 `--no-open` 就打开它的页面，以 0 退出。
  2. 否则用 `readServerConfig` 同一套校验组出配置（端口参数映射成 `NBOOK_PORT`、`NBOOK_RPC_PORT` 的规则，`webRoot` 是 bundle 旁边的 `../web`），在进程内 `runServerProcess(productPlugins, {config})`；`onListening` 时打印地址，不带 `--no-open` 就打开浏览器（打不开只打印一行提示，不算失败：SSH、无桌面环境）。Ctrl-C 经现有的 `SIGINT` 停止序列退出。
- `plugin.ts`：离线操作登记表，不连运行中的服务端（审查第 9 条：离线只知道目标状态）。
  - `list [--json]`：读 `readRecord`，每个第三方插件列 id、版本、启用与否、待切换的版本、卸载中；有运行中的实例时首行写“变化在 <url> 的服务端重启后生效”。不调用 `prepareInstalledPlugins`（它会消费待生效变化、回收目录）。
  - `install <目录> [--yes]`、`enable <id>`、`disable <id>`、`uninstall <id>`：用 `createPluginInventory`（`startup` 给空集合，`builtin` 给产品清单的内置插件）的 `inspect`、`install`、`setEnabled`、`uninstall`；结果只报目标状态与“下一次启动生效”，不报它按空集合算出的待生效变化。`install` 先 `inspect`：降级时要 `--yes` 才装（同插件页的降级确认）。失败码原样打印（`already-installed`、`incompatible-engine` 等，plugin-install 的失败表）。
- 构建：`build:server` 增加 `bun build src/cli/main.ts --target bun --outfile dist/server/nbook.js`（入口第一行 `#!/usr/bin/env bun`，构建后核对保留）。`nbook.js` 与 `project.js` 同目录，`productProjectEntry` 不用改。

### 3.3 npm 包：`scripts/pack-app.ts`（新）

- 前置：`bun run build`。生成暂存目录 `dist/app-package/`：`server/nbook.js`、`server/project.js`、`web/**`、`LICENSE`、给用户的 `README.md`、生成的 `package.json`：`name` `@notnotype/neuro-book`、`version` `PRODUCT_VERSION`、`type: module`、`bin: {nbook: "./server/nbook.js"}`、`engines.bun` 取应用的、`license`、`repository`，没有 `dependencies`。
- 打包前核对：两个 bundle 用 `Bun.Transpiler.scanImports` 只引用 Bun/Node 内置模块（有外部包就失败并列出）。`bun pm pack --quiet --filename <dist/notnotype-neuro-book-<版本>.tgz>`。
- 源码包仍是 `private: true`：只有暂存目录能发，防止误发源码包。接进 `release:publish` 在第三期。
- 脚本 `build:app-package`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| 新 ADR 0032 | 新应用的交付：发构建产物（补充 ADR 0029 决定 6）；应用包自带 `nbook`；状态根缺省平台数据目录；一个状态根一个实例；发行的两个维度（运行时来源、界面宿主），目录包、桌面壳、服务器部署另写提案；不恢复旧 Manager 及其各项能力的去向 |
| 新 Spec `runtime/cli.md`（`runtime.cli`） | `nbook` 的子命令、选项、输出与退出码；状态根的取值顺序与缺省；插件子命令的离线语义 |
| `runtime/server-host.md` | 单实例：锁、地址文件、`runtime.state-root.busy`；“已安装插件……尚未实现”两处改成现状 |
| `runtime/plugin-install.md` | 输出 1 等处加命令行入口；“多个服务端进程”改成“服务端与命令行”；租约一段注明单实例下的作用；验收 15 改成服务端与命令行同时写 |
| `ui/component-lab.md` | 验收 22 改成同一开发服务、另一个回环别名 |
| `docs/modules/monorepo-boundaries.md` | 新应用的交付链：npm 包已有，其余另行设计 |
| 应用包给用户的 README（暂存进包里） | 安装、启动、状态根、插件管理 |

## 5. 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 单实例：锁、地址文件、`runServerProcess` 收 `config`；Lab 场景 22、插件场景 15 改写；server-host、plugin-install、component-lab 的 Spec | 3.1 | 类型检查；`src/server` 测试（两个真实进程同一状态根：第二个以 1 退出带地址；第一个被 SIGKILL 后重新启动成功）；`plugins.test.ts`；`lab.e2e.ts` 场景 22 |
| S2 | `nbook start` 与状态根缺省、打开浏览器、构建 `nbook.js`；`runtime/cli.md` 的启动部分 | 3.2 | `src/cli` 测试：真实进程从 `dist/server/nbook.js` 启动（`--no-open`、端口 0、临时状态根），health 与首页 200；再启动一次打印已有地址、退出 0；`defaultStateRoot` 三平台的取值 |
| S3 | 插件子命令；`runtime/cli.md` 的插件部分 | 3.2 | 真实进程：装示例插件的 `dist`、`list --json`、启停、卸载；服务端运行时装一个，重启后登记；降级不带 `--yes` 被拒 |
| S4 | npm 包暂存与 tarball；ADR 0032、monorepo-boundaries | 3.3 | `pack-app.test.ts`：临时目录 `bun add <tgz>`，`node_modules/.bin/nbook --version`、`start --no-open` 后 health 与首页 200、`plugin install` 示例插件；包里只有白名单内的文件 |

收口：全量 e2e；实现审查（后端 omp）。

## 6. 验收映射

写 Spec 时给条目编号，这里先按场景列：

- 单实例（server-host 新条目）：同一状态根的第二个进程以 1 退出并给地址 → S1 的进程测试；崩溃后重启 → 同上。
- `nbook start`（cli）：启动、已有实例时打开它、`--no-open`、状态根取值顺序 → S2 的进程测试与 `state-root` 单测。
- 插件子命令（cli、plugin-install 输出 1 到 4 的命令行入口）：→ S3 的进程测试。
- 服务端与命令行同时写登记表（plugin-install 验收 15 改写）→ `plugins.test.ts`。
- Lab 验收 22 改写 → `lab.e2e.ts`。
- npm 包可安装、可启动、自含依赖 → `pack-app.test.ts`。

## 7. 验证

- 每片的自跑验证见第 5 节；收口跑类型检查、`bun run test:affected` 与全量 e2e。
- 端到端：从 tarball 装进临时目录，`nbook start --no-open --state-root <临时>`，浏览器打开打印的地址能进工作台；`nbook plugin install` 一个用 `nbooke build` 构建的示例插件，重启后插件页列出它。
- 未验证边界：Windows 与 macOS 实机（状态根缺省只按代码与单测；`open` 与锁的行为未在这两个平台跑）；真实 `bun publish` 与从 registry 安装（第三期）；Bun 最低版本 `>=1.3.14`（只在 1.4.2 上跑）。

## 8. 不做与风险

- 不做：目录包、单文件、桌面壳、Docker 与服务器部署（各自另写提案）；状态根的版本与降级门禁（开发者定到桌面端再做）；`nbook project`、`nbook config`（作品管理等新应用的内容模型重建后并进 `nbook`）；GitHub Actions 的整理（第三期）；接进 `release:publish` 与真正发布（第三期）；删除插件版本的租约（单实例下多余，另记后续）。
- 风险：服务端崩溃后 10 秒内再启动会看到锁还在：`nbook start` 等锁过期再试一次（至多 15 秒），`bun dist/server/main.js` 直接报 busy；进程被暂停超过 10 秒（调试器、休眠）时锁会被判为残留，`holdLock` 的 `stillHeld` 能发现，此时记诊断，不自行退出。
- 风险：`open` 在没有桌面环境时可能静默成功却什么也没打开：启动时总是打印地址。
