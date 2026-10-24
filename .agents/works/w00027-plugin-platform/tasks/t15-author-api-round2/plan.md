# t15 实施计划

## 1. Context

t14 交付了作者 API 的第一版，作者验收（[报告](../t14-plugin-author-api/evidences/author-acceptance-sonnet.txt)）走通了，但留下几处新的 API 改进（B1 到 B7）。开发者 2026-10-24 又提了 P1 到 P9，并定了顺序：会改作者 API 的先做完，再做命令行、文档治理与发布（决定见 [README](README.md) 的“先处理的事”）。

本计划分三期，每期单独定稿：

- **第一期（本节以下）**：发布前改完作者 API：只用 Bun（P4）、SDK 按内置插件分子路径（P7）、记录的 `update`（P8）、B1 到 B7、作者命令改名 `nbooke`（P5 的作者一半）。
- **第二期**：`nbook` 命令行与新应用的 npm 包（P5 的用户一半、P2 的打包）。ADR 0029 第 6 条把新应用的交付链排除在外，要先写一份 ADR，第一期合入后再写计划。
- **第三期**：文档治理（P1）与发布（P2）。

依据：[plugin-api](../../../../../docs/specs/runtime/plugin-api.md)、[plugin-channel](../../../../../docs/specs/runtime/plugin-channel.md)、[persistence](../../../../../docs/specs/storage/persistence.md)、[views](../../../../../docs/specs/workbench/views.md)、[workbench-shell](../../../../../docs/specs/ui/workbench-shell.md)、[plugin-code-loading](../../../../../docs/specs/runtime/plugin-code-loading.md)、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)。

## 2. 技术选型

- 打包 SDK：`npm pack` 换成 `bun pm pack`（Bun 自带，产出同样的 tarball；只用 Bun）。
- 其余无通用问题。

## 3. 关键设计

### 3.1 只用 Bun（P4）

- 作者文档、模板 README、`create` 的提示：`bun add -d <SDK>`、`bunx nbooke create .`、`bun run build`、`bun run typecheck`。
- `plugin-sdk/pack.ts`：`bun pm pack`；`package.json` 的 `engines` 写 `bun`（最低版本取仓库现用的），去掉 `node`；`cli.js` 的 shebang 改 `#!/usr/bin/env bun`，`cli.ts` 去掉“Node 与 Bun 都能运行”的兼容写法。
- `create`：去掉处理 `npm init` 占位的代码与测试（`bun add` 在空目录里只写依赖）；仍接受已有的 `package.json` 并合并。
- `template.test.ts`：用 `bun` 运行作者命令、装依赖。
- 仓库其它地方（根 README、CONTRIBUTING）里给用户的 npm 写法留到第三期文档治理一起改。

### 3.2 SDK 按内置插件分子路径（P7）

子路径表 `src/sdk/entries.ts` 改成：

| 子路径 | 内容 | 服务端可用 |
|---|---|---|
| `.` | 插件框架：`definePlugin`、`defineEntry`、服务键与 `provideService`、远程服务与 `ok`/`fail`、诊断、宿主能力、`Text` 与本地化工具 | 是 |
| `/storage` | `nbook.storage`：`storageKey`、`defineRecord`、记录类型 | 是 |
| `/settings` | `nbook.settings`：`settingsKey`、`setting`、`section`、`displayLocale`、分区与选项来源的贡献点与类型 | 是 |
| `/settings/browser` | 设置页 `settingsPage`、选项来源 `choices`（要 Vue） | 否 |
| `/commands` | `nbook.commands`：`command`、`COMMANDS_POINT`、命令类型 | 是 |
| `/workbench` | `nbook.workbench`：`view`、`statusItem`、`openView`（B1），视图与条目的类型（要 Vue） | 否 |
| `/components` | nb-ui 组件（不变） | 否 |

- 根入口的 `plugin.section`、`plugin.setting`、`plugin.command` 改成所属子路径的函数 `section(plugin, …)`、`setting(plugin, …)`、`command(plugin, …)`，与浏览器助手同一种写法：从导入路径就看得出在用哪个内置插件。`plugin` 对象只剩 `id`、`descriptor`、`entry`、`definition`。
- `/browser` 删除，内容并进 `/workbench` 与 `/settings/browser`。
- 架构测试：服务端可用的子路径的闭包里没有 Vue（沿用 t13 的公开面闭包测试）。
- 示例、模板、作者文档、`build-plugin` 的共享模块表随之改。

### 3.3 记录的 `update`（P8）

`RecordHandle<T>` 加：

```ts
update(change: (current: T | null) => T, options?: {readonly attempts?: number}): Promise<{readonly ok: true; readonly value: T; readonly revision: Revision} | StorageFailed>;
```

- 读出当前值（`missing` 给 `null`），条件保存 `change` 的结果；`conflict` 时重读重试，缺省最多 5 次，用完返回 `conflict`。`corrupt`、`unsupported-version` 不调用 `change`，返回对应失败（这两种要作者显式 `reset`）。
- 在 `src/plugins/storage/shared/facade.ts` 上用已有的 `read` 与 `save` 组合，不加新的远程方法。
- persistence Spec 加一条输出；作者文档的读写示例改用 `update`，并写 `subscribe` 的用法。

### 3.4 打开视图（B1）

- 工作台加命令 `nbook.view.open {viewId}`：找到视图所在的容器与区域，选中容器、显示区域（布局已有 `applyView({kind: "select-container"})` 与 `setPartHidden`），多视图容器里展开它，焦点给视图；视图不在布局里、没有已接受的声明时返回 `unavailable` 并写原因。人与 Agent 都能用（`expose.agent: "auto"`，只读）。
- `/workbench` 的 `statusItem` 的 `command` 收视图助手（点了即打开它）；`openView(viewHelper)` 返回 `{id, args}`，给标题栏、菜单这类收命令引用的地方用。
- views 与 workbench-shell 的 Spec 加条目；作者文档加“作者可用的内置命令”一节。

### 3.5 类型报错的落点（B2）

- `fail`：`provideRemote` 的方法实现收第二个参数 `{ok, fail}`，类型由该方法的合同推出；码或详情写错时报错落在 `fail(…)` 的参数上，第一行是可选的码。根入口的 `ok`/`fail` 保留（写在方法外的辅助函数里用）。
- 入口产出漏写、多写贡献实现：`EntryOutputFor` 在缺项时要求一个以问题命名的属性（`"缺少贡献实现：ping"`），多写的键映射成同样命名的 `never`；报错的第一行就是这个名字。
- 产出了 `remote` 而没声明 `remoteProvides`：同样给以问题命名的属性（`"入口没有声明 remoteProvides"`）。
- 每条在 `plugin.test.ts`、`outcome.test.ts` 写编译期反例；另在仓库外作者项目里跑一次 vue-tsc，把报错的第一行写进证据。

### 3.6 调用方的失败详情（B3）

`RemoteResult<T, BusinessCode>` 的业务失败分支按码展开成可区分联合：`{ok: false; code: C; detail: Static<errors[C]>}`；运行时失败码（`unavailable` 等）的 `detail` 保持原类型。调用方 `if (!r.ok && r.code === "too-many") r.detail.max` 直接有类型。现有调用方按需收窄。

### 3.7 规则提前到编辑器（B4）

- `command`：`args` 的静态类型有必填键且没写 `expose: {human: false}` 时参数类型为 `never` 加问题名；运行时检查保留（`runsWithoutArgs` 管类型表达不了的 `minProperties`）。
- `defineRecord`、远程方法的 `input`：schema 字面量写 `additionalProperties: true` 时编译不过。
- `setting` 的名字、`remoteService` 的名字：模板字面量类型检查格式（小驼峰点分段、合同短名）。
- `context.services.require`：激活上下文带上入口 `dependencies` 的键类型，传别的键编译不过。内核 `ActivationContext` 加类型参数（缺省为任意键，内核与内置插件不受影响），SDK 的 `plugin.entry` 把 `dependencies` 推出的键传进去。可选依赖的取法同样收窄。

### 3.8 构建报错的格式（B5）

`build-plugin.ts` 执行入口定义失败时：从错误堆栈里取第一个位于作者目录的位置，报成“文件:行:列 消息”；Vite 的 `[vite] (ssr) Error when evaluating` 日志与堆栈只在 `nbooke build --verbose` 时打印。

### 3.9 推事件的助手（B6）

根入口加 `eventSource<Payload, Filter>({match?})`：`source.subscribe` 直接放进合同的 `events`，订阅随调用方的 `signal` 自动移除；`source.emit(payload)` 推给所有匹配的订阅。示例 counter、notes 与作者文档改用它。

### 3.10 合同 id 从插件拼（B7）

根入口加 `remoteService(plugin, {name, version, provider, callers, methods, events})`，id 为 `<插件 id>/<name>`，其余同 `defineRemoteService`；`defineRemoteService` 保留（内置插件与跨插件的合同用）。

### 3.11 作者命令改名 `nbooke`（P5 的作者一半）

`nbook-plugin` 改名 `nbooke`：SDK 包的 `bin`、模板的脚本、作者文档、Spec、插件页里的提示文字。不保留旧名（SDK 未发布）。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `runtime/plugin-api.md` | 子路径表与各助手的归属；`nbooke`；只用 Bun；B2、B4 的类型规则；`remoteService`、`eventSource` |
| `runtime/plugin-channel.md` | 调用方失败详情按码；方法实现收 `{ok, fail}`；`eventSource` |
| `storage/persistence.md` | `update` |
| `workbench/views.md`、`ui/workbench-shell.md` | `nbook.view.open` |
| `runtime/plugin-code-loading.md` | 构建报错的格式与 `--verbose` |
| 作者文档、模板 README、示例 README | 随各节 |

## 5. 切片

| 切片 | 内容 | 验证 |
|---|---|---|
| S1 | 3.1 只用 Bun、3.11 改名 | `bun test plugin-sdk/`、类型检查 |
| S2 | 3.2 子路径与助手归属，示例与模板随之改 | 类型检查、`bun test src/sdk plugin-sdk/`、插件 e2e |
| S3 | 3.3 `update` | storage 测试、示例场景 |
| S4 | 3.6 调用方详情、3.9 `eventSource`、3.10 `remoteService` | 内核远程测试、示例场景 |
| S5 | 3.5 报错落点、3.7 规则提前 | 编译期反例、仓库外作者项目的 vue-tsc 输出 |
| S6 | 3.4 打开视图 | 命令测试、工作台 e2e 一例 |
| S7 | 3.8 构建报错格式 | 构建测试 |

收口：全量 e2e；实现审查（后端 omp、前端 Sonnet）；再请空白上下文的 Sonnet 照 t14 的说明从零写一遍插件，对照 t14 的作者验收报告。

## 6. 验收映射

写 Spec 条目时补编号；每条行为对应一个测试或编译期反例，S5 另有仓库外作者项目的报错证据。

## 7. 验证

- 每片：类型检查、受影响的 Bun 与 Vitest 测试。
- S2、S6：插件 e2e；收口跑全量 e2e。
- 作者体验：收口的作者验收（只用 SDK 包的材料，Bun）。
- 未验证边界：B2、B4 的报错文字随 TypeScript 版本可能变化，证据记下所用版本。

## 8. 不做与风险

- 不做：`locations` 从入口推出（见 README 的范围评估）；`nbook` 命令行与应用的发布（第二期）。
- 风险：B2、B4 依赖 TypeScript 推断，可能做不到报错落在理想位置。做不到的那一项写明原因、退回运行时检查，不为它扭曲 API。
- 风险：3.2 改动所有示例与模板的导入，S2 内一次改完，合入前跑插件 e2e。
