# t05 实施计划：作者体验（脚手架、作者文档、完整示例、仓库外 smoke）

## Context

t04 把第三方插件的入口代码装载、SDK 公开面与构建预设做完了，但作者要写插件仍得读仓库源码：没有生成插件目录的命令，构建预设只能经仓库里的脚本调用，SDK 没有给工作台视图与状态栏的贡献点，示例里还有两个（menu、file-menu）没有外置，也没有一个覆盖“设置项 + 命令 + 视图 + 服务端远程服务 + 私有存储”的完整插件。本 Task 让仓库外的人按文档从零写出、构建、安装并调试一个插件（[t01 plan](../t01-requirements/plan.md) 的 S4，Task 范围见 [README](README.md)）。

依据：[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（SDK、选用规则）、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（清单生成、贡献点 schema）、[`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)（安装、启停、卸载）、[`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)（构建预设、纯度）、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)（视图贡献）、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（状态栏条目）。

开发者已定：示例改为外置插件，t05 补 menu、file-menu，六个示例都经构建、安装运行，进程内场景测试保留（2026-10-17）；t04、t05 按 autonomous-delivery 自主推进，照推荐做的决定记进 Work 的待确认清单（2026-10-23）。

工作方式：Work 分支 `feat/w00027-plugin-platform` 的 worktree；Spec 与 Task 记录在主工作区 master 上改。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 命令行解析（`nbook-plugin create`、`build`） | Node 内置 `node:util` 的 `parseArgs` | 两个子命令、几个开关，Node 与 Bun 都有，不加依赖；否决 commander、cac：为两个子命令多一个运行时依赖进 SDK 包 |
| 脚手架模板 | SDK 包里的模板目录，按文件复制并替换几个占位符（publisher、name、显示名） | 生成的是几个固定文件，不需要模板引擎；否决 create-* 生态的交互式提问库：命令要能在测试与 CI 里无交互运行 |
| SDK 包的分发 | 本轮只生成目录并可 `npm pack` 成 tarball，作者用 `file:` 或 tarball 路径安装 | 正式发布不在范围（README 非目标）；否决在仓库里起本地 registry：只为 smoke 引入一套服务 |

## 关键设计

### `packages/neuro-book/src/sdk/`：补工作台的贡献点

完整示例与脚手架模板要画视图、放状态栏条目。SDK 加：

- `index.ts`：`WORKBENCH_VIEWS_POINT`、`WORKBENCH_STATUSBAR_ITEMS_POINT`；类型 `ViewDeclaration`、`ViewLocation`、`ItemDeclaration`（来自 `src/plugins/workbench/shared/contracts.ts`，纯数据，前后端都能引用）。
- `browser.ts`：类型 `ViewImplementation`、`ViewContext`、`ItemImplementation`（来自 `src/plugins/workbench/web/contracts.ts`，依赖 Vue）。
- 不加 `notificationsKey`、`quickPickKey`、文件与编辑器的合同：完整示例用不到，每加一项都是兼容承诺，等有作者需要再加。
- `sdk.test.ts` 与 `build-sdk.test.ts` 的导出快照随之改。

### `packages/nb-runtime/src/plugin-manifest/plugin-manifest.ts`：第三方贡献点不能带 `validate`

现状：`manifestOf` 只拒绝“只写了 `validate`、没写 `schema`”的第三方贡献点；同时写了两者时照常生成清单，而宿主按清单还原的贡献点没有 `validate`，作者写的校验悄悄失效（menu 示例正是这样写的）。改为：非内置插件的贡献点写了 `validate` 就报问题（“函数进不了清单：用 schema 写声明的结构，跨条目的规则放在接收者里”）。`plugin-manifest.test.ts` 的 `manifestOf` 用例加一条。

### `packages/neuro-book/examples/plugins/menu`、`file-menu`：外置

- menu 的贡献点改写 `schema`（`title` 非空字符串、`additionalProperties: false`），去掉 `validate`；“菜单项 id 以插件 id 加 `.` 开头”这条跨不了 JSON Schema，改到接收者里：`published` 时不合规的条目不进菜单并记一条诊断。讲解注释随之改：贡献点的校验分两层，能写成 schema 的进清单、由内核在登记时核对，其余在接收者里。
- 场景 `examples/scenarios/03-contribution-point.test.ts` 按新的拒绝方式改断言（被拒的条目不出现在 `titles()` 里，原因可查）。
- 加 `package.json`（publisher `example`），`build:examples` 能构建；e2e 的后端示例用例装上 menu 与 file-menu，核对服务端日志里没有激活失败、menu 的服务列出 file-menu 的菜单项（经 menu 服务端入口启动时记的一条 info 诊断，或改为经远程合同查询，选能从 e2e 观察的那种，实施时以现有示例的观察方式为准）。

### `packages/neuro-book/scripts/plugin-sdk/cli.ts`：`nbook-plugin` 命令

生成的 SDK 包加 `bin: {"nbook-plugin": "./cli.js"}`（`build-sdk.ts` 把 `cli.ts` 打包成 `cli.js`，第一行 `#!/usr/bin/env node`）。

```text
nbook-plugin create <目录> [--publisher <段>] [--name <段>]
nbook-plugin build [作者目录，缺省 .] [--out <目录>，缺省 dist]
```

- `create`：目录不存在或为空才写；publisher 缺省 `my`，name 缺省目录名转成 id 段（不合法时报错并说明规则）。写出模板（见下一节）后打印下一步（安装依赖、构建、在插件页安装 `dist` 的路径）。
- `build`：调用 `buildPlugin`；`PluginBuildError` 按问题逐行打印、退出码 1；警告打印到 stderr、退出码 0。输出目录规则沿用 `buildPlugin`（不存在或为空）；`--clean` 先清空“上次的产物”（清单的 publisher 与 name 与作者目录相同），与 `build-examples.ts` 的 `isPreviousBuild` 共用一个函数（移进 `build-plugin.ts` 导出）。
- 运行时：Node 22 与 Bun 都能跑（构建预设只用 Node API 与 Vite）；`import.meta.main` 分支换成 bin 入口，不依赖 Node 24.2 之后才有的特性。
- 仓库里的 `build:examples` 与作者的 `nbook-plugin build` 走同一个 `buildPlugin`，只是别名不同。

### `packages/neuro-book/scripts/plugin-sdk/template/`：脚手架模板

最小但完整、能构建、装上就能看见：

- `package.json`：publisher、name、version `0.1.0`、`displayName`；`scripts.build = "nbook-plugin build --clean"`；devDependencies：SDK（版本等于产品版本）、`vue`、`typebox`、`typescript`。
- `tsconfig.json`：普通的 `bundler` 解析、`strict`，`types` 不含 DOM 之外的东西。
- `plugin.ts`：描述（运行位置 browser）与一个设置项 `<id>/greeting`。
- `web/plugin.ts`：浏览器入口：一个侧栏视图 `<id>.hello`、一条命令 `<id>.say-hello`（经设置项读问候语，结果显示在视图里）。
- `web/HelloView.vue`：用 nb-ui 组件画，读 `ViewContext`。
- `README.md`：三步（安装依赖、构建、安装进 NeuroBook）与作者文档的链接。

模板本身也是测试对象：`template.test.ts` 在仓库外的临时目录里 `create` → 用生成的 SDK 包 `build` → 读出的清单经 `readPluginManifest` 有效、入口文件存在、浏览器产物经装载器测试的假页面能激活（复用 t04 的 `registeredFactory`）。

### `packages/neuro-book/examples/plugins/focus`：完整示例“专注计时”

写作时的番茄钟：覆盖设置项、命令、视图、状态栏条目、服务端远程服务与私有存储，只用 SDK 已有的接口（不碰文件与编辑器的内部合同）。

- 设置项（`plugin.ts` 的顶层声明，list 分区 `example.focus.main`）：`example.focus/minutes`（专注时长，整数 5–120，缺省 25）、`example.focus/sound`（结束时是否提示，布尔，缺省 true）。
- 服务端入口 `backend/plugin.ts`：远程合同 `example.focus/sessions`（`start`、`finish`、`cancel`、`today`；事件 `changed`），会话记录用 `nbook.storage` 的私有记录持久化（用户层，每天一条汇总、最近 50 条会话）。计时的权威在服务端：窗口关闭再打开，进行中的会话照常结束。
- 浏览器入口 `web/plugin.ts`：侧栏视图 `example.focus.panel`（倒计时、开始与放弃按钮、今天完成的次数与分钟数）；状态栏条目（进行中显示剩余时间，否则显示今天的番茄数）；命令 `example.focus.start`、`example.focus.cancel`（进命令面板）。浏览器入口以调用方身份经远程合同读写，订阅 `changed` 更新视图与状态栏。
- 时间来自宿主时钟 `hostClockKey`，场景测试注入时钟推进，不按固定时长等待。
- 场景测试 `examples/scenarios/07-focus.test.ts`：在进程内的真实宿主上开始、推进时钟、结束，核对记录、事件与状态栏文本；关掉再重启服务端入口后进行中的会话照常结束。视图组件的 Vitest dom 测试按 snippets 的写法。
- 讲解注释按示例的写法（每个文件开头说明演示什么、关键步骤说明为什么）。

### `packages/neuro-book/scripts/plugin-sdk/README.md`（打进 SDK 包的作者文档）与 `examples/README.md`

- 作者文档写进 SDK 包的 `README.md`（`build-sdk.ts` 复制）：安装 SDK、`create`、目录结构、写入口（运行位置、激活事件、贡献）、构建与纯度检查的常见报错、安装与重启、调试（服务端日志、诊断、浏览器开发者工具的 source map）、发布目录（`dist` 整个目录交给用户）。行为规则链接 Spec，不复述。
- 仓库里的 Spec 链接在包外读者那里打不开：文档里链接写成仓库的公开地址（`docs/specs/...` 的 GitHub 地址），由 `build-sdk.ts` 在复制时把相对链接改写成仓库地址。
- `examples/README.md`：加“外部插件”一节（六个示例与 focus 都按第三方插件构建、安装运行；怎样 `build:examples` 后在插件页安装），阅读顺序加 focus，“几个概念”里设置分区那行补 list 分区的写法。

### 仓库外 smoke

- 自动部分 `e2e/plugin-authoring.e2e.ts`：在系统临时根里用生成的 SDK 包（依赖按 `build-sdk.test.ts` 的做法从仓库的 `node_modules` 链接）`create` → `build` → 在插件页输入 `dist` 路径安装 → 重启服务端 → 侧栏出现模板的视图、命令面板能执行命令、改设置项后视图跟着变 → 禁用、重启后视图消失 → 卸载、重启后插件页不再列出。
- 手动部分（证据）：照 SDK 包 README 的字面步骤，在仓库外目录 `npm pack` 出 SDK、`bun install`（真实网络，必要时 `prox`）、`create` focus 之外的一个新插件、构建、装进 `nbdev dev start` 起的开发服务，截图记进 Task 证据。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/plugin-api.md` | SDK 一节：加工作台的视图与状态栏贡献点；加“作者工具”：`nbook-plugin create`、`build` 的输入、输出与失败（模板生成的目录能直接构建并安装；构建失败退出码 1 并逐条列出问题） |
| `docs/specs/runtime/plugin-manifest.md` | 第三方插件的贡献点写了 `validate` 时清单生成失败（原来只写“只有 validate”） |
| `docs/specs/runtime/plugin-code-loading.md` | 构建预设：`--clean` 与“上次的产物”的判断 |
| `packages/neuro-book/examples/README.md` | 见上 |

## 切片

1. **S1 SDK 补工作台贡献点、manifestOf 拒绝第三方 `validate`、menu 与 file-menu 外置**：关键设计前三节。验证：`bun test` 内核 plugin-manifest、`examples/`、`src/sdk`、`scripts/plugin-sdk`；e2e `plugin-code.e2e.ts`。
2. **S2 `nbook-plugin` 命令与模板**：`cli.ts`、`template/`、`build-sdk.ts` 带上 bin 与模板、`template.test.ts`。验证：`bun test scripts/plugin-sdk`；在仓库外临时目录用 Node（不是 Bun）跑一次生成的 `cli.js build`。
3. **S3 完整示例 focus**：插件、场景 07、dom 测试；`build:examples` 能构建；e2e 加一例装上 focus、开始一次专注、状态栏与视图更新（推进时钟用服务端的测试时钟入口，没有就只核对开始与放弃）。
4. **S4 作者文档与 examples/README**；`build-sdk.ts` 复制 README 并改写链接。验证：`docs:check`；SDK 包里的 README 链接都是绝对地址。
5. **S5 仓库外 smoke**：`plugin-authoring.e2e.ts`；手动 smoke 的截图与步骤记录。收口：全量 e2e。

每片单独提交；Spec 改动在对应切片之前提交到 master。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| plugin-api SDK（新增导出） | `sdk.test.ts`、`build-sdk.test.ts` 快照与仓库外类型检查 |
| plugin-api 作者工具（create、build） | `template.test.ts`、`plugin-authoring.e2e.ts` |
| plugin-manifest 清单生成（第三方 `validate`） | `plugin-manifest.test.ts` |
| plugin-install 输出 1、4、3（安装、启停、卸载，重启生效） | `plugin-authoring.e2e.ts` |
| plugin-code-loading 输出 1–5（外置示例装载、纯度） | `plugin-code.e2e.ts`（加 menu、file-menu、focus） |
| workbench/views 第三方视图贡献 | `plugin-authoring.e2e.ts`（模板视图）、focus 的 e2e |
| 示例行为 | `examples/scenarios/03`、`07` 与 focus 的 dom 测试 |

## 验证

- 单元与场景：`bun run test:affected`；两包 typecheck；`docs:check`。
- 真实浏览器：`plugin-code.e2e.ts`、`plugin-authoring.e2e.ts`；收口跑全量 e2e。
- 手动：照文档在仓库外装一遍（含真实 `bun install`），截图进证据。
- 不验证：SDK 包发布到 npm 之后的安装（不发布）；Windows 与 macOS 上的命令行。

## 不做与风险

- 不做：插件开发时的就地加载与热重载（t04 已记为推迟）；`notificationsKey` 等更多宿主服务进 SDK；SDK 的正式发布；插件模板的多种变体（只有浏览器入口的一种；服务端入口的写法看 focus 示例）。
- 风险：模板与 focus 用的视图、状态栏接口进了 SDK 就是兼容承诺，0.x 期间仍可调整，但要同步 Spec 与示例；生成的 `cli.js` 在 Node 上跑 Vite 的 SSR 读声明（`.vue`、TypeScript）要实测，Node 读不了 TypeScript 的描述文件时改由 Vite 转译（构建预设已经这样做）；e2e 里推进专注计时要有服务端时钟的测试入口，没有就缩小判据，不加产品代码里的测试分支。
