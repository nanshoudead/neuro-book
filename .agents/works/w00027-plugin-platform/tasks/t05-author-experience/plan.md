# t05 实施计划：作者体验（脚手架、作者文档、完整示例、仓库外 smoke）

## Context

t04 把第三方插件的入口代码装载、SDK 公开面与构建预设做完了，但作者要写插件仍得读仓库源码：没有生成插件目录的命令，构建预设只能经仓库里的脚本调用，SDK 没有给工作台视图与状态栏的贡献点，nb-ui 组件在仓库外拿不到实现与类型，示例里还有两个（menu、file-menu）没有外置，也没有一个覆盖“设置项 + 命令 + 视图 + 服务端远程服务 + 私有存储”的完整插件。本 Task 让仓库外的人按文档从零写出、构建、安装并调试一个插件（[t01 plan](../t01-requirements/plan.md) 的 S4，Task 范围见 [README](README.md)）。

依据：[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（SDK、选用规则）、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（清单生成、贡献点 schema、id 规则）、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)（贡献点登记与拒绝）、[`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)（安装、升级、启停、卸载）、[`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)（构建预设、宿主模块表、纯度）、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)（视图贡献）、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（状态栏条目）。

开发者已定：示例改为外置插件，t05 补 menu、file-menu，六个示例都经构建、安装运行，进程内场景测试保留（2026-10-17）；t04、t05 按 autonomous-delivery 自主推进，照推荐做的决定记进 Work 的待确认清单；本次可以做深入审查（2026-10-23）。

工作方式：Work 分支 `feat/w00027-plugin-platform` 的 worktree；Spec 与 Task 记录在主工作区 master 上改。

2026-10-23 设计审查（omp 默认模型、Claude Sonnet，omp 额度用完后由 Claude Opus 补审后端）后修订，逐条处理见文末“设计审查的处理”。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 命令行解析（`nbook-plugin create`、`build`） | Node 内置 `node:util` 的 `parseArgs` | 两个子命令、几个开关，Node 与 Bun 都有，不加依赖；否决 commander、cac：为两个子命令多一个运行时依赖进 SDK 包 |
| 脚手架模板 | SDK 包里的模板目录，按文件复制并替换几个占位符（publisher、name、显示名） | 生成的是几个固定文件，不需要模板引擎；否决 create-* 生态的交互式提问库：命令要能在测试与 CI 里无交互运行 |
| 作者项目的类型检查 | `vue-tsc`（模板 devDependencies） | `.vue` 要它才查得了；仓库已在用 |
| SDK 包的分发 | 本轮只生成目录并可 `npm pack` 成 tarball，作者先在新目录里 `npm install -D <tarball>`，再 `npx nbook-plugin create .` | 正式发布不在范围（README 非目标）；否决在仓库里起本地 registry：只为 smoke 引入一套服务 |

## 关键设计

### `packages/neuro-book/src/sdk/`：补工作台贡献点、视图助手与组件入口

- `index.ts`：`WORKBENCH_VIEWS_POINT`、`WORKBENCH_STATUSBAR_ITEMS_POINT`；类型 `ViewDeclaration`、`ViewLocation`、`ItemDeclaration`（来自 `src/plugins/workbench/shared/contracts.ts`，纯数据）。
- `browser.ts`：类型 `ViewImplementation`、`ViewContext`、`ItemImplementation`（来自 `src/plugins/workbench/web/contracts.ts`）；视图助手 `viewContribution`。
- **视图助手** `src/plugins/workbench/web/view-contribution.ts`，与 `settingsPageContribution` 对称：

  ```ts
  viewContribution<const Id extends string>(options: {id: Id; declaration: ViewDeclaration; load: () => Promise<Component | {default: Component}>}): {
      id: Id;
      contribution: {capability: typeof WORKBENCH_VIEWS_POINT; id: Id; declaration: ViewDeclaration};
      implementation(props?: () => Readonly<Record<string, unknown>>): ViewImplementation;
  }
  ```

  视图组件收 `context` 与 `props()` 给的属性，入口激活时拿到的服务经 `props` 交给组件；`load` 可以直接写 `() => import("./X.vue")`。包组件的那段从 `src/ui/settings/settings-page.ts` 抽成 `src/ui/bound-component.ts` 的 `boundComponent(name, load, props)`，设置页与视图共用。状态栏条目的实现是几个函数（`text()`、`state()`、`tooltip()`），不需要助手，作者文档写出标准写法。
- **组件入口** `src/sdk/components.ts`：重新导出 `@notnotype/nb-ui/components`，SDK 包加子路径 `./components`（实现与 `vue-tsc` 生成的声明）。作者只从 `@notnotype/nb-plugin-sdk/components` 取 nb-ui 组件：nb-ui 是不发布的私有包，作者装不到它，这样构建期执行入口定义（静态导入 `.vue` 时会执行到组件导入）与类型检查都有着落。宿主模块表（`src/shared/plugin-modules.ts`）的浏览器表把 `@notnotype/nb-ui/components` 换成 `@notnotype/nb-plugin-sdk/components`，宿主给的是同一个模块对象；构建预设的 `HOST_PACKAGES` 仍含 nb-ui，作者直接导入 nb-ui 会被纯度检查报“打进了宿主实现”，报错提示改用 SDK 的子路径。snippets 示例随之改导入。
- `sdk.test.ts` 与 `build-sdk.test.ts` 的导出快照随之改；`build-sdk.test.ts` 的仓库外作者项目加一个用 SDK 组件的 `.vue`，并跑 `vue-tsc`。

### `packages/nb-runtime/`：贡献 id 前缀、第三方 `validate`、id 段规则

- **贡献 id 前缀**：`ContributionPointDefinition` 加可选 `idPrefix?: "plugin"`：贡献 id 必须以贡献方插件 id 加 `.` 开头，否则登记时拒绝（与 `schema`、`validate` 的拒绝同一条路径，原因可查）。它进清单的贡献点条目，第三方贡献点不写 `validate` 也能得到这条规则。内置的视图、条目、菜单的校验还带“内置插件用 `nbook.` 前缀”的例外，不改用它。
- **第三方 `validate`**：`manifestOf` 原来只拒绝“只写了 `validate`、没写 `schema`”的第三方贡献点；同时写了两者时，宿主按清单还原的贡献点没有 `validate`，它在宿主里不会运行。改为非内置插件的贡献点写了 `validate` 就报问题（“函数进不了清单：用 schema 与 idPrefix 写声明的规则，跨条目的规则放在接收者里”）。现在同一个贡献点在几个运行位置的定义里出现时，`manifestOf` 遇到已见过的 id 只比 `implementation` 就跳过，后面的检查轮不到第二份；改为每份定义先各自检查（`validate`、schema 可移植性），再按 id 聚合，聚合时 `implementation`、`schema`、`idPrefix` 不一致都报问题，不按定义顺序取第一份。
- **id 段规则**：清单的 `ID_SEGMENT` 从“字母或数字开头”收紧为“字母开头”：视图、条目、菜单 id 每段要字母开头，插件 id 以数字开头时它派生的 id 全被登记校验拒绝（构建与安装都通过，装上后视图静默不出现）。现在还没有第三方插件，收紧的代价最低。
- 测试：`plugin-manifest.test.ts`（`idPrefix` 进清单、第三方 `validate`、数字开头的段）、内核登记的贡献测试（`idPrefix` 拒绝与原因）。

### `packages/neuro-book/examples/plugins/menu`、`file-menu`：外置

- menu 的贡献点改写 `schema`（`title` 非空字符串、`additionalProperties: false`）与 `idPrefix: "plugin"`，去掉 `validate`。讲解注释改为：贡献点的规则写成 schema 与 `idPrefix` 进清单、由内核在登记时核对，跨条目的规则放在接收者里。场景 `examples/scenarios/03-contribution-point.test.ts` 的语义不变（被拒的条目不出现在 `titles()`，原因可查），只改拒绝原因的文字断言。
- 加 `package.json`（publisher `example`），`build:examples` 能构建。
- menu 的服务端入口加 `activationEvents: ["onStartup"]`，接收者在 `published` 时记一条 info 诊断（收到哪个插件的哪一项）：贡献的发布不会激活拥有者，menu 没人依赖时一直不激活，装上也看不出它能不能运行。讲解注释写明这两点；不让 file-menu 依赖 menu 的服务（示例要教的正是“贡献不构成依赖”）。
- e2e `plugin-code.e2e.ts` 的后端示例用例装上 menu 与 file-menu，用肯定判据：服务端日志里两个服务端入口都有 `published`，并有 menu 收到 `example.file-menu.open` 的诊断。

### `packages/neuro-book/scripts/plugin-sdk/cli.ts`：`nbook-plugin` 命令

生成的 SDK 包加 `bin: {"nbook-plugin": "./cli.js"}`（`build-sdk.ts` 把 `cli.ts` 打包成 `cli.js`，第一行 `#!/usr/bin/env node`）。

```text
nbook-plugin create <目录> [--publisher <段>] [--name <段>]
nbook-plugin build [作者目录，缺省 .] [--out <目录>，缺省 dist] [--clean] [--dev]
```

- **`create`**：可写的目录、`package.json` 的合并、`--sdk` 与 SDK 依赖的写法按 plugin-api 的“作者工具”；id 段规则用内核导出的 `isIdSegment`。写完打印下一步；SDK 依赖是 registry 版本时在标准错误提示先装 tarball。
- **`build`**：调用 `buildPlugin`；`PluginBuildError` 按问题逐行打印、退出码 1；警告打印到 stderr、退出码 0。`--clean` 先清空“上次的产物”（清单的 publisher 与 name 与作者目录相同），与 `build-examples.ts` 的 `isPreviousBuild` 共用一个函数（移进 `build-plugin.ts` 导出）。
- **`--dev`**：产物清单的版本写成 `<version>+dev.<UTC 时间到秒>.<毫秒>`（构建元数据，见 `devVersion` 的注释）。作者的循环是“`build --dev`、在插件页安装、重启”，不用改版本号也不用先卸载。
- 运行时：Node 22 与 Bun 都能跑（构建预设只用 Node API 与 Vite）；`import.meta.main` 分支换成 bin 入口。
- 仓库里的 `build:examples` 与作者的 `nbook-plugin build` 走同一个 `buildPlugin`。

### `packages/neuro-book/scripts/plugin-sdk/template/`：脚手架模板

最小但完整、能构建、能类型检查、装上就能看见：

- `package.json`：publisher、name、version `0.1.0`、`displayName`；`scripts.build = "nbook-plugin build --clean"`、`scripts.dev = "nbook-plugin build --clean --dev"`、`scripts.typecheck = "vue-tsc --noEmit"`；devDependencies：SDK、`vue`、`typebox`、`typescript`、`vue-tsc`。
- `tsconfig.json`：`bundler` 解析、`strict`、`lib: ES2020 + DOM`；`env.d.ts` 声明 `*.vue` 模块。
- `plugin.ts`：描述（运行位置 browser）与一个设置项 `<id>/greeting`。
- `web/plugin.ts`：浏览器入口，`activationEvents: ["onStartup"]` 并注释为什么（视图与状态栏条目的实现在激活时交出，不激活就不出现；代价是每个窗口启动时都下载并执行这个入口）。一个侧栏视图 `<id>.hello`（经 `viewContribution`，把设置服务给的问候语经 `props` 交给组件）、一条命令 `<id>.say-hello`（在视图里显示一次问候与时间）。
- `web/HelloView.vue`：只用 `@notnotype/nb-plugin-sdk/components` 的组件、`<style scoped>` 与主题 token 变量，不写原子类；根元素带 `data-hello-view`，显示的问候语来自设置项。
- `README.md`：三步（装依赖、构建、安装进 NeuroBook）、开发循环与作者文档的链接。

模板本身是测试对象：`template.test.ts` 在仓库外的临时目录里，用 `build-sdk` 生成的 SDK 包（依赖按 `build-sdk.test.ts` 的做法从仓库的 `node_modules` 链接）`create` → `vue-tsc` → `build` → 清单经 `readPluginManifest` 有效、入口文件存在、浏览器产物经装载器测试的假页面能激活（复用 t04 的 `registeredFactory`）；另测 `create` 的合并已有 `package.json`、拒绝非空目录、拒绝数字开头的名字，`build --dev` 的版本。

### `packages/neuro-book/examples/plugins/focus`：完整示例“专注计时”

写作时的番茄钟：覆盖设置项、命令、视图、状态栏条目、服务端远程服务与私有存储，只用 SDK 的接口。

- **设置项**（`plugin.ts` 的顶层声明，list 分区 `example.focus.main`）：只有 `example.focus/minutes`（专注时长，整数 1–120，缺省 25，`layers: ["user"]`：服务端只读得到缺省与用户层，作品层的值在服务端不生效）。
- **远程合同** `example.focus/sessions`（`shared/contracts.ts`）：`start()`（已在进行时业务失败 `already-running`）、`cancel()`（空闲时 `not-running`；三个方法写存储失败时都是 `storage-failed`）、`today()` 返回 `{running: {startedAt, endsAt} | null, completed, minutes, now}`；事件 `changed`。“结束”不是调用：服务端按 `endsAt` 自己结束。
- **服务端入口** `backend/plugin.ts`：`activationEvents: ["onStartup"]`。进行中的会话与今天的汇总用 `nbook.storage` 的私有记录（用户层、`locality: "shared"`：缺省的 `local` 在服务端打不开；一条记录：进行中的会话 `{startedAt, endsAt}`、日期与完成数、分钟数）。
- **结算**：一个 `settle(now)` 函数，在激活、`today`、`start`、`cancel` 里都先调用：进行中的会话已过 `endsAt` 就记为完成（完成算在 `endsAt` 那一天，日期按服务端本地时区；记录的日期不是今天时汇总清零）。写入用存储的条件保存，以 `startedAt` 作会话身份：同一状态根上的几个服务端（runtime/projects）都会激活 focus，冲突时重读，会话已被别人结算就不再记一次。计时器只负责到点调一次 `settle` 并推 `changed`；机器休眠推迟了计时器也不影响结果，下一次读写会先结算。存储失败作业务失败码 `storage-failed` 返回。
- **浏览器状态** `web/focus-store.ts`（纯 TS）：依赖一个只含 `start`、`cancel`、`today`、`subscribe` 的接口，持有 `running`、`today`、`ready` 与 `now`。首次显示与 `changed`、`onResync` 都走“重读 `today()`”；剩余时间按 `endsAt - now` 算，`now` 用服务端给的 `now` 与本地时钟对齐（只记偏差），不每秒减一；只在有进行中的会话时用宿主时钟每秒推进 `now`，空闲时不排计时器，入口停止时取消。
- **浏览器入口** `web/plugin.ts`：`activationEvents: ["onStartup"]`；侧栏视图 `example.focus.panel`（`viewContribution`，`layout: "scroll"`、`minimumSize: {width: 200}`）；状态栏条目（`ready` 前显示省略号；进行中显示剩余时间，否则显示今天的番茄数；点击执行 `example.focus.toggle`）；命令 `example.focus.start`、`example.focus.cancel`、`example.focus.toggle`（进命令面板，`effect: write`，不暴露给 Agent，示例里写明这个选择）。
- **视图交互**：一个主按钮原位切换“开始”“放弃”（焦点留在按钮上）；剩余时间用 `role="timer"`，完成与放弃时用一个礼貌型 live 区域播报一次；按钮在窄宽下换行。
- **场地的工作台替身**（`examples/testing/stage.ts`）：浏览器场地加一个只拥有 `workbench.views`、`workbench.statusbar-items` 两个贡献点的替身插件，校验用产品 `shared/views.ts`、`shared/items.ts` 的同一份函数，接收者把交付的实现收进表；场景读条目的 `text()`、`state()`。视图组件不在 Bun 里加载（`.vue`），由 dom 测试覆盖。
- **场景测试** `examples/scenarios/07-focus.test.ts`：真实宿主上开始、推进注入的时钟、完成，核对记录、`changed`、状态栏文本；两个服务端共用一个状态根，到点只记一次完成；会话跨零点算在结束那天；`already-running`、`not-running`；停掉服务端入口再启动后，已过期的会话记为完成、未到期的照常结束；浏览器入口停止后、空闲推进一天后 `clock.pending()` 为 0；重连（`onResync`）后状态与服务端一致。
- **dom 测试**（Vitest）：组件对 store 状态的呈现与键盘行为（键盘开始后焦点仍在主按钮、`role="timer"`、播报一次）；store 用真实实现，接口用内存里的假实现，其返回值与场景 07 里真实远程的断言是同一组。
- 讲解注释按示例的写法（每个文件开头说明演示什么、关键步骤说明为什么）。

### `packages/neuro-book/scripts/plugin-sdk/README.md`（打进 SDK 包的作者文档）与 `examples/README.md`

- 作者文档写进 SDK 包的 `README.md`（`build-sdk.ts` 复制），自己讲清楚“怎么做”，Spec 链接只作规则细节的出口：安装 SDK 与 `create`、目录结构、写入口（运行位置、激活事件：视图与状态栏条目为什么要 `onStartup` 及代价、贡献）、**界面**（只用 SDK 的组件、`<style scoped>` 与 token 变量，不写原子类：插件样式包进 `@layer components`，宿主的原子类只按宿主源码生成，插件里写了要么不生效、要么只是碰巧生效；不覆写组件内部样式；图标写字面量 `i-lucide-*`；`layout` 与 `minimumSize` 的选法，侧栏默认约 240px）、构建与纯度检查的常见报错、开发循环（`build --dev`、安装、重启）、调试（服务端日志、诊断、浏览器开发者工具的 source map）、发布目录（`dist` 整个目录交给用户）。
- 生成两份附表一起进 SDK 包：组件清单（从 `@notnotype/nb-ui/components` 的导出生成，属性看声明文件）、主题 token 清单（从 nb-ui 的 `tokens.css` 提取变量名与所在分组）。
- 文档引用的 Spec 随 SDK 包复制一份（`specs/`），README 里的链接改写到包里的副本：SDK 版本与它读到的 Spec 一致，也不依赖构建时的提交在远端存在（Work 分支不 push）。副本里指向别的文档的链接不改写，`docs:check` 不检查包内文件。
- `examples/README.md`：加“外部插件”一节（七个示例都按第三方插件构建、安装运行；怎样 `build:examples` 后在插件页安装），阅读顺序加 focus，“几个概念”里设置分区那行补 list 分区的写法。

### 仓库外 smoke

- 自动部分 `e2e/plugin-authoring.e2e.ts`：在系统临时根里用生成的 SDK 包 `create` → `build` → 在插件页输入 `dist` 路径安装 → 重启服务端 → 窗口就绪后，侧栏视图里 `[data-hello-view]` 显示设置项的问候语、命令面板执行 `say-hello` 后视图里出现问候 → 改设置项后视图跟着变 → 禁用：插件行先显示待生效，重启、窗口就绪后视图消失 → 卸载：同样两步，插件页不再列出。
- focus 的 e2e（`plugin-code.e2e.ts` 加一例）：装上 focus、窗口就绪后状态栏条目显示今天 0 个，在视图里开始，主按钮变成“放弃”、状态栏显示剩余时间，放弃后回到今天 0 个。完成与跨重启恢复由场景 07 覆盖，e2e 不覆盖（e2e 没有服务端时钟入口，也不为它在产品代码里加测试分支）。
- 手动部分（证据）：照 SDK 包 README 的字面步骤，在仓库外目录 `npm pack` 出 SDK、新目录里 `npm install -D <tarball>`（真实网络，必要时 `prox`）、`npx nbook-plugin create .`、`vue-tsc`、构建、装进 `nbdev dev start` 起的开发服务，再用 `--dev` 改一次界面重装，截图记进 Task 证据。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/plugin-api.md` | SDK：工作台视图与状态栏贡献点、`viewContribution`、`./components` 子路径；“作者工具”：`create`（可写的目录、合并 `package.json`、id 段规则）、`build`（退出码、`--clean`、`--dev` 的版本） |
| `docs/specs/runtime/plugin-manifest.md` | id 段字母开头；贡献点条目加 `idPrefix`；第三方贡献点写了 `validate` 时清单生成失败 |
| `docs/specs/runtime/plugins.md` | 贡献点定义的 `idPrefix` 与它的拒绝 |
| `docs/specs/runtime/plugin-code-loading.md` | 浏览器宿主模块表：`@notnotype/nb-plugin-sdk/components` 取代 `@notnotype/nb-ui/components`；构建预设的 `--clean` 与“上次的产物”；直接导入 nb-ui 的报错 |
| `packages/neuro-book/examples/README.md` | 见上 |

## 切片

1. **S1 内核与 SDK 面**：贡献 `idPrefix`、第三方 `validate`、id 段规则；SDK 工作台贡献点、`viewContribution`、`./components` 与宿主模块表；menu、file-menu 外置；snippets 改导入。验证：`bun test` 内核 plugins 与 plugin-manifest、`examples/`、`src/sdk`、`scripts/plugin-sdk`；Vitest 浏览器装载与视图；e2e `plugin-code.e2e.ts`。
2. **S2 `nbook-plugin` 命令与模板**：`cli.ts`、`template/`、`build-sdk.ts` 带上 bin 与模板、`template.test.ts`。验证：`bun test scripts/plugin-sdk`；在仓库外临时目录用 Node（不是 Bun）跑一次生成的 `cli.js create` 与 `build`。
3. **S3 完整示例 focus**：场地的工作台替身、插件、store、场景 07、dom 测试；`build:examples` 能构建；e2e 加 focus 一例。
4. **S4 作者文档与 examples/README**；`build-sdk.ts` 复制 README、生成组件与 token 清单、改写链接。验证：`docs:check`；SDK 包里的 README 链接都是固定到提交的绝对地址。
5. **S5 仓库外 smoke**：`plugin-authoring.e2e.ts`；手动 smoke 的截图与步骤记录。收口：全量 e2e。

每片单独提交；Spec 改动在对应切片之前提交到 master。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| plugin-api SDK（新增导出、`viewContribution`、`./components`） | `sdk.test.ts`、`build-sdk.test.ts`（快照、仓库外 `vue-tsc`）、视图助手的 Vitest |
| plugin-api 作者工具（create、build、`--dev`） | `template.test.ts`、`plugin-authoring.e2e.ts` |
| plugin-manifest id 段、`idPrefix`、第三方 `validate` | `plugin-manifest.test.ts` |
| plugins 贡献点 `idPrefix` 的拒绝 | 内核贡献登记测试、场景 03 |
| plugin-code-loading 宿主模块表（SDK 组件子路径、直接导入 nb-ui 报错） | 构建预设测试、`plugin-code.e2e.ts`（snippets） |
| plugin-install 安装、启停、卸载在重启后生效（数据保留不在这里验） | `plugin-authoring.e2e.ts` |
| plugin-api 作者工具的退出码、`--clean` 的拒绝、`create` 的合并与 `--sdk`、`--dev` 的版本先后 | `template.test.ts`（用 Node 运行生成的 `cli.js`） |
| plugin-code-loading 输出 1–5（外置示例装载） | `plugin-code.e2e.ts`（加 menu、file-menu、focus） |
| workbench/views 第三方视图贡献；workbench-shell 第三方状态栏条目 | `plugin-authoring.e2e.ts`（模板视图）、focus 的 e2e 与场景 07 |
| 示例行为 | `examples/scenarios/03`、`07` 与 focus 的 dom 测试 |

## 验证

- 单元与场景：`bun run test:affected`；两包 typecheck；`docs:check`。
- 真实浏览器：`plugin-code.e2e.ts`、`plugin-authoring.e2e.ts`；收口跑全量 e2e。
- 手动：照文档在仓库外装一遍（含真实 `npm install`），截图进证据。
- 不验证：SDK 包发布到 npm 之后的安装（不发布）；Windows 与 macOS 上的命令行；focus 的完成与跨重启恢复在真实浏览器里的表现（由场景 07 覆盖）。

## 不做与风险

- 不做：插件开发时的就地加载与热重载（t04 已记为推迟；`--dev` 是不改装载机制时最短的循环）；`notificationsKey` 等更多宿主服务进 SDK；SDK 的正式发布；插件模板的多种变体（只有浏览器入口的一种；服务端入口的写法看 focus 示例）；构建时对 `.vue` 里原子类的警告（分不出作者自己的 scoped 类名与宿主原子类，误报多，靠文档与模板示范）。
- 风险：模板与 focus 用的视图、状态栏、组件接口进了 SDK 就是兼容承诺，0.x 期间仍可调整，但要同步 Spec 与示例；`./components` 的声明靠 `vue-tsc` 从 nb-ui 源码生成，nb-ui 组件若依赖 Nuxt 的自动导入或全局类型，声明会生成失败，S1 先实测，失败时缩成作者需要的组件清单再导出；生成的 `cli.js` 在 Node 上跑 Vite 的 SSR 读声明要实测（审查时 Node 26 上已跑通构建预设，Node 22 未验证）。

## 设计审查的处理

报告在 [`evidences/`](evidences/)（`design-review-1-omp.txt`、`design-review-1-sonnet.txt`、`design-review-1-opus.txt`）。

| 条目 | 处理 |
|---|---|
| omp 1（接收者过滤不能让 `titles()` 拒绝） | 成立，改法换成上游：贡献点定义加可进清单的 `idPrefix`，内核登记时拒绝，场景 03 语义不变 |
| omp 2、Sonnet F1（作者拿不到 nb-ui 的实现与类型） | 成立，已改：SDK 加 `./components` 子路径，宿主模块表改共享它；模板与 `build-sdk.test.ts` 跑 `vue-tsc` |
| Sonnet F2（视图拿不到服务） | 成立，已改：`viewContribution`，与设置页共用包组件的函数 |
| Sonnet F3（模板没有 `.vue` 声明） | 成立，已改：`env.d.ts`、`vue-tsc` 与 `typecheck` 脚本 |
| Sonnet F4（视图与条目要 `onStartup`） | 成立，已改：模板与 focus 写明，作者文档讲取舍 |
| Sonnet F5（`sound` 没有实现路径） | 成立，已改：去掉，只留 `minutes` |
| Sonnet F6（场地没有工作台） | 成立，已改：场地加工作台替身，校验用产品的同一份函数 |
| Sonnet F7（数字开头的名字派生的 id 被拒） | 成立，改上游：清单 id 段收紧为字母开头 |
| Sonnet F8（倒计时、首次显示、重连） | 成立，已改：focus 的浏览器状态一节 |
| Sonnet F9（`finish` 与服务端权威矛盾） | 成立，已改：合同只留 `start`、`cancel`、`today` 与 `changed`，两个业务失败码 |
| Sonnet F10（作者文档缺“界面”） | 成立，已改：作者文档加“界面”，附组件与 token 清单；原子类的构建警告不做（见“不做”） |
| Sonnet F11（开发内循环） | 成立，已改：`build --dev` |
| Sonnet F12（键盘与读屏） | 成立，已改：focus 的视图交互一节 |
| Sonnet F13（dom 测试的替身） | 成立，已改：状态抽成纯 TS store，场景用真实远程，dom 测试的假接口与场景同一组断言 |
| Sonnet F14（e2e 的否定判据） | 成立，已改：肯定判据、视图内部元素、消失两步法；focus 的完成不进 e2e，验收映射如实写 |
| Sonnet F15（SDK 不发布与模板依赖、`create` 的空目录） | 成立，已改：先装 tarball 再 `create .`，`create` 合并已有 `package.json` |
| Sonnet F16（链接没固定版本） | 成立，已改：固定到构建时的提交 |
| Sonnet F17（第三方 `validate` 的理由写错） | 成立，已改理由；`idPrefix` 见 omp 1 |
| omp 3（模板把 SDK 写成 registry 版本） | 成立，同 Sonnet F15 |
| omp 4（menu 可能从未激活） | 成立，已改：menu 入口 `onStartup`，收到菜单项时记诊断，e2e 断言它 |
| omp 5（`manifestOf` 提前去重跳过后续检查） | 成立，已改：每份定义先各自检查再聚合，聚合时核对一致 |
| Opus O1（`--dev` 的预发布版本被当成降级、依赖范围不接受） | 成立，已改：构建元数据 `+dev.<秒>.<毫秒>`；实测时间戳连成 17 位数字时超过安全整数、两次构建比不出先后，所以分两段 |
| Opus O2（合并只写了顶层、`npm init` 的 `type: commonjs`） | 成立，已改：`type` 用模板的，已有 `name` 不合规时提示 `--name`；Spec 按实现写全 |
| Opus O3（服务端 user 记录要 `locality: "shared"`） | 成立，已改 |
| Opus O4（完成只靠计时器、几个服务端重复记、存储失败没有码） | 成立，已改：`settle` 结算函数、按 `startedAt` 条件保存、`storage-failed`，场景 07 加两个服务端 |
| Opus O5（空目录里 SDK 依赖写成 registry 版本） | 成立，已改：`--sdk`，registry 版本时提示；测试断言依赖写法原样保留 |
| Opus O6（Node 版本） | 成立，已改：SDK 包写 `engines.node`；Node 22 仍未实测（本机 Node 26） |
| Opus O7（`minutes` 的作品层在服务端不生效） | 成立，已改：`layers: ["user"]` |
| Opus O8（“今天”的时区与跨零点） | 成立，已改：按服务端本地时区、完成算在 `endsAt` 那天 |
| Opus O9（`.git`、`.npmrc` 被拒） | 成立，已改 |
| Opus O10（固定到本地提交的链接 404） | 成立，已改：引用的 Spec 随 SDK 包复制 |
| Opus O11（退出码没有测试、卸载数据的映射过头） | 成立，已改：`template.test.ts` 覆盖，验收映射改写 |
| Opus O12（合同取舍没进待确认清单、`./components` 推翻 t04 的“两个子路径”） | 部分成立：前几项已在清单里（`3fef27102`）；补 `--dev` 版本写法一行，t04 那一行写上被 t05 改判 |
| Opus O13（`--out` 的相对路径、参数错误的退出码） | 成立，已改：按当前目录解析，用法错误退出码 2，写进 Spec |
| Opus O14（name 缺省的转写与 Spec 不一致、id 段规则另写一份） | 成立，已改：Spec 写明转写；内核导出 `isIdSegment` |
