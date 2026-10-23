# 实施计划：第三方插件的代码装载与 SDK（S2–S3）

2026-10-17 起草；2026-10-20 按 t03 的实施结果重写；2026-10-23 按 t02 改过的设置接口（page 分区改为浏览器入口贡献 `settings.pages`、显示时按需激活）核对并更新 SDK 的导出与构建要求，待开发者确认。

## Context

t03 已经能安装第三方插件、在三个运行位置登记它们的声明，但入口代码还没有装载：有入口的插件在插件页标“部分功能暂不可用”。本 Task 让第三方插件的入口代码在服务端、项目实例与浏览器里运行，并给作者一套 SDK 与构建预设，把示例插件改成真正外置、经安装运行的插件。

依据：
- Spec：[`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（入口、`pluginVersions`、`version-mismatch`）、[`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md) 输出 8.1、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)。
- ADR：[0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)（完全信任）、[0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)（插件定义是常量、合同模块）、[0027](../../../../../docs/adr/0027-builtin-and-third-party-plugins-are-equal.md)（内置与第三方能力相同）。
- 开发者已确认：重启生效，不做热插拔（S5）；信任所有插件；示例改为外置插件作验收载体，S2 用 snippets，S3 用 clock、notes、counter（2026-10-17）；一个 Work 一条分支，本 Task 在 `feat/w00027-plugin-platform` 上做，先不合入 master（2026-10-20）。
- t03 留下的前提：第三方插件的清单在启动时读一次，服务端与项目实例只登记声明（`nbook/manifest` 的 `thirdPartyDefinition`），项目子进程经第一条 IPC 消息 `plugins` 拿到描述，浏览器经引导协议 v3 拿到描述；设计审查第 7 条（清单里的远程合同只有 id）留到本 Task 决定。

开工前已实测（2026-10-20，实验文件已删除）：
- 远程合同 `JSON.stringify` 后再交给 `defineRemoteService` 能还原，TypeBox 的 `Value.Check` 照常按还原的 schema 校验。
- Bun 1.4.2 的运行期插件 `Bun.plugin({setup(build) {build.module(id, () => ({exports, loader: "object"}))}})` 能让安装目录里的 ESM 文件 `import` 一个宿主提供的模块；同一文件加不同查询串 `import` 两次得到两份模块实例，宿主模块是同一份。
- 主页面没有设 CSP（只有原始文件路由与 HTML 预览各自设了），浏览器装载用 `new Function` 不需要放宽什么；原计划的 CSP 预检片取消。

## 关键设计

### 合同进清单：`packages/nb-runtime/src/plugin-manifest/`

远程合同带输入输出的 schema，只有 id 时宿主在激活前不知道它的版本与调用方，而内核要求激活产出的合同与声明是同一个对象（`plugins/host.ts` 的 `remote-contract-mismatch`）。做法：

- 清单顶层新增 `contracts`：合同 id → 合同的 JSON（`id`、`version`、`provider`、`callers`、`methods`、`events`，schema 就是 JSON Schema）。入口的 `remoteProvides`、`remoteDelegates` 仍写 id，每个 id 都必须在 `contracts` 里，或是 SDK 提供的内置合同（id 以 `nbook.` 开头，由宿主按 id 查）。校验规则加进 `readPluginManifest`：`contracts` 的键与值的 `id` 一致、本插件提供的合同 id 以本插件 id 为前缀、合同结构合法（复用 `defineRemoteService` 的检查，结构问题记为清单问题而不是抛错）。
- 宿主登记时用 `defineRemoteService(json)` 还原合同对象，经 `definitionOf` 已有的 `contractOf` 选项交给内核。登记不执行插件代码。
- 激活时插件代码产出的是它自己打包的那份合同对象。装载适配器（见下文）在把激活结果交给内核前，按 id 换成登记的那份，先核对版本相同，不同时激活失败、原因 `remote-contract-mismatch`。内核的同一对象检查不放宽。
- 构建预设从入口定义里的合同对象生成 `contracts`，作者不手写。

### 版本范围：内核 `plugins/` 与 `plugin-manifest/`

`pluginVersions` 在清单里已能写、已校验写法，但内核不检查。`PluginDefinition` 加可选的 `pluginVersions`，`PluginHostOptions` 加必填的范围判断函数（同 t03 的 `VersionSyntax` 注入，内核不依赖 semver）。入口的必需依赖由另一个插件提供、而提供方的版本不在范围内时，入口以 `version-mismatch` 受阻（plugin-manifest 输出 8、失败码表）。内置插件不写 `pluginVersions`，行为不变。

### SDK：`packages/neuro-book/src/sdk/` 与新包 `packages/nb-plugin-sdk/`

- 公开面放在应用里：`src/sdk/index.ts`（两端通用）与 `src/sdk/web.ts`（只在浏览器：`SettingsRow` 这类组件），`package.json` 的 `exports` 加 `./sdk`、`./sdk/web`。它们只再导出已有的实现，不写新逻辑。第一版导出示例用到的那些：
  - 内核：`defineEntry`、`defineServiceKey`、`defineRemoteService`、`provide`、`providePerConsumer`、`provideRemote`、`diagnosticsKey` 与上下文、结果类型；
  - 内置合同：设置（`settingsKey`、`defineSetting`、`displayLocale`、`SETTINGS_PAGES_POINT`、`settingsPageEvent`，类型 `SettingsService`、`SettingLayer`、`SettingsFailure`、`SettingWriteResult`、`SettingsPageDeclaration`）、存储（`storageKey`、`defineRecord`）、命令（`COMMANDS_POINT` 与类型）、状态（`defineStore`、`definePublicState`）、本地化文字（`localize`、`formatText` 与类型）；
  - 只在浏览器（`sdk/web`）：`settingsPage`（包页面组件）、`SettingsRow`、类型 `SettingsPageContext`。
  每导出一项都进入 `engines.neurobook` 的兼容范围（plugin-api 的“边界与兼容”），所以只导出示例真正用到的，迁移示例时逐项加。
- `@notnotype/nb-plugin-sdk`（`private: true`）：作者依赖的包。根入口与 `/web` 再导出 `@notnotype/neuro-book/sdk`、`/sdk/web`（类型与仓库内的场景测试用）；另有 `/build` 入口提供构建预设。插件代码里对 `@notnotype/nb-plugin-sdk`、`vue`、`@notnotype/nb-ui/components` 的导入在构建时保持外部，运行时由宿主提供同一份实例。

### 构建预设：`packages/nb-plugin-sdk/src/build/`

- `buildPlugin({root, outDir})`：读作者的 `plugin.ts`（描述加各位置的入口定义，与内置插件同一写法），用 Vite（`@vitejs/plugin-vue`）为每个入口产出单文件：
  - 服务端与项目入口：ESM，外部只有 SDK、Vue 与 Node／Bun 内置模块；
  - 浏览器入口：CommonJS，外部为宿主模块表（`vue`、`@notnotype/nb-ui/components`、`@notnotype/nb-plugin-sdk`、`@notnotype/nb-plugin-sdk/web`）；
  - 入口模块导出 `entry`：这个入口的定义（`defineEntry` 的结果）；
  - 动态导入一律内联进入口文件（例如 snippets 在 `load()` 里 `import("./SnippetsPage.vue")`）：产物每个入口只有一个文件，装载器不处理额外的分块；
  - CSS 汇总成 `style.css`；
  - `package.json`：由描述与入口定义生成清单（入口的 `main` 指向产物，`contracts` 由合同对象序列化），先用 `readPluginManifest` 校验一遍，不合格就构建失败。
- 纯度检查：构建后扫描浏览器产物，打进了 Vue、nb-ui 或 SDK 的实现就失败并指出模块名（plugin-code-loading 输出 5）。
- 复用：清单校验用 `@notnotype/nb-runtime/plugin-manifest`；内置插件的清单对齐测试（`src/builtin-manifest.test.ts`）里“定义 → 清单”的转换挪进 SDK 的构建预设，测试改为调用它，两处不各写一份。

### 启动数据：`src/backend/plugins/startup.ts`、`src/server/projects/ipc.ts`、`src/shared/browser-bootstrap.ts`

t03 只保留了描述；装载需要整份清单（入口、`main`、合同）。`StartupPlugin` 改为带 `manifest`（已校验的清单）与 `root`（版本目录），`descriptor` 由它派生。项目子进程的 `plugins` 消息与浏览器引导里的第三方插件都改带清单：浏览器引导协议升到 v4，第三方插件给出 `manifest`（只含浏览器位置需要的部分）与文件端点的基址。旧的 `thirdPartyDefinition`（只有声明）删除，三处宿主都改走下面的装载。

### 服务端与项目实例的装载：`src/backend/plugins/loader.ts`（新）

- 宿主模块：进程启动时（`prepareInstalledPlugins` 之后、装配插件之前）用 `Bun.plugin` 登记 `@notnotype/nb-plugin-sdk`、`vue` 两个运行期模块，`exports` 是宿主自己导入的那份。只登记一次；测试里多次起服务端共用。
- 定义：`definitionOf(manifest, location, {contractOf, activateFor})`。`activateFor(entry)` 返回的 `activate` 在首次激活时 `import(<版本目录>/<main>?generation=<n>)`，`n` 每次激活递增，所以入口停止后再激活总是新的模块实例（plugin-code-loading 输出 1）；取模块导出的 `entry`，核对它的 id 与位置和清单一致，调用它的 `activate`，再按上文换合同对象。
- 失败：文件缺失、语法错误、顶层抛错、导出不对都在 `activate` 里抛出，按内核的激活失败处理，只影响这个入口；原因带插件 id、入口 id 与错误码，进诊断。
- 不在登记时 `import` 任何插件文件。

### 插件文件端点：`src/server/plugin-files.ts`（新）

`GET /api/plugins/:id/files/:version/*`，作为 `server/plugins.ts` 交给 `nbook.http` 的宿主路由（同引导路由）。只服务本次启动集合里已登记的插件与它的当前版本；路径解析后必须仍在版本目录内（逐段 `lstat` 不跟链接，复用 t03 `copy.ts` 的做法），否则 400；没有这个插件、版本不是当前版本、文件不存在为 404；内容类型按扩展名；带版本号的 URL 可以长期缓存（plugin-code-loading 输出 8、副作用）。没有认证（认证尚未实现），服务端只监听回环地址，Spec 的 401 条目保留为 planned。

### 浏览器装载：`src/web/host/plugin-code.ts`（新）与 `src/web/host/window.ts`

- 宿主模块表：在根组件挂载前建立并冻结，含 `vue`、`@notnotype/nb-ui/components`、`@notnotype/nb-plugin-sdk`（`nbook/sdk`）、`@notnotype/nb-plugin-sdk/web`（`nbook/sdk/web`）。`require` 表外 id 抛结构化错误 `module-not-shared`（plugin-code-loading 输出 4）。
- `loadEntry(plugin, entry)`：`fetch` 文件端点 → `new Function("module", "exports", "require", code)` 执行一次 → 取 `module.exports.entry`。同一窗口里同一插件同一版本的同一文件只执行一次；插件的第一个入口装载时加 `<link rel="stylesheet">`（有 `style.css` 时）。窗口关闭即释放，本 Task 不做运行中注销（S5）。
- 窗口：`selectPlugins` 对第三方插件改用 `definitionOf(manifest, "browser", {activateFor})`，`activateFor` 在首次激活时装载代码。入口的贡献声明（例如 page 分区）与激活事件在清单里，窗口不执行插件代码就能列出分区；第一次显示分区时 `onSettingsPage` 触发激活，此时才取回并执行代码；装载失败只让这个入口激活失败，原位显示（`WorkbenchViewFrame` 已有错误边界，plugin-code-loading 输出 9）。
- Spec 改动：浏览器产物写成普通 CommonJS，在入口首次激活时执行一次，`require` 从模块表解析；去掉“执行时只登记工厂、首次使用时才求值”的要求。理由：入口激活就是第一次用到它的时候，再分两步不带来可观察的差别。

### 升级确认框列出受阻的依赖插件：`src/backend/plugins/inventory.ts`、插件页

t03 推迟的 plugin-install 输出 8.1 后半：`inspect` 的预览加 `blocked`：已安装、启用的第三方插件里，`pluginVersions` 不接受新版本的那些插件 id；确认框列出它们并说明重启后受阻。

### 示例迁移：`packages/neuro-book/examples/`

- snippets（S2：设置项、page 分区、浏览器代码）、clock、notes、counter（S3：服务端与项目入口、远程服务、命令、存储、公开状态）改为只从 `@notnotype/nb-plugin-sdk` 导入，各加构建脚本，产物到 `dist/`（git 忽略）。
- 进程内场景测试保留（经 SDK 的再导出照常跑）；另加“构建 → 安装 → 重启 → 使用”的 smoke。
- menu、file-menu 留给 t05。

## Spec 与文档改动

- `runtime/plugin-manifest.md`：输入表加 `contracts`；“清单无效”条件加合同相关的几条；去掉清单字段、`version-mismatch` 相关的 planned 标记。
- `runtime/plugin-code-loading.md`：浏览器产物改为普通 CommonJS；服务端产物外部化 SDK 与 Vue、由宿主以运行期模块提供；宿主模块表加 `@notnotype/nb-plugin-sdk/web`；端点的 401 标 planned（认证未实现）。
- `runtime/plugin-api.md`：SDK 的组成（应用的公开面加作者包）、`entry` 导出约定。
- `runtime/browser-host.md`：引导协议 v4 带第三方插件的清单。
- `runtime/plugin-install.md`：输出 8.1 的依赖插件列表随实现去掉 planned。
- `packages/nb-plugin-sdk/README.md`：只写装、构建与产物的形状，作者文档在 t05。

## 切片

| 片 | 内容 | 关键设计 | 提交边界与自跑验证 |
|---|---|---|---|
| S2a | 合同进清单、版本范围 | 合同进清单；版本范围 | 内核 `bun test`、typecheck |
| S2b | SDK 公开面与作者包 | SDK | 应用与 SDK typecheck；示例改导入后场景测试照常 |
| S2c | 构建预设与纯度检查 | 构建预设 | 构建一个样例目录，产物经 `readPluginManifest`；纯度检查能拦下打包 Vue |
| S2d | 启动数据带清单、文件端点 | 启动数据；文件端点 | `src/backend/plugins` 与端点的真实请求测试 |
| S2e | 浏览器装载与窗口接入，snippets 外置 | 浏览器装载；示例迁移 | Vitest；e2e：安装 snippets 构建产物 → 重启 → 设置页出现并可用 |
| S3a | 服务端与项目实例装载 | 服务端装载 | 真实进程测试：新代次新实例、装载失败只影响该入口 |
| S3b | clock、notes、counter 外置，升级确认框列出受阻依赖 | 示例迁移；升级确认 | e2e：浏览器经远程服务调用服务端入口、命令可执行；安装 → 使用 → 禁用 → 重启消失 |

每片一个提交，在 Work 分支上做；实现审查在 S2e 与 S3b 之后各一轮（后端交 omp，界面交 Sonnet）。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| plugin-code-loading 输出 1，验收 6 | S3a 真实进程测试（顶层计数在新代次从初始值开始） |
| plugin-code-loading 输出 2、3，验收 1 | S2e e2e（插件组件点击更新、主题与语言取自宿主、nb-ui 浮层） |
| plugin-code-loading 输出 4，验收 3 | 模块表单元测试；e2e 里一个 `require('lodash')` 的样例入口激活失败、其它正常 |
| plugin-code-loading 输出 5，验收 2 | S2c 构建测试 |
| plugin-code-loading 输出 8，验收 8（400、404） | S2d 端点测试 |
| plugin-code-loading 输出 9，验收 9 | e2e：样例视图渲染时抛错只影响它 |
| plugin-manifest 输出 8 与 `version-mismatch` | S2a 内核测试 |
| plugin-manifest 输入 `contracts` 与清单无效条件 | S2a 表驱动测试；内置插件对齐测试照常通过 |
| plugin-install 输出 8.1（受阻依赖） | S3b 后端测试与插件页组件测试 |
| browser-host 第三方入口接入 | S2e、S3b e2e |

## 验证

- 每片自跑上表的命令；全部完成后跑内核与应用的 `bun test`、Vitest、两包 typecheck、`docs:check`、`governance:check`，以及 plugins、settings、browser-host、rpc 几组 e2e（直接跑 Playwright 前先 `build`、`build:e2e`）。
- 端到端：在 Work 分支上构建四个示例 → 经插件页安装 → 重启开发服务 → 工作台里用它们（设置项、视图、命令、远程服务）→ 禁用 → 重启后消失。截图看插件视图与宿主的主题、浮层一致。
- 留下的未验证边界：代码回收（plugin-code-loading 输出 6、7）本 Task 不做运行中注销，不验证；Electron、WebKitGTK 上的装载不跑（没有桌面端）。

## 不做与风险

- 不做：运行中启用、禁用与注销（S5）；代码回收的证明；worker 池、作用域定时器、`ctx.diagnostics`、`ctx.plugin` 等 plugin-api 里仍为 planned 的上下文成员；文件端点的认证；SDK 的正式发布；menu、file-menu 的迁移与脚手架（t05）。
- 风险：
  - Bun 的运行期模块与查询串新实例是未文档化的行为，升级 Bun 时回归 S3a 的测试。
  - 宿主模块表让 Vue、nb-ui 失去 tree-shaking：记录构建体积的前后差。
  - SDK 公开面一旦导出就是兼容承诺；示例用到的内部模块（例如 `SettingsRow`）进 SDK 前要确认它可以对外承诺，不能承诺的改示例写法。
  - 插件之间的合同模块：第三方消费方把提供方的合同模块打进自己的产物，按 id 与版本匹配；提供方改合同时消费方要重新构建，这由合同版本表达。
