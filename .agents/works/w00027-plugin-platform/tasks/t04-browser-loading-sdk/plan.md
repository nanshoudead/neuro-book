# 实施计划：第三方插件的代码装载与 SDK（S2–S3）

2026-10-17 起草；2026-10-20 按 t03 的实施结果重写；2026-10-23 按 t02 改过的设置接口更新，再按深入设计审查（omp、Claude Opus、Claude Sonnet，见文末“设计审查的处理”）修订。开发者 2026-10-23 定 t04、t05 自主推进：计划不再停下等确认，取舍记进 Work 的待确认清单。

## Context

t03 已经能安装第三方插件、在三个运行位置登记它们的声明，但入口代码还没有装载：有入口的插件在插件页标“部分功能暂不可用”。本 Task 让第三方插件的入口代码在服务端、项目实例与浏览器里运行，并给作者一套 SDK 与构建预设，把示例插件改成真正外置、经安装运行的插件。

依据：
- Spec：[`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（入口、`pluginVersions`、`version-mismatch`）、[`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md) 输出 8.1、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)（`/api/runtime/` 宿主路由）。
- ADR：[0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)（完全信任）、[0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)（插件定义是常量、合同模块）、[0027](../../../../../docs/adr/0027-builtin-and-third-party-plugins-are-equal.md)（内置与第三方能力相同）。
- 开发者已确认：重启生效，不做热插拔（S5）；信任所有插件；示例改为外置插件作验收载体，S2 用 snippets，S3 用 clock、notes、counter（2026-10-17）；一个 Work 一条分支，本 Task 在 `feat/w00027-plugin-platform` 上做；SDK 暂不发布到 npm。
- t03 留下的前提：第三方插件的清单在启动时读一次（服务端内存里的启动快照，项目子进程与窗口都取这一份），服务端与项目实例只登记声明（`nbook/manifest` 的 `thirdPartyDefinition`），项目子进程经第一条 IPC 消息 `plugins` 拿到描述，浏览器经引导协议 v3 拿到描述。

已实测（2026-10-20 主会话；2026-10-23 审查者在 Bun 1.4.2、Vite 8.1.4、typebox 1.3.6 上复核）：
- 远程合同的普通 schema 经 JSON 往返后 `Value.Check` 一致；`Type.Refine`、自定义 format、Codec 会丢。
- `Bun.plugin` 的 `build.module(id, () => ({exports, loader: "object"}))` 让安装目录里的 ESM 能 `import` 宿主那一份模块（普通进程与 `bun test` 都生效）。固定路径 `import` → `delete require.cache[路径]` → 再 `import` 得到新实例，旧实例可回收（400 次 RSS 增长 0.2MB）；加查询串也得到新实例，但旧实例不回收（400 次 835MB）。
- 宿主那份 `@vue/reactivity` 与插件打包的另一份互不可见：`computed` 不更新、`watch` 不触发、不报错。
- Vite 8（Rolldown）的多入口构建不能同时关掉代码分割，单文件产物要每个入口各构建一次。
- 主页面没有 CSP。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 插件产物构建 | Vite 8 库模式（仓库已有）+ `@vitejs/plugin-vue` | 与宿主同一套工具链，处理 `.vue`、CSS 与 source map；否决 esbuild、`bun build`（不编译 `.vue`） |
| 构建期执行作者的入口定义（生成清单） | Vite 的 `runnerImport` | 能加载 `.vue`、TS 与作者的别名，与产物构建共享插件配置；否决直接用 Bun 或 Node `import`（`.vue` 静态导入失败、Node 不剥离 `node_modules` 下的 `.ts`） |
| SDK 的类型产物 | `rolldown-plugin-dts` 0.27.14（Vue 用 `vue-tsc`，仓库已有；0.28 起要 rolldown 1.2，Vite 8.1 用的是 1.1，钉在能与它共用的版本） | 与 Vite 8 的 Rolldown 同源，按 tsconfig 解析 `nbook/*` 别名，把类型打平成自包含的 `.d.ts`；否决 API Extractor（要先 `tsc` 出声明，不解析路径别名）、手写声明文件（会与实现分叉）。S2b 开头先做一次最小打包确认它处理 `.vue` 的类型，不行再退到“`vue-tsc` 出声明 + `rolldown-plugin-dts` 只打平” |
| 插件用到的图标 | `@iconify/utils` 的 `getIconCSS` + `@iconify-json/lucide`（仓库已有） | 与宿主 `@iconify/tailwind4` 同一份图标数据，生成的规则与宿主的类名一致；否决运行时按名取图标（要把整套图标数据发到浏览器） |
| 版本范围判断 | `semver`（t03 已用） | 应用里只留一个 `satisfies`，内核注入与升级预览都调它 |

## 关键设计

### 合同进清单：内核 `packages/nb-runtime/src/plugin-manifest/`、`remote/`

远程合同带输入输出的 schema；只有 id 时宿主在激活前不知道它的版本与调用方，而内核要求激活产出的合同与声明是同一个对象（`plugins/host.ts` 的 `remote-contract-mismatch`）。

- 清单顶层新增 `contracts`：合同 id → 合同的 JSON（`id`、`version`、`provider`、`callers`、`methods`、`events`，schema 是 JSON Schema）。入口的 `remoteProvides`、`remoteDelegates` 仍写 id，每个 id 都必须在 `contracts` 里，或是 SDK 提供的内置合同（id 以 `nbook.` 开头）。
- `readPluginManifest` 校验：先用一份 TypeBox schema 校验合同 JSON 的形状（`methods`、`events`、`callers` 的类型），再交 `defineRemoteService`；每个 schema 预检一次（`type` 取值在 JSON Schema 类型表里、`Value.Check(schema, undefined)` 不抛出），失败记为 `contracts.<id>.methods.<名>.input` 这样的清单问题，不抛普通异常。键与值的 `id` 一致、本插件提供的合同 id 以本插件 id 为前缀。
- 远程合同的 schema 必须是纯 JSON Schema：构建预设生成 `contracts` 时遇到 `Refine`、`Codec`、不在 typebox 内置表里的 `format`，构建失败并指出合同与方法（Spec 写明）。这样提供方用清单还原的那份校验，与内置插件用代码里那份校验结果相同。
- 宿主登记时用 `defineRemoteService(json)` 还原合同对象，经 `definitionOf` 已有的 `contractOf` 交给内核；登记不执行插件代码。
- 激活后插件代码产出的是它自己打包的那份合同对象。装载适配器比较两份的完整规范化 JSON（`provider`、`callers`、方法与事件、`effect`、错误码、schema，键排序后序列化）：相同时换成登记的那份交给内核；不同时不抛错，原样把插件那份交给内核，由内核的同一对象检查以 `remote-contract-mismatch` 拒绝。适配器不自己抛错：已经取得的激活产出带着释放责任，抛错会让内核拿不到它、释放不执行。内核的同一对象检查不放宽。消费方照旧用自己打包的那份合同，不按 id 换成提供方的。
- 内核 `remote/protocol.ts` 的 `validationProblems` 调用处包一层：`Value.Check` 抛错时回 `invalid-input`（入参）或 `provider-error`（返回值）并记诊断。这是现有缺口，内置插件的 schema 同样会触发；同实例调用与项目子进程收到的请求现在是裸 `void`，抛错会成为未处理的 rejection。
- **第三方拥有的贡献点**：`ContributionPointDefinition` 加可选的 `schema`（TypeBox，纯 JSON Schema）；内核在 `validate` 之前先按 `schema` 核对声明，两者都有时都要通过。清单的 `contributionPoints[]` 加 `schema` 字段，宿主登记时由它生成校验，拥有者未激活时就能拒绝不合格的贡献（plugin-manifest 的贡献点条目、ADR 0027）。只写了 `validate` 函数、没写 `schema` 的贡献点，构建预设拒绝外置（函数不能进清单）。内置插件不变。
- “定义 → 清单”的转换从应用的 `src/builtin-manifest.test.ts` 挪进内核，与反方向的 `definitionOf` 放在一起（`manifestOf(descriptor, definitions)`）；对齐测试与构建预设都调它，不经 SDK。

### 版本范围：内核 `plugins/`

`pluginVersions` 在清单里已能写、已校验写法，但内核不检查，内核里也没有插件版本。

- `PluginDefinition` 加可选的 `version` 与 `pluginVersions`；`definitionAt` 从描述并入 `version`，第三方的 `definitionOf` 带上两项；内置插件不写 `pluginVersions`。
- `PluginHostOptions` 加可选的范围判断函数 `satisfies(version, range)`；登记的定义里出现 `pluginVersions` 而宿主没注入时登记失败。应用只有一个 `satisfies`（固定 semver 选项），三处宿主注入它。
- 判定：入口的必需依赖由另一个插件提供、而提供方的版本不在范围内时，入口以 `version-mismatch` 受阻（plugin-manifest 输出 8、失败码表）；可选依赖遇到版本不符按不可用处理（不注入，记诊断 `version-mismatch`），入口不受阻。只有第三方插件写 `pluginVersions`，提供方可以是内置插件。
- 远程合同不构成依赖，`pluginVersions` 不约束远程调用（版本由合同版本表达）。

### 启动不被第三方入口挂住：内核 `application/bootstrap.ts`

启动时内核对全部 `onStartup` 入口 `Promise.all` 等待，没有期限（`bootstrap.ts` 约 237–251 行）。第三方入口的 `activate` 或模块顶层只要不结算，整个服务端或项目实例就起不来。

- 应用清单加一项“不计入启动结算的插件”（第三方插件全部列入）：它们的 `onStartup` 入口照常在启动时触发激活，但启动结算不等它们；激活结果照常进诊断与插件状态。
- 内置插件不变。激活本身的超时不在本 Task（内置插件同样没有）。

### SDK：应用的 `src/sdk/` 与它生成的 `@notnotype/nb-plugin-sdk`

SDK 按 plugin-api 的定义“只含类型与少量纯函数，不依赖宿主内部模块；内置插件的合同模块由 SDK 提供”。这个形状由应用生成，不另建一个依赖应用源码的工作区包（那样既成环，仓库外又解析不了应用的 `nbook/*` 别名）。做法与 VS Code、Obsidian 相同：作者依赖的包提供类型与构建工具，运行时的实现由宿主经模块表提供。

- **公开面**：`packages/neuro-book/src/sdk/index.ts`（各运行位置通用）与 `src/sdk/browser.ts`（要 Vue 或 DOM 的），只再导出已有实现，不写新逻辑。子路径用运行位置的名字 `browser`，不用宿主源码的目录名 `web`。第一版的导出：
  - 内核：`defineEntry`、`defineServiceKey`、`defineRemoteService`、`provide`、`providePerConsumer`、`provideRemote`、`diagnosticsKey` 与上下文、结果类型，以及示例用到的类型（`PluginDefinition`、`PluginDescriptor`、`ServiceKey`、`RemoteResult`、`RemoteSink` 等，导出时逐项与值成对核对）；
  - 宿主能力：`clockKey`（类型 `RuntimeClock`）、`stateRootKey`；窗口导航、救援这类偏内部的不导出；
  - 内置合同：设置（`settingsKey`、`defineSetting`、`displayLocale`、`SETTINGS_PAGES_POINT`、`settingsPageEvent` 与类型）、存储（`storageKey`、`defineRecord`、`RecordHandle`）、命令（`COMMANDS_POINT` 与类型）、状态（`defineStore`、`definePublicState`）、本地化文字（`localize`、`formatText`、`DisplayLocale`、`LocalizedText`）；
  - `browser`：`settingsPage`，设置窗口给页面用的四个组件 `SettingsRow`、`SettingsPageList`、`SettingsPageActions`、`SettingsSaveBar`（settings-window 的“给页面用的组件”已承诺给插件），类型 `SettingsPageContext`。

  每导出一项都进入 `engines.neurobook` 的兼容范围；导出面由快照测试钉住（下文），增删要显式更新快照。
- **page 分区的组合助手**：`settingsPageContribution({id, declaration, load, props})` 一次产出贡献声明、激活事件与实现，声明按 `SettingsPageDeclaration` 类型化。原来作者要在三处写同一个分区 id 并手拼 `{capability, id, declaration}`（`declaration` 是 `unknown`，写错字段要到运行时才静默丢掉）。snippets 改用它。
- **实施记录（S2b）**：page 分区助手放在 `nbook.settings` 的 `web/page-contribution.ts`（`ui/` 不能引用插件），SDK 的 `browser` 再导出它。类型打包时，内核与 nb-form 的子路径要映射到源码：经 `node_modules` 解析到的工作区包被 TypeScript 当作外部库，不生成声明，打包器就找不到导出。构建期实现把 nb-ui 打进 `browser.js`（只在作者构建时执行），作者因此不必为了构建再装 nb-ui。
- **仓库内**：应用的 tsconfig、Vite 与 Bun 都把 `@notnotype/nb-plugin-sdk`、`@notnotype/nb-plugin-sdk/browser` 解析到 `src/sdk/`（与 `nbook/*` 同一机制），示例与场景测试只从这两个名字导入。不新增工作区包，应用不依赖自己的 SDK 包，没有环。`src/architecture.test.ts` 对示例的导入规则改为只放行 SDK、`vue`、`@vue/reactivity`、`typebox` 与 nb-ui 的共享入口（场景测试与测试场地另有放行）。
- **生成的产物**：应用脚本 `build:sdk` 产出 `packages/neuro-book/dist/plugin-sdk/`，是一个可以 `bun add <目录>` 安装的包 `@notnotype/nb-plugin-sdk`：
  - `index.js`、`browser.js`：打包后的实现，`vue`、`@vue/reactivity`、`typebox`、`@notnotype/nb-ui/components` 保持外部；只在构建期执行作者的入口定义、以及仓库外写测试时用，插件运行时用宿主那一份；
  - `index.d.ts`、`browser.d.ts`：打平的类型，不含 `nbook/*` 别名；
  - `build.js`：构建预设；
  - `package.json`：版本取产品版本，`peerDependencies` 写 `vue`、`typebox` 的范围，`dependencies` 写构建预设要的 `vite`、`@vitejs/plugin-vue`、`@iconify/utils`、`@iconify-json/lucide`。

  验收：在仓库外临时目录用普通 tsconfig 对一个只导入 SDK 的文件跑 `tsc --noEmit` 通过。nb-ui 组件的类型由作者另装 nb-ui（本地路径），写进 t05 的作者文档。
- **导出面快照**：测试列出 `src/sdk/index.ts`、`browser.ts` 的运行时导出名与生成的 `.d.ts` 的导出名，与仓库里的快照比较。

### 构建预设：`packages/neuro-book/scripts/plugin-sdk/`

构建工具放在 `scripts/` 而不是 `src/`：它们用 Vite，而应用源码里只有开发监督进程能引用 Vite（架构测试）；`build:sdk` 把它们打进生成的 SDK 包（S2b 实施时改，原写 `src/sdk/build/`）。

`buildPlugin({root, outDir})` 读作者目录：

- **作者合同**：`package.json` 给 `publisher`、`name`、`version`、`description`、`license`、`engines.neurobook`（缺省取 SDK 版本的兼容范围）、`pluginVersions`；`plugin.ts` 导出插件描述 `descriptor`（id 与版本必须与 `package.json` 一致）；`definitions` 列出入口定义模块（缺省 `backend/plugin.ts`、`web/plugin.ts`，存在才读），每个模块导出一个或多个 `PluginDefinition`，id 必须与描述一致。入口 id 在各运行位置之间唯一。
- **生成清单**：用 Vite 的 `runnerImport` 执行描述与定义模块（只读声明，不调用 `activate`），交内核的 `manifestOf` 生成入口、贡献、`contracts`，合并 `package.json` 的字段后用 `readPluginManifest` 校验一遍，不合格就构建失败。入口定义模块的顶层副作用会在构建期执行一次，作者文档写明。
- **产物**：每个入口单独构建一次，各出一个文件；产物只导出 `activate`（由预设生成的外壳从定义里取出），声明以清单为准，装载时不再核对产物里的声明。
  - 服务端与项目入口：ESM；
  - 浏览器入口：包成登记工厂（plugin-code-loading 输出 2，G1 验证过的做法）：脚本执行时调用宿主的 `register(脚本 URL, factory)`，`factory(module, exports, require)` 才是 CommonJS 模块体；
  - 动态导入一律内联（例如 snippets 在 `load()` 里 `import("./SnippetsPage.vue")`）；
  - 带 source map，随产物进安装目录。
- **共享模块**：`vue`、`@vue/reactivity`、`@notnotype/nb-ui/components` 与 SDK 两个入口保持外部；`@vue/runtime-core`、`@vue/runtime-dom` 别名到 `vue`。外部判定按导入说明符，所以 nb-form 这类自身依赖 `@notnotype/nb-ui/components` 的包可以打进插件、它对 nb-ui 的导入仍是外部。
- **纯度检查**：用 Rolldown 输出块的模块列表判定，服务端与浏览器产物都查：打进了 `vue`、`@vue/*`、nb-ui 或 SDK 的实现就失败并指出模块名；外部引用不在宿主模块表里也失败，错误信息写明“该入口未共享”。
- **样式**：各入口的 CSS 合并去重成一个文件，包进 `@layer components`（与宿主组件样式同层，原子类仍能覆盖插件组件）。清单顶层加 `style`（相对路径，规则同 `main`），有 CSS 时写。
- **图标**：扫描插件源码里的 `i-<图标集>-<名字>` 字面量（入口定义里的 `icon` 字段、模板里的类名），用 `@iconify/utils` 生成同名规则写进样式。插件不能依赖宿主的原子类：宿主只为自己源码里出现过的类名生成规则，插件用到的原子类有没有效果全凭巧合（Spec 写明）。

### 启动数据：`src/backend/plugins/startup.ts`、`src/server/projects/ipc.ts`、`src/shared/browser-bootstrap.ts`

t03 只保留了描述；装载需要整份清单（入口、`main`、合同、样式）。

- `StartupPlugin` 改为带 `manifest`（已校验的清单）、`root`（版本目录）与 `digest`（版本目录全部文件的内容摘要，启动时算一次），`descriptor` 由清单派生。
- 项目子进程的 `plugins` 消息与浏览器引导里的第三方插件都改带清单；浏览器引导协议升到 v4，第三方插件给出浏览器位置需要的那部分清单与文件 URL 的前缀；引导的 `revision` 并入各插件的 `digest`，同版本重装后窗口能察觉。
- 三处宿主共用一个函数 `thirdPartyDefinitionAt(location, startupPlugin, options)` = `definitionAt(location, descriptorOf(manifest), definitionOf(manifest, location, options))`，顶层声明式贡献（例如 snippets 的配置项）照旧在三个位置登记；旧的 `thirdPartyDefinition` 删除。

### 运行中的版本不被别的进程回收：`src/backend/plugins/startup.ts`、`pins.ts`（新）

同一状态根可以同时跑几个服务端（`runtime/projects.md`）。现在一个服务端启动时会切换待生效的版本、回收不再登记的版本目录，并删掉已卸载插件的目录（`startup.ts` 的 `applyPending`、`reclaim`）。t03 时没有问题：入口代码从不读取。t04 之后，正在运行的服务端 A 要按需装载入口、经文件端点给窗口送代码；另一个服务端 B 重启时删掉 A 正在用的版本目录，A 的下一次激活就会遇到 `ERR_MODULE_NOT_FOUND`（审查者用两个真实进程复现）。

- **租约**：每个服务端在启动集合定下后，在 `<State Root>/plugins/.pins/<随机名>/` 写一份它在用的 `插件 id@版本` 列表，并对这个目录持一把进程寿命的 proper-lockfile 锁（与登记表同一套，锁按间隔刷新 mtime，进程退出时释放，崩溃后 `LOCK_STALE_MS` 过去即视为残留）。项目子进程由同一个服务端启动，用的也是它的这份集合。
- **回收**：`reclaim` 删除版本目录前，以及 `applyPending` 删除已卸载插件的目录前，都先读全部租约：锁还活着的租约里列出的版本不删，留到下一次启动再看；残留的租约连同目录一起清掉。登记表照常切换，只是推迟删文件。
- **测试**：两个真实进程：A 启动后 B 消费升级与卸载并退出，A 照常首次激活、新开项目实例、取旧版本的文件；A 退出、锁过期后，再启动一次才回收。

### 服务端与项目实例的装载：`src/backend/plugins/loader.ts`（新）

- **宿主模块**：进程启动时（`prepareInstalledPlugins` 之后、装配插件之前）用 `Bun.plugin` 登记 `@notnotype/nb-plugin-sdk`、`vue`、`@vue/reactivity`，`exports` 是宿主自己导入的那一份。进程里只登记一次（再次登记会静默替换 exports）。
- **装载**：`activateFor(entry)` 返回的 `activate` 每次被调用时：按版本目录前缀删除 `require.cache` 里该插件的条目，再用不带查询串的固定路径 `import(<版本目录>/<main>)`，所以每次激活都是新的模块实例（plugin-code-loading 输出 1），旧实例在宿主不再引用后可回收；取模块导出的 `activate` 调用，再按上文核对并替换合同对象。
- **失败**：文件缺失、语法错误、顶层抛错、没有导出 `activate` 都在 `activate` 里抛出，按内核的激活失败处理，只影响这个入口；原因带插件 id、入口 id 与错误码，进诊断。
- 登记时不 `import` 任何插件文件。

### 插件文件端点：`src/server/plugin-files.ts`（新）

- **路径**：`GET /api/runtime/plugins/<插件 id>/files/<摘要>/<文件路径>`，作为 `server/plugins.ts` 交给 `nbook.http` 的宿主路由，挂在 `/api/runtime/` 下（同引导路由，分发器不改）。
- **解析**：按原始 `pathname` 的 `/` 切段、逐段解码；解码后的段含 `/`、`\`、`\0`，或等于 `.`、`..`、空串时 400；再逐段 `lstat` 不跟链接，复用 t03 `copy.ts` 的做法。明文 `..` 在到达处理器前已被 URL 规范化，测试用 `..%2F`、`%5C`、`%00` 断言 400，用明文 `..` 断言拿不到版本目录外的文件。
- **结果**：只服务本次启动集合里已登记的插件；摘要不是当前摘要、文件不存在为 404；内容类型按扩展名。
- **缓存**：URL 带内容摘要，可以长期缓存（`immutable`）；同版本重装后摘要变了，旧 URL 返回 404，不会执行旧代码。
- **响应头**：统一加 `Cross-Origin-Resource-Policy: same-origin` 与 `X-Content-Type-Options: nosniff`，挡住别的网页用 `<script>` 跨源探测装了哪些插件。没有认证（尚未实现），服务端只监听回环地址并核对 `Host`，Spec 的 401 条目保留为 planned。

### 浏览器装载：`src/web/host/plugin-code.ts`（新）与 `src/web/host/window.ts`

- **宿主模块表**：在根组件挂载前建立并冻结（命名空间对象先复制再冻结），含 `vue`、`@vue/reactivity`、`@notnotype/nb-ui/components`、`@notnotype/nb-plugin-sdk`、`@notnotype/nb-plugin-sdk/browser`。`require` 表外 id 抛结构化错误 `module-not-shared`（plugin-code-loading 输出 4）。单元测试用身份探针核对：`require("vue")` 是宿主那一份，`require("@notnotype/nb-ui/components").Button` 是宿主的 `Button`。
- **代码**：入口首次激活时，同一窗口里同一文件只插入一次 `<script src>`（同源，真实文件名与 source map 照常，不需要 `unsafe-eval`），脚本执行时登记工厂；每次激活都调用一次工厂，得到新的模块实例，与服务端规则一致（重试、依赖恢复后的再激活不带上一代的顶层状态）。只缓存登记成功的工厂；失败的下次重试重新插入脚本。
- **失败**：结构化原因 `code-load-failed`（脚本加载出错或 30 秒未登记，带 URL）、`code-shape`（脚本执行了但没有登记，或工厂没导出 `activate`）、`code-threw`（工厂或 `activate` 抛出）、`module-not-shared`，都带插件 id、入口 id 与文件 URL；入口激活失败，原位显示并可重试（设置窗口的 `entry-failed`、`WorkbenchViewFrame` 已有错误边界，plugin-code-loading 输出 9）。
- **样式**：窗口登记一个有 `style` 的第三方插件时就插入它的样式表，不等入口激活：分区的图标在激活前就要显示。样式加载失败记一条诊断（带插件 id 与 URL），不让入口失败。
- **窗口**：`selectPlugins` 对第三方插件改用上文的 `thirdPartyDefinitionAt`，`activateFor` 在激活时装载代码。入口的贡献声明（例如 page 分区）与激活事件在清单里，窗口不执行插件代码就能列出分区；第一次显示分区时 `onSettingsPage` 触发激活，此时才取回并执行代码。窗口关闭即释放，本 Task 不做运行中注销（S5）。

### 升级确认框列出受阻的插件：`src/backend/plugins/inventory.ts`、插件页

t03 推迟的 plugin-install 输出 8.1 后半。

- 预览用内核的受阻推导，不自己扫 `pluginVersions`：取“重启后生效的集合”（登记表加待生效的变更：待禁用、待卸载的不算，有待切换版本的取那个版本的清单），把升级对象换成新版本，用同一份推导与同一个 `satisfies` 算出新增的受阻入口，包括经必需依赖传递受阻的。为此 `inspect` 要读其它已安装插件当前版本的清单；某个读不出来时那个插件不参与推导，预览带一条说明，不让预览失败。
- `blocked` 的元素：`{plugin, entries, reason: "version-mismatch" | "provider-blocked", range?}`。
- 确认框在降级警告的位置用同一种警告样式列出“这些插件的这些入口重启后不可用”与要求的范围，“确认”照常可点（只是说明）；`data-*` 钩子供 e2e 断言，中英文案一起加。

### `entries-not-loaded` 收尾

入口都能装载以后，t03 的 `entries-not-loaded` 码、启动警告 `plugins.startup.not-loaded`、插件页的“部分功能暂不可用”徽标与它们的夹具、测试一并删除。插件页显示各入口的激活状态（plugin-manifest 输出 6 的后半）不在本 Task，记进 Work 的后续事项。

### 示例迁移：`packages/neuro-book/examples/`

- snippets（S2：设置项、page 分区、浏览器代码）、clock、notes、counter（S3：服务端与项目入口、远程服务、命令、存储、公开状态）只从 `@notnotype/nb-plugin-sdk`（与 `/browser`）、`vue`、`@vue/reactivity`、`typebox`、nb-ui 的共享入口导入，各有构建脚本，产物到 `dist/`（git 忽略）。示例在仓库内的导入解析见上文“SDK”。
- clock 改为依赖产品的宿主能力 `clockKey`（`nbook/clock`，与示例原来的 `HostClock` 形状相同），外置后在真实服务端里能激活；场景 01 里“宿主不给某项能力时依赖它的入口受阻”改用测试里一次性的能力键演示。
- 进程内场景测试保留；另加“构建 → 安装 → 重启 → 使用”的 e2e。
- e2e 的失败样例（取回失败、语法错误、顶层抛错、没有 `activate`、`require` 表外模块）由一个脚本生成到 e2e 夹具目录，不进示例。
- menu、file-menu 留给 t05。

## Spec 与文档改动

- `runtime/plugin-manifest.md`：输入表加 `contracts`、`style`；“清单无效”条件加合同的几条；远程合同只能用纯 JSON Schema；`version-mismatch` 的可选依赖规则；去掉相关的 planned 标记。
- `runtime/plugin-code-loading.md`：浏览器产物是登记工厂，每次激活调用一次工厂；宿主模块表加 `@vue/reactivity` 与 SDK 的 `browser`；服务端产物外部化 SDK 与 Vue，由宿主以运行期模块提供，每次激活前删除模块缓存再装载；文件端点的路径、摘要、响应头与解析规则，401 标 planned；样式在窗口登记插件时加载、包进 `@layer components`；插件不能依赖宿主的原子类，图标由构建预设生成；浏览器装载的失败原因表；验收 8 改用编码形式的路径。
- `runtime/plugin-api.md`：SDK 的组成（应用的公开面、生成的包、构建预设）与作者合同；`browser` 子路径；产物只导出 `activate`。
- `runtime/browser-host.md`：引导协议 v4 带第三方插件的清单与摘要。
- `runtime/application.md`（或 `lifecycle.md`，以登记启动结算的那份为准）：不计入启动结算的插件。
- `runtime/plugin-install.md`：输出 8.1 的受阻列表随实现去掉 planned，写明 `blocked` 的形状；“副作用与数据”加运行版本的租约：别的服务端仍在用的版本目录与已卸载插件的目录推迟到下一次启动回收。
- `docs/modules/monorepo-boundaries.md`：SDK 由应用生成、仓库内经别名解析，不是工作区包。
- `examples/README.md`：示例改为外置插件后的阅读顺序与运行方式；作者文档在 t05。

## 切片

| 片 | 内容 | 关键设计 | 提交边界与自跑验证 |
|---|---|---|---|
| S2a | 合同进清单、贡献点 schema、`manifestOf`、版本范围、`validationProblems` 的缺口、启动不等第三方 | 合同进清单；版本范围；启动 | 内核 `bun test`（含：清单与代码合同不一致时内核拒绝且释放执行一次；第三方拥有者未激活时按 schema 拒绝不合格贡献）；应用 typecheck 与 `builtin-manifest.test.ts`（改调 `manifestOf`） |
| S2b | SDK 公开面、仓库内别名、page 分区助手、四个页面组件、宿主能力、clock 改 `clockKey`、导出面快照、`build:sdk` 产物 | SDK；示例迁移（导入） | 应用 typecheck；场景与组件测试照常；仓库外 `tsc --noEmit` |
| S2c | 构建预设：作者合同、清单生成、逐入口构建、登记工厂、共享模块与纯度检查、样式与图标 | 构建预设 | 构建 snippets 与一个顶层静态导入 `.vue` 的样例；纯度检查的反例（打包 Vue、`@vue/reactivity`、未共享的 nb-ui 入口、SDK）与正例（打包 typebox） |
| S2d | 启动数据带清单与摘要、`thirdPartyDefinitionAt`、运行版本的租约、文件端点 | 启动数据；租约；文件端点 | `src/backend/plugins` 测试；两个真实进程的租约测试；端点的真实请求测试（编码穿越、摘要不符、响应头、同版本重装后旧 URL 404） |
| S2e | 浏览器装载、窗口接入、snippets 外置 | 浏览器装载；示例迁移 | Vitest（模块表身份探针）；e2e 见验收映射 |
| S3a | 服务端与项目实例装载 | 服务端装载 | 真实进程测试：再激活是新实例、装载失败只影响该入口、顶层挂起不挡启动 |
| S3b | clock、notes、counter 外置，升级确认框，`entries-not-loaded` 收尾 | 示例迁移；升级确认；收尾 | 真实进程测试：counter 外置后公开键随计数变化；后端与插件页组件测试；e2e 见验收映射 |

每片一个提交，在 Work 分支上做。实现审查在 S2e 与 S3b 之后各一轮，按深入审查：后端交 omp 与 Claude Opus，界面与 SDK 的接口形状交 Claude Sonnet。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| plugin-code-loading 输出 1，验收 6 | S3a 真实进程测试（顶层计数在再激活时从初始值开始） |
| plugin-code-loading 输出 2、3，验收 1 | S2e e2e（产品构建与开发会话各一次：设置页出现并可改值、插件组件跟随宿主的主题与语言、nb-ui 浮层）；开发会话下模块表身份探针冒烟 |
| plugin-code-loading 输出 2（按需） | S2e e2e：窗口启动后、打开分区之前对插件文件 URL 的请求数为 0；打开后恰好一次；关闭再打开不再取 |
| plugin-code-loading 输出 4，验收 3 | 模块表单元测试；e2e 失败样例 `require` 表外模块 |
| plugin-code-loading 输出 5，验收 2 | S2c 构建测试（反例与正例） |
| plugin-code-loading 输出 8，验收 8 | S2d 端点测试 |
| plugin-code-loading 输出 9，验收 9 | e2e 失败样例：取回失败、语法错误、顶层抛错、没有 `activate`，设置窗口原位显示原因、重试后恢复；页面渲染抛错走 `SettingsPageFrame` 的渲染错误路径 |
| plugin-code-loading 样式与图标 | S2c 构建测试断言样式里有 `.i-lucide-text-quote`；S2e e2e 在产品构建里断言分区图标有尺寸与背景 |
| plugin-manifest 输出 8 与 `version-mismatch` | S2a 内核测试（必需依赖受阻、可选依赖不注入） |
| plugin-manifest 输出 11（顶层声明在三个位置登记） | S2d：只有顶层贡献、没有该位置入口的第三方插件在三个位置登记声明，用 snippets 的配置项 |
| plugin-manifest 输入 `contracts` 与清单无效条件 | S2a 表驱动测试；内置插件对齐测试照常通过 |
| plugin-install 输出 8.1（受阻插件） | S3b 后端测试（版本、传递、待禁用不算）与插件页组件测试 |
| browser-host 第三方入口接入 | S2e、S3b e2e |
| plugin-api SDK 导出面 | S2b 快照测试与仓库外 `tsc` |

## 验证

- 每片自跑上表的命令；全部完成后跑内核与应用的 `bun test`、Vitest、两包 typecheck、`docs:check`、`governance:check`，以及全量 e2e（直接跑 Playwright 前先构建 server、web 与 e2e 外壳）。
- 端到端：在 Work 分支上构建四个示例 → 经插件页安装 → 重启开发服务 → 工作台里用它们（设置项、page 分区、命令、远程服务、公开状态）→ 禁用 → 重启后消失。截图看插件页面与宿主的主题、浮层、图标一致。
- 留下的未验证边界：代码回收（plugin-code-loading 输出 6、7）本 Task 不做运行中注销，不验证；Electron、WebKitGTK 上的装载不跑（没有桌面端）。

## 不做与风险

- 不做：运行中启用、禁用与注销（S5）；代码回收的证明；激活超时；worker 池、作用域定时器、`ctx.diagnostics`、`ctx.plugin` 等 plugin-api 里仍为 planned 的上下文成员；文件端点的认证；SDK 的正式发布；插件页的入口状态；卸载、禁用确认里列出依赖它的插件；插件用宿主原子类；开发用的就地加载（t05）；menu、file-menu 的迁移与脚手架（t05）。
- 风险：
  - Bun 的运行期模块与 `require.cache` 删除式重载都不是文档承诺的行为，升级 Bun 时回归 S3a 的测试。
  - 宿主模块表让 Vue、nb-ui 失去 tree-shaking：记录构建体积的前后差。
  - SDK 的导出一旦给出就是兼容承诺；导出面快照让每次增删都显式。
  - 插件之间的合同模块：第三方消费方把提供方的合同模块打进自己的产物，按 id 与版本匹配；提供方改合同时消费方要重新构建，这由合同版本表达。
  - 作者每次改代码要“卸载、重启、安装、重启”或提高版本号；开发用的就地加载留给 t05，本 Task 的摘要 URL 不挡它。

## 设计审查的处理

深入审查（开发者 2026-10-23 批准）：omp（默认模型）与 Claude Opus 审后端、内核与安全，Claude Sonnet 审浏览器一侧与 SDK 的接口形状。报告存为 [`evidences/design-review-omp.txt`](evidences/design-review-omp.txt)、[`evidences/design-review-opus.txt`](evidences/design-review-opus.txt)、[`evidences/design-review-sonnet.txt`](evidences/design-review-sonnet.txt)。逐条处理见下表（编号是各报告里的编号）。

omp 在写完第 10 条与处理索引后因上游额度用完退出，报告没有“未发现问题的方面”，各条正文完整，没有续跑。三位审查者共 45 条，没有不成立的；同一问题被几位独立提出的合并处理：

| 问题 | 报告条目 | 处理 |
|---|---|---|
| `@vue/reactivity` 不共享，打进插件后静默失效 | Opus 1、Sonnet 4 | 改：两张模块表与构建外部都加它，`@vue/runtime-*` 别名到 `vue`；“构建预设”“浏览器装载”“服务端装载” |
| 纯度检查只查浏览器产物，服务端会打进第二份内核 | omp 4、Sonnet 4、Sonnet 14 | 改：按模块图查服务端与浏览器产物，另查外部引用都在模块表里 |
| 合同 JSON 往返丢 Refine、format、Codec | omp 1、Opus 2、Opus 13 | 改：远程合同只能用纯 JSON Schema，构建预设拒绝；SDK 产物把 `typebox` 列为 peer 依赖 |
| 只比版本就换合同对象，掩盖不一致；适配器抛错丢释放 | omp 2、Opus 9 | 改：比完整规范化合同，不一致时交内核拒绝；清单合同先校验形状与预检 schema；内核 `validationProblems` 包一层 |
| 第三方贡献点表达不了 schema | omp 10 | 改：贡献点加可序列化 `schema`，清单带上 |
| 别的服务端回收正在用的版本目录 | omp 3 | 改：运行版本的租约与推迟回收（新一节） |
| 查询串造新实例不回收；代次计数作用域 | omp 9、Opus 3、Opus 11 | 改：每次激活前删 `require.cache` 再固定路径导入 |
| 文件端点挂不到 `/api/plugins/` | omp 5、Opus 4 | 改：`/api/runtime/plugins/...`，分发器不改 |
| 路径穿越只有编码斜杠能到处理器 | Opus 5 | 改：逐段解码规则与编码形式的测试 |
| 长缓存与同版本重装冲突 | omp 8、Opus 6、Sonnet 13 | 改：URL 与引导 `revision` 带版本目录的内容摘要 |
| 别的网页可跨源探测插件 | Opus 12 | 改：加 CORP 与 nosniff 两个响应头 |
| SDK 再导出应用源码：成环、仓库外拿不到类型 | omp 7、Opus 7、Opus 10、Sonnet 8 | 改：SDK 由应用生成、仓库内走别名，不建依赖应用的工作区包；“定义 → 清单”移进内核；仓库外 `tsc` 验收 |
| 版本范围：内核没有版本、可选依赖、预览口径 | Opus 8、omp 6、Sonnet 10 | 改：定义带 `version`；可选依赖不注入；预览用同一推导与同一 `satisfies`，按重启后的集合，`blocked` 带入口与原因 |
| 启动被挂起的第三方入口卡死 | Opus 15 | 改：第三方插件不计入启动结算 |
| 构建期怎么执行作者代码、入口怎么找、单文件限制 | Opus 14、Sonnet 5 | 改：`runnerImport`、作者合同、逐入口构建 |
| 删 `thirdPartyDefinition` 后顶层贡献丢失 | Sonnet 3 | 改：三处共用 `thirdPartyDefinitionAt` |
| 插件的原子类与图标在产品构建里没有规则；样式时机与字段 | Sonnet 1、Sonnet 2、Sonnet 15 | 改：插件不依赖宿主原子类，图标由构建预设生成；清单 `style` 字段，窗口登记插件时就加载；样式包进 `@layer components` |
| 浏览器换成 `new Function` 未声明、未验证 | Sonnet 6 | 改：回到 Spec 与 G1 的 `<script src>` 加登记工厂 |
| 浏览器失败类别、超时、重试与缓存 | Sonnet 7、Sonnet 12 | 改：四个结构化原因，30 秒未登记为失败，只缓存成功的工厂 |
| 浏览器复用模块与服务端“新代次新实例”不一致 | Sonnet 17 | 改：每次激活调用一次工厂 |
| clock 依赖只有测试场地给的宿主能力 | Sonnet 9 | 改：改用 `clockKey`，SDK 导出宿主能力 |
| SDK 导出面：页面组件、类型成对、名字、快照 | Sonnet 16 | 改：四个页面组件都进、`browser` 子路径、page 分区助手、导出面快照。按所有者分子路径不采纳：VS Code、Obsidian 都是单一命名空间，子路径越多宿主模块表与兼容面越大，所有者信息由名字与文档表达 |
| 产物导出整份定义 | Sonnet 19 | 改：产物只导出 `activate` |
| `entries-not-loaded` 过期；插件页没有入口状态 | Sonnet 11 | 改：收尾删除；入口状态记进后续事项 |
| 验收缺口 | Sonnet 18 | 改：按需取码的请求计数、失败样例夹具、开发会话冒烟；Task README 范围同步 |
| 作者迭代要两次重启 | Sonnet 20 | 接受：就地加载留给 t05，摘要 URL 不挡它 |
| nb-ui 其它入口不共享 | Sonnet 14 | 接受：第一版只共享 `components`，纯度检查的报错写明“未共享”；要加时逐项评估 |
