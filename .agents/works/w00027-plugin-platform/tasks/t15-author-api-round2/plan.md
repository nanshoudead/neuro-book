# t15 实施计划

## 1. Context

t14 交付了作者 API 的第一版，作者验收（[报告](../t14-plugin-author-api/evidences/author-acceptance-sonnet.txt)）走通了，但留下几处新的 API 改进（B1 到 B7）。开发者 2026-10-24 又提了 P1 到 P9，并定了顺序：会改作者 API 的先做完，再做命令行、文档治理与发布（决定见 [README](README.md) 的“先处理的事”）。

本计划分三期，每期单独定稿：

- **第一期（本节以下）**：发布前改完作者 API：只用 Bun（P4）、SDK 按内置插件分子路径（P7）、记录的 `update`（P8）、B1 到 B7、作者命令改名 `nbooke`（P5 的作者一半）。
- **第二期**：`nbook` 命令行与新应用的 npm 包（P5 的用户一半、P2 的打包）。ADR 0029 第 6 条把新应用的交付链排除在外，要先写一份 ADR，第一期合入后再写计划。
- **第三期**：文档治理（P1）与发布（P2）。

依据：[plugin-api](../../../../../docs/specs/runtime/plugin-api.md)、[plugin-channel](../../../../../docs/specs/runtime/plugin-channel.md)、[persistence](../../../../../docs/specs/storage/persistence.md)、[commands](../../../../../docs/specs/workbench/commands.md)、[views](../../../../../docs/specs/workbench/views.md)、[workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)、[plugin-code-loading](../../../../../docs/specs/runtime/plugin-code-loading.md)、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)。

开发者 2026-10-24 确认第一期计划（助手都改成所属子路径的函数、子路径表、`nbook.view.open`、作者命令名 `nbooke`）；计划审查后的修订见第 9 节。

## 2. 技术选型

- 打包 SDK：`npm pack` 换成 `bun pm pack --quiet --filename <绝对路径>`（Bun 自带；`--quiet` 时只输出路径）。产物与 npm 的文件集合相同，`package.json` 的字节格式不同，验收按文件集合、`exports`、`bin`、依赖与可安装性，不按字节。
- 其余无通用问题。

## 3. 关键设计

### 3.1 只用 Bun（P4）

- 作者文档、模板 README、`create` 的提示：先 `bun add -d <SDK>`，再 `bunx nbooke create .`、`bun run build`、`bun run typecheck`。文档写明先装 SDK 再运行 `bunx nbooke`：没装时 `bunx` 会去 registry 找同名包。
- `plugin-sdk/pack.ts`：`bun pm pack`（见技术选型）；`package.json` 的 `engines` 写 `bun`（最低版本取仓库现用的），去掉 `node`；`cli.js` 的 shebang 改 `#!/usr/bin/env bun`，`cli.ts` 去掉兼容 Node 的写法。
- 模板的脚本用 `bun --bun` 运行带 Node 抬头行的工具（`vue-tsc`），不依赖本机的 Node。
- `create`：去掉处理 `npm init` 占位的代码与测试；仍接受已有的 `package.json` 并合并。
- `template.test.ts`、`pack.test.ts`：用 `bun` 运行作者命令；夹具里的依赖写法改成 `bun add` 实际写下的形状。
- 仓库其它地方（根 README、CONTRIBUTING）给用户的 npm 写法留到第三期文档治理。

### 3.2 SDK 按内置插件分子路径（P7）

| 子路径 | 内容 | 服务端可用 |
|---|---|---|
| `.` | 插件框架：`definePlugin`、`defineEntry`、`defineServiceKey`、`provideService`、`provideServicePerConsumer`、远程服务（`defineRemoteService`、`remoteService`、`provideRemote`、`ok`、`fail`、`orThrow`、`eventSource`）、诊断、宿主能力（`hostClockKey`、`hostStateRootKey`）、`Text`、`localize`、`formatText` 与相关类型 | 是 |
| `/state` | `nbook.state`：`defineStore`、`definePublicState` 与类型 | 是 |
| `/storage` | `nbook.storage`：`storageKey`、`defineRecord`、记录类型 | 是 |
| `/settings` | `nbook.settings`：`settingsKey`、`setting`、`section`、`defineSetting`、`displayLocale`、分区与选项来源的贡献点、`settingsChoicesEvent` 与类型 | 是 |
| `/settings/browser` | `settingsPage`、`choices`、`SettingsPageContext`、`SettingsChoicesImplementation`、`OptionSource`，设置页组件 `SettingsRow`、`SettingsPageList`、`SettingsPageActions`、`SettingsSaveBar` | 否 |
| `/commands` | `nbook.commands`：`command`、`COMMANDS_POINT`、`commandServiceKey`（从代码执行命令）、命令类型 | 是 |
| `/workbench` | `nbook.workbench`：`view`、`statusItem`、`PropsOf`、视图与条目的贡献点、`ViewContext`、`ViewImplementation`、`ItemImplementation`、声明类型 | 否 |
| `/components` | nb-ui 组件（不变） | 否 |

- 根入口的 `plugin.section`、`plugin.setting`、`plugin.command` 改成所属子路径的函数 `section(plugin, …)`、`setting(plugin, …)`、`command(plugin, …)`；`plugin` 对象只剩 `id`、`descriptor`、`entry`、`definition`。
- 低层的 `viewContribution`、`settingsPageContribution` 不再公开：助手已覆盖，示例与模板没有用到。
- `/browser` 删除。只给浏览器的部分有两种写法：整个内置插件只在浏览器里有意义的（工作台）占一个子路径；两端都要的（设置）把浏览器部分放在 `/<插件>/browser`。作者文档写明这条规则。
- 迁移清单（S2 一次改完）：`src/sdk/entries.ts` 及其消费者（打包的 `exports` 与类型声明、作者构建的别名、`tsconfig` 的路径、`sdk.test.ts` 的快照）；两端宿主模块表 `src/web/host/plugin-modules.ts`、服务端的模块表与 `plugin-modules.dom.test.ts`；`plugin-sdk/testing/browser-artifact.ts`；`plugin-sdk/pack.test.ts`、`template.test.ts`；`src/architecture.test.ts`；`build-plugin` 的共享模块表；示例、模板、e2e 的测试插件；作者文档与示例 README。核对：仓库里不再出现 `nb-plugin-sdk/browser`；每个子路径同时有打包导出、构建别名、宿主模块表的一项与模块身份测试。
- 公开面测试：`surface.test.ts` 改成逐个子路径求闭包、快照；服务端可用的子路径的闭包里没有 `vue` 与 `.vue` 文件。
- 构建预设：服务端入口导入了只给浏览器的子路径时，“未共享”的报错附一句原因（由 `SDK_ENTRIES` 的 `server: false` 生成）。
- 打包时生成 `docs/exports.md`：每个子路径导出了什么，作者文档链接它，不手写名单。

### 3.3 记录的 `update`（P8）

`RecordHandle<T>` 加：

```ts
update(change: (current: T | null) => T, options?: {readonly attempts?: number}): Promise<{readonly ok: true; readonly value: T; readonly revision: Revision} | StorageFailed>;
```

| 读到的快照或保存结果 | 行为 |
|---|---|
| `missing` | 以 `null` 调用 `change`，条件保存（`expect` 为快照的 revision） |
| `ok` | 以当前值调用 `change`，条件保存 |
| `corrupt`、`unsupported-version` | 不调用 `change`，返回同名失败与详情（要作者显式 `reset`） |
| `error` | 不调用 `change`，返回快照里的码与详情 |
| 保存得到 `conflict` | 重读、重算，算一次尝试 |
| 保存得到别的失败（含 `unknown-outcome`、`unavailable`） | 立即返回，不重试 |

- `attempts` 是保存的总次数，缺省 5，必须是不小于 1 的整数，否则抛 `TypeError`；用完仍是 `conflict` 就返回它。
- `change` 抛错时 `update` 以同一个错误失败（Promise reject），不写入：这是作者代码的错误，不是存储失败。
- 在 `src/plugins/storage/shared/facade.ts` 上用已有的 `read` 与 `save` 组合，不加新的远程方法。persistence Spec 加一条输出与上表；作者文档的读写示例改用 `update`，并写 `subscribe` 的用法。

### 3.4 打开视图（B1）

- 工作台加命令 `nbook.view.open`，`args: {viewId?: string}`，`effect: "write"`（会改写布局记录），`expose.agent: "never"`（与现有布局命令一致）。
  - 不给 `viewId`：经选择服务列出已接受声明的视图让用户选（同 `move-view` 的两步），命令面板里可用。
  - 给 `viewId`：用 `applyView({kind: "select-container", …, reveal})` 一次选中它所在的容器并显示所在的区域（面板、侧栏、右栏都走同一个动作）；多视图容器里展开它。
  - 失败：没有布局（不在工作台页面）返回 `unavailable`；`viewId` 没有已接受的声明返回 `invalid-args`（与 `move-view` 一致）。
  - 第一期不移动焦点：成功表示布局已改，视图在下一次渲染时出现。焦点、`preserveFocus`、视图可见性事件写进 views Spec 的“后续”。
- `/workbench` 的 `statusItem` 的 `command` 收视图助手（点了即以它的 id 执行 `nbook.view.open`）。命令助手与视图助手按各自的 `kind` 字段区分，不再用 `"contribution" in command`，写错类型编译不过。不提供单独的 `openView`。
- 作者文档加“作者可用的内置命令”一节，只列 `nbook.view.open`，并写明其它内置命令不在兼容范围。
- views、workbench-shell、commands 的 Spec 加条目与验收场景（第 6 节）。

### 3.5 类型报错的落点（B2）

- `fail`：远程方法实现的第二个参数 `RemoteCallContext` 加上 `ok`、`fail` 两个成员，类型由该方法的合同推出；`signal` 保留。写法 `add: async ({by}, {fail, ok, signal}) => …`。码或详情写错时报错落在 `fail(…)` 的参数上。根入口的 `ok`/`fail` 保留，给写在方法外的辅助函数用。
- 入口产出漏写、多写贡献实现：`EntryOutputFor` 在缺项时要求一个以问题命名的属性（`"缺少贡献实现：ping"`），多写的键映射成同样命名的 `never`。
- 产出了 `remote` 而没声明 `remoteProvides`：同样给以问题命名的属性。
- 验收固定所用的 TypeScript 与 vue-tsc 版本，断言报错的位置与问题名；完整的报错文字只作证据。编译期反例写在 `plugin.test.ts`、`outcome.test.ts`，另在仓库外的作者项目跑一次 vue-tsc 存证。

### 3.6 调用方的失败详情（B3）

- 新类型 `RemoteResultFor<Method>`：成功分支加运行时失败（`unavailable` 等，`detail` 原类型）加 `BusinessFailure<Method>`（按码展开，`detail` 是该码 schema 的静态类型）。
- `RemoteClient` 的方法、`orThrow`、`RemoteCallError.failure` 改用它；`RemoteResult<T, BusinessCode>` 保留给不按方法的内部用法。
- 编译期反例：两个码各有不同详情、运行时失败码与业务码混合收窄。

### 3.7 规则提前到编辑器（B4）

- `command`：`args` 的静态类型有必填键且没写 `expose: {human: false}` 时参数类型带一个以问题命名的属性；运行时检查保留（`runsWithoutArgs` 管类型表达不了的写法）。
- `defineRecord`、远程方法的 `input`：schema 字面量写 `additionalProperties: true` 时编译不过。
- `setting` 的名字、`remoteService` 的名字：模板字面量类型检查格式。
- `context.services.require`：激活上下文带上入口 `dependencies` 的键类型，传别的键编译不过。内核 `ActivationContext` 加类型参数（缺省为任意键，内核与内置插件不受影响），SDK 的 `plugin.entry` 把 `dependencies` 推出的键传进去；可选依赖同样收窄。
- 验收同 3.5。

### 3.8 构建报错的格式（B5）

- `nbooke build --verbose`：CLI 的参数解析加 `verbose`，经 `BuildPluginOptions.verbose` 传到 `loadModules` 与 Vite 的日志级别，缺省关。
- 缺省：执行入口定义失败时，从错误堆栈里取第一个位于作者目录的位置，报成“文件:行:列 消息”；Vite 的 `Error when evaluating` 日志不打印。`--verbose`：原样保留 Vite 日志与完整堆栈。
- 不是作者代码的错误（打包器自己出错）缺省也保留原始消息与堆栈的第一行。
- usage、作者文档与 plugin-code-loading Spec 写 `--verbose`。

### 3.9 推事件的助手（B6）

根入口加：

```ts
eventSource<Payload, Filter = unknown>(options?: {
    match?: (filter: Filter, payload: Payload) => boolean;
    onSubscribe?: (filter: Filter, sink: RemoteSink<Payload>, context: {readonly signal: AbortSignal}) => void | Promise<void>;
}): {
    readonly subscribe: RemoteEventImplementation<Payload, Filter>;   // 放进合同的 events
    emit(payload: Payload): void;
    readonly size: number;
};
```

- 所有权：在 `activate` 或 `provideRemote` 的工厂里创建，不在模块顶层；在工厂里创建时每个调用方一份，在 `activate` 里创建时所有调用方共享。作者文档写明这两种与各自的用途。
- 时序：先登记订阅、再调用 `onSubscribe`（推初始值、建每个订阅自己的资源都在这里）；`signal` 触发时移除订阅。`emit` 只推给此刻已登记、`match` 通过的订阅；订阅结束后 `emit` 不再推给它。
- counter 改用它；notes 要按调用方打开记录并转发记录的推送，用 `onSubscribe` 能写就改，写不清楚就保留手写的 `subscribe` 并在示例里说明为什么。
- 真实测试：多个调用方、入口停止、`onSubscribe` 里推初始值先于之后的 `emit`、`onSubscribe` 失败。

### 3.10 合同 id 从插件拼（B7）

根入口加 `remoteService(plugin, {name, version, provider, callers, methods, events})`，id 为 `<插件 id>/<name>`，其余同 `defineRemoteService`；`defineRemoteService` 保留（内置插件与跨插件的合同用）。

### 3.11 作者命令改名 `nbooke`（P5 的作者一半）

`nbook-plugin` 改名 `nbooke`：`plugin-sdk/cli.ts` 的 usage、`create-plugin.ts`、`pack.ts` 的 `bin`、`template/_package.json` 的脚本、`template.test.ts`、作者文档与示例 README、plugin-api Spec、`docs/proposals/extensible-application-platform.md` 的引用、`src/plugin-platform-profile.ts`。逐处编辑：`buildTempPrefix` 这类恰好含同一片段的标识不改。不保留旧名（SDK 未发布）。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `runtime/plugin-api.md` | 子路径表与各助手的归属、浏览器部分的子路径规则；`nbooke`；只用 Bun；B2、B4 的类型规则；`remoteService`、`eventSource`；`commandServiceKey` 公开 |
| `runtime/plugin-code-loading.md` | 两端宿主模块表的 SDK 子路径与各自在服务端是否可用；“未共享”的原因提示；构建报错的格式与 `--verbose` |
| `runtime/plugin-channel.md` | 调用方按方法的失败类型；方法实现的上下文加 `ok`、`fail`；`eventSource` 的所有权与时序 |
| `storage/persistence.md` | `update` 与状态表 |
| `workbench/commands.md` | `nbook.view.open` |
| `workbench/views.md`、`ui/workbench-shell.md` | `nbook.view.open` 的行为、失败与验收；“后续”：焦点、`preserveFocus`、可见性事件 |
| 作者文档、模板 README、示例 README | 随各节；“作者可用的内置命令”；链接生成的 `docs/exports.md` |

## 5. 切片

| 切片 | 内容 | 验证 |
|---|---|---|
| S1 | 3.1 只用 Bun、3.11 改名 | `bun test plugin-sdk/`、类型检查 |
| S2 | 3.2 子路径、助手归属与迁移清单 | 类型检查、`bun test src/sdk plugin-sdk/ src/architecture.test.ts`、宿主模块表的 DOM 测试、插件 e2e |
| S3 | 3.3 `update` | storage 测试（逐行对应状态表）、示例场景 |
| S4 | 3.6 调用方详情、3.9 `eventSource`、3.10 `remoteService` | 内核远程测试、示例场景 |
| S5 | 3.5 报错落点、3.7 规则提前 | 编译期反例、仓库外作者项目的 vue-tsc 输出 |
| S6 | 3.4 打开视图 | 命令与布局的单元测试（真实布局 store）、工作台 e2e 一例 |
| S7 | 3.8 构建报错格式 | 构建测试 |

收口：全量 e2e；实现审查（后端 omp、前端 Sonnet）；再请空白上下文的 Sonnet 照 t14 的说明从零写一遍插件，对照 t14 的作者验收报告。

## 6. 验收映射

写 Spec 条目时补编号；每条行为对应一个测试或编译期反例，S5 另有仓库外作者项目的报错证据。`nbook.view.open` 的场景，布局一半用真实布局 store 的单元测试（`layout-store.test.ts`、`view-commands.test.ts` 的写法），整条接线一个 e2e：

- 侧栏、右栏、面板里的视图各打开一次：所在区域显示、容器选中；
- 区域被隐藏、拖到零、面板收成标题头时打开：区域恢复显示；
- 多视图容器里收起的视图：展开；
- 紧凑呈现下打开：按紧凑呈现的规则显示；
- 未知 `viewId`：`invalid-args`；不在工作台页面：`unavailable`；
- 不给 `viewId`：经选择服务选，取消时不改布局；
- Agent 调用：`not-exposed`；
- 状态栏条目收视图助手，点击后视图打开。

## 7. 验证

- 每片：类型检查、受影响的 Bun 与 Vitest 测试。
- S2、S6：插件 e2e；收口跑全量 e2e。
- 作者体验：收口的作者验收（只用 SDK 包的材料，Bun）。
- 未验证边界：B2、B4 的报错文字随 TypeScript 版本可能变化，证据记下所用版本。

## 8. 不做与风险

- 不做：`locations` 从入口推出（见 README 的范围评估）；`nbook.view.open` 移动焦点（写进 Spec 的“后续”）；`nbook` 命令行与应用的发布（第二期）。
- 风险：B2、B4 依赖 TypeScript 推断，可能做不到报错落在理想位置。做不到的那一项写明原因、退回运行时检查，不为它扭曲 API。
- 风险：3.2 改动所有示例、模板与宿主表，S2 内按迁移清单一次改完，合入前跑插件 e2e。
- 待开发者知悉：npm 上 `nbooke` 目前没人注册（审查实测 404），`nbook` 已被别人占用。作者没先装 SDK 就运行 `bunx nbooke` 会去 registry 取同名包；文档已写先装再运行，是否先占下 `nbooke` 这个包名由开发者决定（远端写入）。第二期 `nbook` 只作为 `@notnotype/neuro-book` 的 bin 名，用户经 `bun add -g @notnotype/neuro-book` 安装，不用 `bunx nbook`。

## 9. 计划审查的处理

两份计划审查固定在 `9d83ef8bd`：omp 审后端、领域与计划整体（[报告](evidences/design-review-omp.txt)，阻断 5、重要 8、建议 1），Sonnet 审前端与作者体验（[报告](evidences/design-review-sonnet.txt)，重要 6、建议 15）。

| 来源 | 发现 | 处理 |
|---|---|---|
| omp 阻断 1、Sonnet F01 | 子路径表没有 `nbook.state` 的去处 | 成立，加 `/state` |
| omp 阻断 2、Sonnet F17 | `/browser` 的低层函数、组件与类型没有去处 | 成立，3.2 表逐名列出；低层的 `viewContribution`、`settingsPageContribution` 不再公开 |
| omp 阻断 3 | 方法实现的第二个参数改成 `{ok, fail}` 会丢掉 `signal` | 成立，改成在 `RemoteCallContext` 上加 `ok`、`fail` |
| omp 阻断 4 | `eventSource` 没有所有权、每个订阅的初始化与时序 | 成立，3.9 重写：`onSubscribe`、所有权、时序与测试 |
| omp 阻断 5、Sonnet F05 | `nbook.view.open` 会写布局，不能是只读 | 成立，`effect: "write"`；Agent 暴露 `never`，与布局命令一致；`viewId` 可选，经选择服务选 |
| omp 重要、Sonnet F06 | 聚焦视图没有现成机制 | 成立，第一期不移动焦点，写进 Spec 的“后续” |
| omp 重要、Sonnet F07 | 未知视图应是 `invalid-args` | 成立 |
| Sonnet F04 | 面板不走 `setPartHidden` | 成立，改用 `applyView` 的 `reveal` |
| Sonnet F08 | `openView` 第一期没有使用者 | 成立，删去；状态栏条目直接收视图助手 |
| Sonnet F09 | 状态栏条目按 `"contribution" in command` 区分会把视图助手当命令 | 成立，按 `kind` 区分 |
| omp 建议、Sonnet F10 | 作者不能从代码执行命令 | 成立，`/commands` 公开 `commandServiceKey` |
| omp 重要 | `update` 没有 `error` 快照、`change` 抛错、`attempts` 的语义 | 成立，3.3 写成状态表 |
| omp 重要 | `RemoteResult<T, BusinessCode>` 带不出详情类型 | 成立，新类型 `RemoteResultFor<Method>` |
| omp 重要 | 迁移清单漏了宿主模块表、模拟宿主、测试与快照 | 成立，3.2 列出迁移清单与核对方式 |
| omp 重要 | plugin-code-loading 的宿主模块表没列进 Spec 改动 | 成立，加入第 4 节 |
| omp 重要、Sonnet F03 | `bun pm pack` 的参数与输出解析 | 成立，见技术选型 |
| omp 重要 | `--verbose` 没有接到命令与构建选项 | 成立，3.8 写全 |
| Sonnet F02 | 没装 SDK 时 `bunx nbooke` 去 registry 取包；`nbook` 已被占用 | 文档写先装再运行；包名是否先占下列入第 8 节交开发者 |
| Sonnet F11 | 服务端导入浏览器子路径时报错只有“未共享” | 成立，附原因 |
| Sonnet F12 | 浏览器部分的命名不统一 | 接受现状并写成规则（3.2） |
| Sonnet F13 | 子路径多了要一张生成的导出速查 | 成立，打包生成 `docs/exports.md` |
| Sonnet F14 | 现有闭包测试不分子路径、不查 Vue | 成立，按子路径重写 |
| Sonnet F15 | 模板测试的夹具与 `bun add` 实际写下的不一致 | 成立，改夹具 |
| Sonnet F16 | 改名清单不准 | 成立，3.11 逐处列出 |
| Sonnet F18 | “内置命令”一节会成为兼容承诺 | 成立，只承诺 `nbook.view.open` |
| Sonnet F19 | `nbook.view.open` 没有验收场景 | 成立，第 6 节 |
| Sonnet F20 | 去掉 `engines.node` 后 `vue-tsc` 仍用本机 Node | 成立，模板脚本用 `bun --bun` |
| Sonnet F21 | VS Code 有的焦点、可见性事件 | 写进 Spec 的“后续” |
| omp 待确认项 | B2、B4 的报错文字随版本变 | 验收断言位置与问题名，完整文字只作证据 |

## 10. 实施中的调整

- S1：模板的 `typecheck` 不用 `bun --bun`：`vue-tsc` 在 Bun 的运行时里认不出 `.vue` 模块（仓库外作者项目实测，计划审查的实验项目里没有 `.vue` 文件），按它的抬头行用 Node 跑，与仓库自己的 `typecheck` 一样。作者文档与 plugin-api Spec 写明类型检查要 Node。
- S1：`bun add -d <tarball>` 写下的依赖是相对路径（不带 `file:`）加一个空的 `dependencies`；在已有项目的子目录里它同样向上找到上级的 `package.json`，作者文档改成先写一个空的 `package.json`。

