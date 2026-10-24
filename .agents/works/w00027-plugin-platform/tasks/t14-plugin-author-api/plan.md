# t14 实施计划：作者 API 的形状

## 1. Context

t12 让 Sonnet 以第三方作者身份从零写了一个插件（[作者体验报告](../t12-plugin-dx-review/evidences/dx-sonnet.txt)，F01 到 F20），t13 的 [design.md 第 4 节](../t13-sdk-package-split/design.md#4-作者-api-的形状第二阶段) 把其中关于作者 API 的结论整理成 A1 到 A9。开发者 2026-10-24 定 D5：A1 到 A9 全部做，单独一个 Task，排在分层改动（t13）之后；并指定按 autonomous-delivery 推进，产品取舍记进 [待确认清单](../../pending-confirmations.md)。

要解决的问题（按作者踩到的顺序）：

- 一个贡献的 id 要在三处写（常量、`contributions`、激活产出 `[贡献点]: {[id]: 实现}`），id 写错、前缀写错编译与构建都过，运行时贡献静默消失（F05、F09、F11）。
- 远程方法返回业务失败要写 `as const`，`detail` 不按合同检查（F03）。
- 声明的样板多：文字必须双语、状态栏条目与视图的排位字段全必填、设置项逐项写插件 id、无参数命令也要写 `args`（F16）。
- 记录与远程方法的 schema 缺 `additionalProperties: false` 到构建才报；服务端入口的记录缺省 `local`，打不开，作者只看到 `unavailable`（F02、F06）。
- 出错时作者看不到原因：插件页不显示入口状态与被拒的贡献，远程调用只说 `unavailable`，命令面板里参数不合规的命令点了没反应（F06、F11、F12、F20）。
- 作者文档缺前置条件、订阅的释放、插件状态、一段完整的远程服务代码（F04、F08、F14、F17）；`create` 留下 `npm init` 的占位字段（F19）。

依据：[`runtime.plugin-api`](../../../../../docs/specs/runtime/plugin-api.md)、[`runtime.plugin-channel`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md)、[`storage.persistence`](../../../../../docs/specs/storage/persistence.md)、[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md)、[`workbench.commands`](../../../../../docs/specs/workbench/commands.md)、[`runtime.plugin-code-loading`](../../../../../docs/specs/runtime/plugin-code-loading.md)；[ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)（插件定义是常量）、[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)（公开 API 只经 `src/sdk/`）。

不做（design.md 第 4 节已定）：插件描述由 `package.json` 生成、作者只写一份 id（F15）；`NumberInput` 的数值类型（F18，nb-ui 后续）。

工作方式：主会话实现，worktree `.worktree/w00027-plugin-platform`，分支 `feat/w00027-plugin-platform`；每片单独提交、验证后合入 master。

## 2. 技术选型

无新的通用问题：类型推导用 TypeScript 自身，schema 用 TypeBox，界面用 nb-ui 已有的通知（`useNotification`）。不引入新依赖。

## 3. 关键设计

### 3.1 内核 `packages/nb-runtime/src/remote/`：结果助手与按码的详情类型（A1）

- 新增 `ok(value)`、`fail(code, detail?)`，从 `remote` 入口导出：
  ```ts
  export function ok<const T>(value: T): {readonly ok: true; readonly value: T};
  export function fail<const Code extends string, const Detail = undefined>(code: Code, detail?: Detail): {readonly ok: false; readonly code: Code; readonly detail: Detail};
  ```
  `const` 类型参数保住字面量，作者不写 `as const`。
- `RemoteOutcome<Method>` 的失败一支按码分布：`{ok: false; code: C; detail: Static<Method["errors"][C]>}`，`detail` 必填、按合同的 schema 检查，写错形状编译报错；`fail(code)` 只对详情 schema 接受 `undefined` 的码（`Type.Undefined()`）成立。
- 运行时同样核对（计划审查 omp 1）：提供方交出的业务失败，`detail` 不符合该码的 schema 时，调用方得到 `provider-error`（与成功值不符合 `output` 时同一条路径，记诊断，详情不外传）。现有提供方（内置插件、示例）里不合的详情随之改正。
- `ok`、`fail` 从 SDK 根入口导出，进导出名单快照与打包产物的声明（omp 11）。
- `defineRemoteService` 对方法的 `input` 与事件的 `filter`：没写 `additionalProperties` 的对象 schema 补成 `false`（返回新的冻结合同，不改作者传进来的对象）；显式写了 `true` 的仍报错（A5 的远程一半）。

### 3.2 内核 `packages/nb-runtime/src/plugins/`：`provide` 改名、`onStop`、`unavailable` 带原因（A6、A2、A7 的远程一半）

- `provide` 改名 `provideService`，`providePerConsumer` 改名 `provideServicePerConsumer`，旧名删除（SDK 未发布，内置插件与示例一起改）。SDK 根入口的其余名字（`defineServiceKey`、`defineStore`、`definePublicState`、宿主能力与诊断的键）按 t13 已定保留，不拆 `/advanced`（F17 只做改名）；作者文档给一张“常用名字”清单。
- 激活上下文加 `onStop(release: () => void | Promise<void>): void`：登记一件“这一代入口停止时做的事”（登记到本代次的入口工作作用域，随它收口，激活失败时同样执行），作者释放自己的计时器、句柄不再接触 `Scope` 与 `ResourceSpec`（F04，计划审查 D08、omp 3）。`defineStore(…).create` 改用 `onStop`，参数类型收成它用到的 `plugin`、`entry`、`signal`、`onStop`，内核上下文与作者上下文都满足，内置插件的调用不改；`definePublicState` 不收上下文，保持模块顶层的纯函数（omp 4）。
- 远程调用失败为 `unavailable` 时（提供入口激活失败、受阻），`detail` 带上原因与错误的一句消息，例如 `提供入口 acme.x/server 不可用：activate/activation-threw：local 记录 progress 需要客户端身份`（`host.ts` 构造 reason 处，激活结果里有错误时取它的 `message`）。

### 3.3 SDK `packages/neuro-book/src/sdk/`：`definePlugin` 与贡献助手（A2、A3、A4）

助手只建在已有的内核与内置插件合同之上，内置插件不改用它。分两处（计划审查 D01）：SDK 根入口（服务端也加载，不能带 Vue）的 `definePlugin` 只带不碰 Vue 的助手；要 Vue 或只在浏览器有意义的助手是 `/browser` 的独立函数，第一个参数是 `plugin`，读它的 id 拼贡献 id。

```ts
// plugin.ts（插件描述，服务端与构建预设也读它）
export const plugin = definePlugin({id: "acme.hello", version: "0.1.0", locations: ["server", "browser"]});
export const main = plugin.section({name: "main", title: "你好", icon: "i-lucide-hand", groups: [{id: "basic", title: "基本"}]});
export const greeting = plugin.setting({name: "greeting", schema: Type.String(), default: "你好", title: "问候语", section: main, group: "basic"});
export const descriptor = plugin.descriptor([main, greeting]);

// web/plugin.ts
import {settingsPage, statusItem, view} from "@notnotype/nb-plugin-sdk/browser";
const panel = view(plugin, {name: "panel", title: "你好", icon: "i-lucide-hand", load: () => import("./HelloView.vue")});
const say = plugin.command({name: "say-hello", title: "打个招呼", description: "Count one more greeting", effect: "write"});
const count = statusItem(plugin, {name: "count", title: "问候次数", command: say});
export const browserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: settingsKey}],
    contributions: {panel, say, count},
    activate: (context) => {
        const total = ref(0);
        return {contributions: {
            panel: panel.implement(() => ({count: total.value})),
            say: say.implement(() => { total.value += 1; return {ok: true, value: total.value}; }),
            count: count.implement({text: () => String(total.value)}),
        }};
    },
})]);
```

- **`definePlugin({id, version, locations})`**（根入口）：`const` 推导插件 id 的字面量。返回的对象上：
  - `section({name, …})`：list 分区，`category` 缺省 `plugins`，`groups` 的 id 推成字面量联合；
  - `setting({name, section?, group?, …})`、`settings({…})`：返回现有的 `SettingDefinition`（`settings.get(定义)` 照旧），`section` 收分区助手（类型推出 id，`group` 只能是那个分区的组 id）；引用别的插件的分区时才写分区 id 字符串（计划审查 D05）；
  - `command({name, args?, …})`：`args` 缺省空对象 schema，没写 `additionalProperties` 的补成 `false`（D07）；`args` 有必填属性而没写 `expose.human: false` 时加载即抛错，写明“命令面板不收集参数”（D12）；
  - `descriptor(声明式贡献)`、`entry(…)`、`definition(入口…)`。
- **`/browser` 的助手**：`view(plugin, {name, load, …})`、`settingsPage(plugin, {name, load, …})`、`statusItem(plugin, {name, …})`、`choices(plugin, {name, …})`。它们带“只在浏览器”的位置标记，`plugin.entry({location: "server", contributions: {panel}})` 编译报错（D01）。
- **短名**：每个助手调用时按对应贡献点的 id 规则校验 `name`（视图与条目一段 `[a-z][a-z0-9-]*`，命令一段 `[a-z0-9][a-z0-9-]*`，设置项名小驼峰点分），不合抛带名字的 TypeError，不留到登记时静默被拒（D07、D16）。贡献 id 是 `<插件 id>.<name>`（设置项 `<插件 id>/<name>`），类型上是字面量（A3）。
- **助手的返回值**：`{id, contribution, implement(…)}`；没有实现的（分区、设置项）没有 `implement`。`implement` 返回带贡献点、id 与位置的“已绑定实现”。
  - 视图与设置页的 `implement(props?)`：属性的类型从 `load` 推出（`load: () => import("./X.vue")` 在 vue-tsc 下带组件的 `$props`），去掉宿主给的 `context`；必填属性漏写、写错名或类型不对编译报错，可选属性的笔误查不出（文档写明）；纯 tsc 下退化成不检查（F09 b，D04）。
  - 命令 `implement(run)`；状态栏条目 `implement({text, tooltip?, state?})`；选项来源 `implement(source)`（`SettingsChoicesImplementation`）。
- **`plugin.entry`**（键对象写法，D02）：
  - `contributions: {键: 助手}`，激活产出 `contributions: {键: 助手.implement(…)}`；产出的类型由声明映射出来：漏一项报 “Property 'x' is missing”，换错助手报两种已绑定实现不兼容，同一项写两次在语法上不可能；多写的键沿用内核 `defineEntry` 的以问题命名的属性（`多写的贡献实现：x`）。`activate` 可以是 async。
  - 不经助手的东西按内核原有的字段写，不塞进一个字段（D03、omp 2）：插件自己定义的贡献点在 `plugin.definition({contributionPoints, entries})`，不要实现的顶层声明在 `plugin.descriptor`；入口的 `receives` 与产出的 `receivers` 照内核写；向别的插件的贡献点提交、`defineStore` 的公开状态贡献写在 `rawContributions`（内核的 `ContributionDeclaration[]`），产出 `rawContributions: {[贡献点]: {[id]: 实现}}`。SDK 把助手的贡献与 `rawContributions` 合成内核的 `contributions`，服务、远程服务、接收者与 `rawContributions` 的核对交给内核 `defineEntry` 的类型。S2 的测试覆盖 menu（定义贡献点、接收）、file-menu（向别人的点提交）与 counter（公开状态）三种写法。
  - 助手带的激活事件（设置页的 `onSettingsPage:`、选项来源的事件）自动并入 `activationEvents`，与显式写的去重（D06）。
  - `entry.id` 缺省取运行位置名。入口 id 在一个插件定义里全局唯一（内核的规则，不按位置分），`plugin.definition` 组装时发现重复就抛错，写明重复的 id（omp 10）。
  - 激活上下文对作者收窄（A2）：类型上去掉 `scope`，要在入口停止时做事用 `onStop`（3.2）；其余成员不变。运行时传进去的仍是内核的上下文，只是类型窄。
- **缺省值（A4）**：文字字段收 `string`（两种语言同一句）或 `LocalizedText`，助手里统一成 `LocalizedText`，线上的声明格式不变；`description`（给 Agent 的英文说明）仍是单个字符串。状态栏条目 `alignment` 缺省 `right`、`order` 与 `priority` 缺省 0；视图 `location` 缺省 `sidebar`、`layout` 缺省 `scroll`；`effect` 仍必填（只读模式拦截 Agent 的唯一依据，不猜）；状态栏条目的 `command` 收命令助手的返回值。
- **措辞**：作者只写一次的是“贡献 id 的短名”；插件 id、版本、运行位置仍在 `package.json`、`definePlugin` 与入口文件里各写一处，不一致时构建报错（F15 已定不做），文档照实写（D15）。

### 3.4 记录 `packages/neuro-book/src/shared/storage.ts`（A5）

- `defineRecord` 的 `locality` 改为必填（类型与校验都要求），不再缺省 `local`。
- `schema` 是没写 `additionalProperties` 的对象时补成 `false`；显式 `true` 仍报错。
- 内置插件与示例里省略了 `locality` 的记录逐个补上（行为不变，补的就是原来的缺省 `local`；已存的数据、命名空间与指纹不变）。
- 已安装的旧产物（omp 7）：不设兼容窗口。SDK 未发布，装着的只有开发中的插件；按旧 SDK 构建的产物在新 NeuroBook 上激活时因 `provide` 不存在或 `locality` 缺失而失败，插件页按 3.5 显示失败入口与错误消息，作者重建即可。这是取舍，进待确认清单；SDK 发布之后的不兼容改动按 `engines` 的 semver 处理（plugin-api 的“兼容”）。验收加一个“旧写法的产物装上、重启后，插件页显示失败原因”的场景。

### 3.5 出错可见（A7）

**问题的读模型**（D10，omp 6、12）：插件页只要“本位置的问题”，不要内核目录本身。`src/plugin-platform/shared/` 新增纯函数 `pluginProblems(catalog, location)`：从内核 `catalog()` 里只取 `location` 这个位置的入口（跳过 `foreign-location`），合并插件顶层与入口下的贡献，丢掉声明、实现与作用域，得到纯 JSON：

```ts
type PluginProblem =
    | {kind: "entry-failed"; plugin: string; entry: string; location: string; stage: string; reason: string; message: string | null}
    | {kind: "entry-blocked"; plugin: string; entry: string; location: string; reason: BlockedPlugin["reason"]; key: string | null}
    | {kind: "contribution-rejected"; plugin: string; entry: string | null; capability: string; id: string; reason: string; detail: string | null};
```

按插件、入口、贡献点与 id 稳定排序；`message` 是激活错误的一句消息（插件自己的文字，按 ADR 0027 信任所有插件，不脱敏），其余是固定码，界面按语言翻译。TypeBox schema 写在插件管理的合同里。

| 字段 | 服务端入口 | 浏览器入口 | 项目入口 |
|---|---|---|---|
| 入口失败、受阻，被拒的贡献 | 服务端宿主建插件管理时传入 `() => pluginProblems(本实例.catalog(), "server")` | `window.plugins` 新加 `problems()`（同一个函数作用于本窗口，`"browser"`），不暴露目录本身 | 不显示，行里写“另有在作品里运行的入口” |
| 显示名、描述 | 清单：`PluginManifest` 加可选 `displayName`、`description`（现在构建写了 `description`、读取时丢了，omp 5），读取、生成、作者输入与清单 schema 一起改；插件管理按当前运行的版本读清单 | — | — |

- 合同：`list` 的返回改为专有条目 `PluginListEntry`（`PluginListItem` 加 `displayName`、`description`、`problems`）；`install`、`enable`、`disable`、`uninstall` 的返回仍是 `PluginListItem`（它们的结果重启后才生效，带运行状态会误导）。合同版本 3 升到 4。合同测试覆盖：第三方安装、待切换版本、清单读不了、内置插件。
- 浏览器一侧：`nbook.plugins` 的浏览器入口加可选依赖 `windowPluginsKey`，插件页合并本窗口的问题；拿不到时（Lab、测试）只显示服务端的。
- 刷新：打开页面读一次、写操作后重读、本窗口一侧订阅 `window.plugins.onChange`；服务端一侧是打开页面时的快照，页面上写明。
- 界面（按现有行的写法，D11）：
  - 第三方插件的行：主标题仍是 id（`data-plugin-row`、按钮的可访问名称、e2e 都按 id），有显示名时跟在 id 后面、次要文字色；描述在下面一行、单行截断、悬停看全文。内置插件没有清单，不显示这两项。
  - 有问题时标题里加一个危险色徽标（“1 个入口失败”“2 条贡献被拒”），下面逐条用次要文字色写原因，与现有“没有登记的原因”同一写法；没问题时不占位。不列正常的入口（按需激活的入口没激活是常态）。不加 `role="alert"`。
  - 待生效的降级写“重启后降级到 x”，与安装对话框的“降级插件”一致（F20）。
  - `PluginsPage.md` 的“不支持”一节、数据属性约定与 Lab 场景随之改。外观交 Sonnet 前端审查，截图放进汇报。
- **构建预设**（`src/plugin-platform/build/`）：插件描述的 `locations` 与实际有入口的运行位置不一致时构建失败，列出多的与少的（F13 的第二半）。

### 3.6 命令面板（A8，`src/plugins/workbench/web/` 的面板与键位，D12）

- 面板的候选里不列 `args` 有必填属性的命令（它们在面板里必然 `invalid-args`）；`plugin.command` 在加载时就拦下这种声明（3.3），作者在构建时知道。
- 从面板或快捷键执行命令失败时，经工作台的通知服务（`notificationsKey`；面板宿主加可选的 `notify`，Lab 不接时照现状）弹一条警告级、会自动消失的通知：命令标题与 `reason`。弹的码：`invalid-args`、`execution-error`、`unavailable`、`unknown-command`、`denied`；不弹 `stale-target`（用户自己的操作让目标换了）。文案走 `palette-messages.ts` 的双语表。自己已经呈现了失败的命令会多一条通知，在 commands.md 写明约定。
- 改 commands.md 里“产品页记入诊断”那一句与键位分发一条。

### 3.7 作者文档与 `create`（A9）

- `plugin-sdk/README.md`：前置条件（怎样拿到能装插件的 NeuroBook、怎样重启，视图在作品窗口里才出现）；改用 3.3 的写法；订阅随入口停止自动释放，提前取消用订阅句柄；插件状态（`defineStore`）与公开状态（`definePublicState`）各一段；一段远程服务加订阅的完整代码（服务端提供、浏览器调用与订阅）；命令小节写明“给人用的命令参数要全部可选”；`ok`、`fail`；常用名字清单；视图属性只查必填属性。
- 模板与 7 个示例插件改用 3.3 的写法，示例的教学注释随之改，场景测试照跑。
- `create` 合并 `package.json` 时去掉 `npm init` 留下的占位：`main` 指向不存在的文件、`scripts.test` 是 npm 的缺省报错命令、空的 `keywords`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `runtime/plugin-api.md` | `definePlugin` 与贡献助手（根入口与 `/browser` 的分工）、短名与校验、键对象的入口与 `raw`、激活事件并入、视图属性的推导、缺省值、收窄的激活上下文、`provideService` 改名 |
| `runtime/plugin-channel.md` | `ok`、`fail`；业务失败的详情按码检查；`input`、`filter` 自动补 `additionalProperties: false`；`unavailable` 的详情带原因 |
| `runtime/services.md`、`runtime/plugins.md` | `provide` 改名；激活上下文的 `onStop` |
| `runtime/plugin-manifest.md` | 清单加可选 `displayName`、`description`（读取保留） |
| `storage/persistence.md` | `locality` 必填、schema 自动补 |
| `runtime/plugin-install.md`、`settings/settings-window.md`（插件页） | `list` 的专有条目与新字段、合同版本 4；插件页的显示名、描述与问题 |
| `runtime/browser-host.md`、`workbench/views.md` | `window.plugins` 加 `problems()` |
| `runtime/plugin-code-loading.md` | 构建核对 `locations` |
| `workbench/commands.md` | 面板不列必填参数的命令；执行失败的通知（面板与快捷键） |
| `PluginsPage.md`、Lab 场景 | 见 3.5 |

## 5. 切片

| 片 | 内容 | 提交 | 自跑验证 |
|---|---|---|---|
| S1 | 3.1、3.2：`ok`/`fail`、按码的详情与运行时核对、合同自动补 schema、`provideService` 改名、`onStop` 与 `defineStore` 改用它、`unavailable` 带原因；内置插件、示例的源码、SDK 根入口、导出名单快照与 `pack.test.ts` 的声明名单一起跟上（omp 8） | 一提交，Spec 同步 | 内核 `bun test`；应用 `bun run typecheck`、`bun run test`（含 `plugin-sdk` 测试） |
| S2 | 3.3：`definePlugin`、`/browser` 助手、键对象的入口与 `raw`、名字校验、激活事件并入、属性推导、收窄的上下文与 `defineStore` 的最小接口 | 一到两个提交 | 应用测试；类型反例用 `@ts-expect-error`，并用 vue-tsc 编一个带 `.vue` 的作者项目核对属性推导 |
| S3 | 3.4：记录 `locality` 必填与 schema 自动补 | 一提交 | 应用测试 |
| S4 | 模板与 7 个示例改用新写法；作者文档（3.7）；`create` 去占位 | 一到两个提交 | 应用测试、`plugin-sdk` 测试、`plugin-authoring`、`plugin-code` e2e |
| S5 | 3.5：清单 `displayName`、`window.plugins.catalog()`、`list` 的问题、插件页界面、构建核对 `locations` | 内核与服务端一提交，界面一提交 | 插件页组件测试、`plugins` e2e、Lab 场景截图 |
| S6 | 3.6：面板不列必填参数的命令、失败通知 | 一提交 | 面板组件测试、命令 e2e |

## 6. 验收映射

| 判据 | 由什么覆盖 |
|---|---|
| 远程方法用 `fail("too-many", {max: 1})` 不写 `as const` 能编译；详情形状不对、缺详情、码不在合同里编译报错 | 内核类型反例测试 |
| 提供方交出不合 schema 的业务失败详情（缺、形状错、多给）时调用方得到 `provider-error` | 内核真实远程调用测试 |
| `onStop` 登记的事在入口停止与激活失败时都执行 | 内核测试 |
| 合同的 `input` 没写 `additionalProperties` 时被补成 `false`，多余字段被拒 | 内核远程合同测试 |
| 提供入口激活失败时调用方的 `unavailable` 带错误消息 | 内核远程测试 |
| 助手拼出的 id 是 `<插件 id>.<name>`；名字不合规则加载时抛错 | SDK 单元测试 |
| 入口产出漏一项、多一项、换错助手编译报错；服务端入口收浏览器助手编译报错 | SDK 类型反例（`@ts-expect-error` 守住不可编译） |
| 上面几种错误的诊断文字里写明哪一项 | 仓库外作者项目用 `vue-tsc --pretty false` 编译反例文件，断言输出含该项的名字（`plugin-sdk/pack.test.ts`，omp 9） |
| 同一插件两个入口同 id 时组装报错 | SDK 测试 |
| menu、file-menu、counter 三种不经助手的写法能表达，照内核核对 | SDK 测试与示例场景 |
| 设置页、选项来源的激活事件自动并入 | SDK 测试 |
| 视图 `implement` 的必填属性写错名编译报错（vue-tsc） | 仓库外作者项目的类型检查（`plugin-sdk/pack.test.ts`） |
| 文字写字符串时两种语言相同；缺省值按 3.3 | SDK 单元测试 |
| 命令 `args` 有必填属性而人类可见时加载抛错；面板不列这种命令 | SDK 测试、面板测试 |
| `defineRecord` 不写 `locality` 编译报错并在加载时抛错 | 记录测试 |
| `pluginProblems` 只取本位置、合并顶层与入口的贡献、不带实现 | 平台测试（含 foreign-location 与顶层声明） |
| 清单的 `displayName`、`description` 构建写出、读取保留 | 内核清单测试、构建预设测试 |
| 插件页列出服务端与本窗口的失败入口、被拒贡献（含原始声明的前缀写错）、显示名与描述；写方法的返回不带运行状态 | 插件管理合同测试、插件页组件测试、`plugins` e2e |
| 按旧写法构建的产物装上、重启后，插件页显示失败入口与原因 | `plugins` 或 `plugin-code` e2e |
| 构建时 `locations` 与入口不一致失败 | 构建预设测试 |
| 面板与快捷键执行失败弹通知，`stale-target` 不弹 | 面板测试 |
| 模板按新写法 `create`、类型检查、构建、安装、运行；7 个示例的类型检查与场景测试通过 | `plugin-authoring` e2e、应用测试 |

## 7. 验证

每片跑上表的命令；S4、S5 结束跑插件相关的三份 e2e；收口前跑全量 e2e。作者体验的最终检验：S5 之后派一个空白上下文的 Sonnet，沿用 t12 的任务说明以第三方作者身份再写一遍“每日字数目标”插件，核对 F02、F03、F05、F06、F09、F10、F11、F12、F16、F20 不再出现；主会话自己按文档走的那一遍只作冒烟（计划审查 D14）。

## 8. 不做与风险

- 不做：插件描述由 `package.json` 生成（F15）；命令参数的输入表单；插件页跨作品实例查询项目入口的状态，以及列出正常激活的入口与贡献清单（F20 的“展开显示贡献”）；内置插件的显示名与描述；`NumberInput` 的数值类型（F18）；SDK 根入口拆 `/advanced`（F17）。
- 风险一：视图属性的推导依赖 vue-tsc 给 `.vue` 模块的类型；作者用纯 tsc 时不检查也不误报，文档写明。
- 风险二：`RemoteOutcome` 按码分布后，现有提供方里不合的详情会编译报错，改动可能比预期多；按报错逐个改，不放宽类型。
- 风险三：示例是教学材料，改写面大；场景测试守住行为，注释随之改。

## 9. 设计审查的处理

第一轮：Sonnet 审前端与作者体验部分（[报告](evidences/design-review-sonnet.txt)，阻断 1、重要 11、建议 3）；omp 在 Sonnet 那轮修订之后审内核、服务端与计划整体（[报告](evidences/design-review-omp.txt)，阻断 2、重要 8、建议 2）。

| 条 | 处理 |
|---|---|
| D01 | 成立：根入口不能带 Vue。浏览器助手改为 `/browser` 的独立函数，带位置标记，服务端入口收它编译报错 |
| D02 | 成立：改用键对象写法，漏项与换错助手由 tsc 原生报，多写沿用 `NoExtraKeys`，`activate` 可 async |
| D03 | 成立：不经助手的贡献写在 `raw`，原样并入内核格式 |
| D04 | 成立：视图与设置页的属性从 `load` 推出，只查必填属性，文档写明 |
| D05 | 成立：设置项的 `section` 收分区助手，`group` 推成那个分区的组 id |
| D06 | 成立：助手的激活事件自动并入 |
| D07、D16 | 成立：命令 `args` 自动补 `additionalProperties: false`；各助手按各自的规则校验短名 |
| D08 | 成立。最终改法见 omp 3：内核上下文加 `onStop`，作者上下文去掉 `scope` |
| D09 | 成立：清单加可选 `displayName`；内置插件不显示显示名与描述 |
| D10 | 成立：补数据来源表；`window.plugins` 加 `catalog()`；`list` 专有条目、合同升版本；刷新策略 |
| D11 | 成立：按现有行的写法（徽标加次要色原因行）；主标题仍是 id。显示名的位置是产品取舍，进待确认清单 |
| D12 | 成立：经 `notificationsKey`；面板不列必填参数的命令；按码列出弹与不弹；警告级；快捷键同样 |
| D13 | 成立：F17 写明只改名；验收映射补项；F20 的降级措辞并入 |
| D14 | 成立：最终验收派空白上下文的 Sonnet |
| D15 | 成立：措辞限定为“贡献 id 的短名” |
| omp 1 | 成立：详情必填并按 schema 运行时核对，不合为 `provider-error` |
| omp 2 | 成立：不经助手的东西按内核原有字段写（`contributionPoints` 在定义上、`receives`/`receivers` 照写、`rawContributions` 只放贡献） |
| omp 3 | 成立：内核激活上下文加 `onStop`，作者上下文不给 `scope`（比 D08 那轮的“只留 register”更彻底，F04 不再接触 `ResourceSpec`） |
| omp 4 | 成立：`definePublicState` 不收上下文，只改 `defineStore.create` |
| omp 5 | 成立：清单补 `displayName`、`description` 的读写全链 |
| omp 6、12 | 成立：问题读模型 `pluginProblems` 与 `PluginProblem` 的形状；`window.plugins` 只给 `problems()` |
| omp 7 | 成立，接受取舍：不设兼容窗口（SDK 未发布），旧产物在插件页显示失败原因；进待确认清单，加验收场景 |
| omp 8 | 成立：SDK 根入口与名单快照并入 S1 |
| omp 9 | 成立：诊断文字由仓库外作者项目的 `vue-tsc` 输出断言，`@ts-expect-error` 只守不可编译 |
| omp 10 | 成立：入口 id 全局唯一，组装时报错 |
| omp 11 | 成立：`ok`、`fail` 从 SDK 根入口导出 |

## 10. 实施中的调整

- S2：`plugin.settings({…})`（多条设置项一次声明）没有做：SDK 根入口本来就没导出 `defineSettings`，作者逐条写 `plugin.setting` 已经不再重复插件 id。
- S2：内核 `define.ts` 导出两个类型积木（`EntryOutputFor`、`ExtraOutputKeys`），SDK 的 `plugin.entry` 在它们之上组合，不重抄一份核对规则。
- S5：插件页不显示在作品里（项目实例）运行的入口的问题：列表只带服务端实例的，窗口只查自己的；作者文档写明这一类看日志。
- S5：插件管理合同升到版本 4（`list` 返回带显示名、说明与问题的专有条目，安装与启停的结果仍是不带运行状态的条目）。
- S6：面板与快捷键执行失败的通知不弹 `stale-target`（用户自己换了目标）；`not-exposed`、`read-only`、`confirmation-required` 只对 Agent 的调用出现，也不弹。

## 11. 实现审查的处理

两份实现审查固定在 `34471b3b9`：omp 审后端与领域（[报告](evidences/impl-review-omp.txt)，阻断 0、重要 2、建议 2），Sonnet 审浏览器一侧（[报告](evidences/impl-review-sonnet.txt)，阻断 0、重要 2、建议 11）。修正在 `cb907e4c3`（前端）、`9dbdadd18`（后端）。

| 来源 | 发现 | 处理 |
|---|---|---|
| omp 1、Sonnet 建议 1 | 要不要参数只看 `required`，`minProperties` 这类写法漏过 | 成立，改：`runsWithoutArgs(args)` 按 `Value.Check(args, {})` 判断，面板与 `definePlugin` 共用；补用例 |
| omp 2 | 示例场景的说明仍写 `context.scope` | 成立，改成 `onStop` |
| omp 3 | 清单读取去掉显示名与说明的首尾空白，Spec 写“原样保留” | Spec 写错，改 Spec：去掉首尾空白、只有空白的按没写 |
| omp 4 | 远程失败详情 `undefined` 与 `null`、原型链上的码没有用例 | 成立，补三个用例（实现本来就对） |
| Sonnet 重要 1 | 通知把 `invalid-args` 一律说成“需要参数” | 成立，改：正文照原因写；Spec、组件文档同步 |
| Sonnet 重要 2 | 面板路径的失败不记诊断 | 成立（base 上就没有），改：命令宿主给面板的失败补记 `report`；补用例 |
| Sonnet 建议 2 | `stale-target` 不弹的理由不成立 | 不成立：用户入口里它只由命令自己返回，内置的编辑器、视图命令都表示“两步之间用户换了目标”；注释与组件文档改写清楚 |
| Sonnet 建议 3 | 状态栏、标题栏、外壳按钮等别的入口执行失败仍然静默 | 成立，接受取舍，进待确认清单：执行入口不区分“人点的”与“代码调的”（缺省都是 `user`），按审计事件统一弹通知会给自己处理了失败的代码调用也弹；要统一需给调用来源加一类，另做 |
| Sonnet 建议 4 | 英文界面下原因是中文 | 接受：原因是命令自己写的文字，执行入口不翻译 |
| Sonnet 建议 5 | `notify` 抛错成为未处理的拒绝 | 不改：通知服务入队不抛错，收益小 |
| Sonnet 建议 6、7 | 失败通知、插件页的合并与释放订阅缺用例 | 成立，补：面板路径到 `notify` 与 `report` 的用例；插件页顶层贡献两边合一、没有问题不显示快照说明、卸载释放订阅 |
| Sonnet 建议 8 | 本窗口的问题靠诊断次序更新：失败诊断发出时入口还在 `activating` | 成立，base 上视图失败呈现同样依赖；内核没有“入口状态变了”的观察钩子，进待确认清单，另做 |
| Sonnet 建议 9 | 问题行没有条数上限；说明截断只靠悬停 | 接受：插件页是排查用的，列全比截断有用；说明全文在插件的设置分区与 README |
| Sonnet 建议 10 | 带泛型的单文件组件推不出属性；只有视图有位置反例 | 成立，注释写明；补设置页、状态栏条目、选项来源的位置反例 |
| Sonnet 建议 11 | 失败类型内联四遍 | 成立，抽成 `CommandFailure` |

