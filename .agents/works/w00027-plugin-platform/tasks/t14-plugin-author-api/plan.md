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
- `RemoteOutcome<Method>` 的失败一支按码分布：`{ok: false; code: C; detail?: Static<Method["errors"][C]>}`，`detail` 按合同的 schema 检查，写错形状编译报错。现有提供方（内置插件、示例）里不合的详情随之改正。
- `defineRemoteService` 对方法的 `input` 与事件的 `filter`：没写 `additionalProperties` 的对象 schema 补成 `false`（返回新的冻结合同，不改作者传进来的对象）；显式写了 `true` 的仍报错（A5 的远程一半）。

### 3.2 内核 `packages/nb-runtime/src/plugins/`：`provide` 改名、激活上下文对作者收窄（A6、A2 的一部分）

- `provide` 改名 `provideService`，`providePerConsumer` 改名 `provideServicePerConsumer`，旧名删除（SDK 未发布，内置插件与示例一起改）。
- 激活上下文的作用域：新增类型 `AuthorActivationContext`，`scope` 收窄为 `{register(release: () => void | Promise<void>): void}`（只能登记“入口停止时做的事”），其余成员不变。内核的 `ActivationContext` 不变；SDK 的入口助手（3.3）给作者的是收窄后的类型。`register` 落到内核作用域的哪个调用、释放先后，实现时读 `lifecycle` 的作用域合同确定，写进 Spec。
- 远程调用失败为 `unavailable` 时（提供入口激活失败、受阻），`detail` 带上原因与错误的一句消息，例如 `提供入口 acme.x/server 不可用：activate/activation-threw：local 记录 progress 需要客户端身份`（A7 的远程一半，`host.ts` 构造 reason 处）。

### 3.3 SDK `packages/neuro-book/src/sdk/`：`definePlugin` 与贡献助手（A2、A3、A4）

新模块 `src/sdk/plugin.ts`（经 SDK 根入口导出），浏览器专有的助手在 `src/sdk/browser.ts`。只建在已有的内核与内置插件合同之上，内置插件不改用它。

```ts
// plugin.ts（作者的插件描述）
export const plugin = definePlugin({id: "acme.hello", version: "0.1.0", locations: ["server", "browser"]});
export const greeting = plugin.setting({name: "greeting", schema: Type.String(), default: "你好", title: "问候语", section: "main", group: "basic"});
export const section = plugin.section({name: "main", title: "你好", icon: "i-lucide-hand", groups: [{id: "basic", title: "基本"}]});
export const descriptor = plugin.descriptor([greeting, section]);

// web/plugin.ts
const view = plugin.view({name: "panel", title: "你好", icon: "i-lucide-hand", load: () => import("./HelloView.vue")});
const say = plugin.command({name: "say-hello", title: "打个招呼", description: "Count one more greeting", effect: "write"});
const status = plugin.statusItem({name: "count", title: "问候次数", command: say});
export const browserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: settingsKey}],
    contributions: [view, say, status],
    activate: (context) => {
        const count = ref(0);
        return {contributions: [
            view.implement(() => ({count: count.value})),
            say.implement(() => { count.value += 1; return {ok: true, value: count.value}; }),
            status.implement({text: () => String(count.value)}),
        ]};
    },
})]);
```

- **`definePlugin({id, version, locations})`**：`const` 推导插件 id 的字面量。返回的对象：
  - `setting`、`settings`（等同现有 `defineSettings`）、`section`（list 分区，`category` 缺省 `plugins`）、`settingsPage`、`choices`、`view`、`command`、`statusItem`：只收短名 `name`，id 由 SDK 拼成 `<插件 id>.<name>`（设置项是 `<插件 id>/<name>`，与现在一致），类型上是字面量（A3）；
  - `descriptor(声明式贡献)`：插件描述，`contributions` 收设置项与分区等助手的返回值；
  - `entry(…)`、`definition(入口…)`：见下。
- **贡献助手的返回值**：`{id, contribution, implement(…)}`。`implement` 返回带贡献点与 id 的“已绑定实现”；没有实现的（list 分区、设置项）没有 `implement`。视图与设置页的 `implement(props?)` 同现有 `implementation(props?)`；命令的 `implement(run)`；状态栏条目的 `implement({text, tooltip?, state?})`。
- **`plugin.entry`**：`contributions` 收助手的返回值（也收现有的原始声明，供不在助手里的贡献点）；激活产出的 `contributions` 写成已绑定实现的数组，SDK 换成内核的 `{[贡献点]: {[id]: 实现}}`。类型核对：产出数组里的 id 集合恰好等于声明的 id 集合，缺的与多的各成一个以问题命名的属性（`缺少贡献实现：acme.hello.count`、`多写的贡献实现：…`），编译错误的第一行就写明缺哪一项（F10）。服务、远程服务、接收者的核对沿用内核 `defineEntry`；`entry.id` 缺省取运行位置名。激活上下文是 3.2 的收窄类型。
- **缺省值（A4）**：文字字段收 `string`（两种语言同一句）或 `LocalizedText`，助手里统一成 `LocalizedText`，线上的声明格式不变；状态栏条目 `alignment` 缺省 `right`、`order` 与 `priority` 缺省 0；视图 `location` 缺省 `sidebar`、`layout` 缺省 `scroll`；命令 `args` 缺省空对象 schema；`effect` 仍必填（只读模式拦截 Agent 的唯一依据，不猜）；状态栏条目的 `command` 可以直接给命令助手的返回值。
- **SDK 根入口去掉作者用不到的名字（F17 的取舍）**：`provide`、`providePerConsumer` 随改名换成新名；`defineServiceKey`、`defineStore`、`definePublicState`、`diagnosticsKey`、`hostClockKey`、`hostStateRootKey` 按 t13 已定保留（公开 API，补文档）。`/components` 已逐个列名（t13）。

### 3.4 记录 `packages/neuro-book/src/shared/storage.ts`（A5）

- `defineRecord` 的 `locality` 改为必填（类型与校验都要求），不再缺省 `local`。
- `schema` 是没写 `additionalProperties` 的对象时补成 `false`；显式 `true` 仍报错。
- 内置插件与示例里省略了 `locality` 的记录逐个补上（行为不变，补的就是原来的缺省 `local`）。

### 3.5 出错可见（A7）

- **插件页**（`src/plugins/plugins/`）：
  - 合同 `list` 的每项加 `displayName`、`description`（取清单）、`entries`（每个入口：运行位置、状态 `active | inactive | failed | blocked`、失败或受阻的一句原因）、`rejected`（被拒的贡献：贡献点、id、原因）。服务端入口的状态与被拒贡献由服务端宿主经插件管理给出（`inventory` 收一个读本实例插件状态的函数，宿主建它时传入）；浏览器入口的状态与被拒贡献由插件页在本窗口经 `window.plugins` 与内核查询补上；项目入口只列出“在作品里运行”，不显示状态（各作品一个实例，插件页不跨实例查询）。
  - 行里显示显示名与描述；有失败、受阻的入口或被拒的贡献时，行下面逐条列出（危险色），没有时不占位。外观按现有插件页的行与徽标，交 Sonnet 前端审查。
- **构建预设**（`src/plugin-platform/build/`）：插件描述的 `locations` 与实际有入口的运行位置不一致时构建失败，列出多的与少的（F13 的第二半；第一半“忘了 export”t13 S2c 已做）。
- 远程调用 `unavailable` 的原因见 3.2。

### 3.6 命令面板（A8，`src/plugins/workbench/web/` 的面板与 `nbook.commands`）

从命令面板执行命令失败时（`invalid-args`、`execution-error`、`unavailable` 等，`denied` 与用户取消确认除外）弹一条通知：命令标题与失败原因（`reason`）。`invalid-args` 的原因写明“这个命令需要参数，命令面板不收集参数”。不做参数表单。

### 3.7 作者文档与 `create`（A9）

- `plugin-sdk/README.md`：前置条件（怎样拿到能装插件的 NeuroBook、怎样重启，视图在作品窗口里才出现）；改用 3.3 的写法；订阅随入口停止自动释放，提前取消用订阅句柄；插件状态（`defineStore`）与公开状态（`definePublicState`）各一段；一段远程服务加订阅的完整代码（服务端提供、浏览器调用与订阅）；命令小节写明“给人用的命令参数要全部可选”；`ok`、`fail`。
- 模板与 7 个示例插件改用 3.3 的写法；示例的教学注释随之改，场景测试照跑。
- `create` 合并 `package.json` 时去掉 `npm init` 留下的占位：`main` 指向不存在的文件、`scripts.test` 是 npm 的缺省报错命令、空的 `keywords`。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `runtime/plugin-api.md` | `definePlugin` 与贡献助手、短名、缺省值、收窄的激活上下文、`provideService` 改名、SDK 根入口的名字 |
| `runtime/plugin-channel.md` | `ok`、`fail`；业务失败的详情按码检查；`input`、`filter` 自动补 `additionalProperties: false`；`unavailable` 的详情带原因 |
| `runtime/services.md`、`runtime/plugins.md` | `provide` 改名 |
| `storage/persistence.md` | `locality` 必填、schema 自动补 |
| `runtime/plugin-install.md` 与插件页所在的 Spec | `list` 的新字段；插件页显示显示名、描述、入口状态与被拒的贡献 |
| `runtime/plugin-code-loading.md` | 构建核对 `locations` |
| `workbench/commands.md` | 命令面板执行失败的通知 |
| ADR 0026、0027 | 不改（只是作者层的助手） |

## 5. 切片

| 片 | 内容 | 提交 | 自跑验证 |
|---|---|---|---|
| S1 | 3.1、3.2：`ok`/`fail`、按码的详情、合同自动补 schema、`provideService` 改名、`unavailable` 带原因；内置插件与示例跟上 | 一提交，Spec 同步 | 内核 `bun test`；应用 `bun run typecheck`、`bun run test` |
| S2 | 3.3：`definePlugin` 与助手、`plugin.entry` 的类型核对（含编译期的反例测试）、收窄的上下文 | 一提交 | 应用测试；类型反例用 `@ts-expect-error` |
| S3 | 3.4：记录 `locality` 必填与 schema 自动补 | 一提交 | 应用测试 |
| S4 | 模板与 7 个示例改用新写法；作者文档（3.7）；`create` 去占位 | 一到两个提交 | 应用测试、`plugin-sdk` 测试、`plugin-authoring`、`plugin-code` e2e |
| S5 | 3.5：插件页的入口状态、被拒贡献、显示名与描述；构建核对 `locations` | 服务端与合同一提交，界面一提交 | 插件页组件测试、`plugins` e2e、Lab 场景截图 |
| S6 | 3.6：命令面板失败通知 | 一提交 | 面板组件测试、命令 e2e |

## 6. 验收映射

| 判据 | 由什么覆盖 |
|---|---|
| 远程方法用 `fail("too-many", {max: 1})` 不写 `as const` 能编译；详情形状不对、码不在合同里编译报错 | 内核类型反例测试 |
| 合同的 `input` 没写 `additionalProperties` 时被补成 `false`，多余字段被拒 | 内核远程合同测试 |
| 提供入口激活失败时调用方的 `unavailable` 带错误消息 | 内核远程测试 |
| 助手拼出的 id 是 `<插件 id>.<name>`；产出漏一项、多一项编译报错，报错第一行写明哪一项 | SDK 类型测试 |
| 文字写字符串时两种语言相同；缺省值按 3.3 | SDK 单元测试 |
| `defineRecord` 不写 `locality` 编译报错并在加载时抛错 | 记录测试 |
| 插件页列出失败入口与原因、被拒贡献、显示名与描述 | 插件页组件测试、`plugins` e2e |
| 构建时 `locations` 与入口不一致失败 | 构建预设测试 |
| 命令面板执行参数不合规的命令弹出通知 | 面板测试 |
| 模板按新写法 `create`、构建、安装、运行 | `plugin-authoring` e2e |

## 7. 验证

每片跑上表的命令；S4、S5 结束跑插件相关的三份 e2e；收口前跑全量 e2e。作者体验的最终检验：S4 之后按作者文档在仓库外写一遍 t12 的“每日字数目标”插件（主会话自己做，不派子代理），核对 F02、F03、F05、F09、F10、F11、F16 不再出现。

## 8. 不做与风险

- 不做：插件描述由 `package.json` 生成（F15）；命令参数的输入表单；插件页跨作品实例查询项目入口的状态；`NumberInput` 的数值类型（F18）。
- 风险一：`plugin.entry` 的数组产出在类型上要按 id 集合核对，联合类型大时报错可能变长。S2 先写反例测试看报错的第一行，再定写法。
- 风险二：`RemoteOutcome` 按码分布后，现有提供方里不合的详情会编译报错，改动可能比预期多；按报错逐个改，不放宽类型。
- 风险三：示例是教学材料，改写面大；场景测试守住行为，注释随之改。
