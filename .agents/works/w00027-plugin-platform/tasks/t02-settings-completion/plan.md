# 实施计划：设置补齐（t02）

2026-10-20 起草；同日按 t07（低代码）的接口修订，开发者同意先做不依赖表单控件的切片（S0 的相关部分、S1、S6）。同日按可维护性的检查再修订（开发者同意）：密钥存储拆成独立的服务与远程合同，挪到 [t08](../t08-secret-store/plan.md)，主密钥丢失时显式重置、不分代次；按需激活改用内核上下文上通用的触发接口。同日开发者决定凭据先不做（t08 搁置）：API Key 用明文的普通配置项，`secret: true` 维持登记时被拒，本计划去掉全部密钥相关的内容。2026-10-21 t07 完成后按它实际的接口回改 S3、S4、S5、S7（见“前置”与各节），待开发者确认。

## Context

配置核心与设置窗口已实现（`settings/configuration.md`、`settings/settings-window.md` 均 `implemented`），但插件开始用配置以后暴露了几类缺口：数组、对象、多行文本只能只读；一组字段一起保存的页面没有保护；下拉选项只能写死；声明要接三处线、list 分区要交空实现；page 分区的插件只能启动即激活；配置一多找不到；不能直接看、改设置文件。旧应用的 provider 设置要在新设置里重建，正好需要其中好几样（见 [说明页](artifacts/settings-sections/index.html)）。

依据：
- Spec：[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)（输出 1、11、19、20 与“声明”“接口”两节）、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（输出 1–9、14、18）、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 输出 21（拥有者定义的激活事件）、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（激活上下文）。
- 开发者 2026-10-20 的决定：t02 提前到 t04 之前、不并行，在 Work 分支 `feat/w00027-plugin-platform` 上做；凭据先不做，API Key 用明文的普通配置项（起初定的方案 A 加密存储已撤回，见 [t08](../t08-secret-store/README.md)）；排版设置只做 Monaco，Markdown 正文留给 w00025；外观收口另在 t06；“低代码”做宽、整个项目共用一套，排在 t02 之前先实现。

## 前置：低代码（t07）

t02 不自己写控件，用 [t07](../t07-low-code-forms/README.md) 的 `@notnotype/nb-form`（行为合同 [`ui.forms`](../../../../../docs/specs/ui/forms.md)）。t07 已完成并合入 master（2026-10-21），下面是它实际交出、本计划要接的部分：

- 通用列表已改用 `SchemaField`（`bare`），`SettingsControl` 已删；适配器 `web/setting-form.ts` 把声明转成 `x-form`：`choices` → `x-form.choices`，`choices.from` → `x-form.options`（源名就是提供者 id），`ui` 照抄。结构字段合格才写、不合格的在行里写“还没保存：<原因>”也已在 t07 做完。
- 选项源：`SchemaField`、`SchemaForm` 收 `:options`（`FormOptionSources`，源名到 `OptionSource` 的映射，可以是 ref 或 getter）；`OptionSource` 是 `{status: "ready", items: [{value, label, description?, disabled?}]} | {status: "loading"} | {status: "unavailable", reason}`（输出 11、12）。现在设置窗口不传 `:options`，带 `from` 的项一律按“不可用”停用。
- 草稿：`SchemaForm` 的 `@draft-state`、`commit()`、`reset()` 与 `commit: "change" | "input"`（输出 15、16）；页面判断“有没有没保存的改动”用它们，不另写。
- JSON 控件是等宽文本框，按 JSON 解析：读不进注释，存回去会丢掉 JSONC 里的注释与格式，所以设置文件视图不用它（见“设置文件视图”）。

先后：S1、S6 已做；S3、S4、S5、S7 现在做。

## 关键设计

### 声明 API：`src/shared/settings.ts`

- `defineSettings(plugin, {name: options, …})`：一次声明一个插件的多条配置项，插件 id 只写一次。返回 `{settings: {<name>: SettingDefinition<Static<该项的 schema>>}, contributions}`：定义放在 `settings` 下，不和合法的配置名 `contributions` 撞。逐项的值类型由映射类型推出，有编译期样例（字符串、数、对象、字面量联合；错的 `default` 与 `update` 编译不过）。`defineSetting` 保留，两者校验与结果一致。
- 声明字段新增：`choices: {from: "<选项提供者 id>"}`；`ui`（`ui.forms` 的 `FormHints`）。登记期校验沿用输出 1、21：不合规则只拒绝这一条。`secret: true` 照旧以 `invalid-declaration` 被拒。`SettingsService` 与 `nbook.settings/user`、`nbook.settings/project` 两份合同都不变。

### 分区：`settings.sections` 拆成两个贡献点

现在 list 分区要在浏览器入口里贡献，激活后还要交一个空对象，只因为贡献点要求实现。改为：

- `settings.sections`：只放 list 分区，**顶层声明式贡献**（写在描述的 `contributions` 里，`implementation: "none"`）。服务端、项目实例、浏览器三处的 `nbook.settings` 定义都登记这个贡献点（同 `settings.properties`），三处都接受、都知道全部 list 分区；校验函数放 `shared/`，不再要求 `location === "browser"`。list 的字段：`title`、`description`、`icon`、`category`、`order`、`groups`；不收 `layout`、`layers`。
- `settings.pages`：page 分区，只接受浏览器入口的贡献，实现是 `{load()}`；字段：`title`、`description`、`icon`、`category`、`order`、`layout`、`layers`、`keywords`（搜索用，S4）。
- 分区 id 的写法与前缀规则不变（`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头）。
- 设置窗口把两者合并成左栏：list 只看声明（没有入口状态），page 才接交付句柄与入口状态（`sections.ts` 的目录拆成静态 list 与 page 接收者两部分）。两个贡献点上出现同一个分区 id 时（内核按贡献点分别去重，不跨点查重），这个 id 的分区都不显示，记诊断，指向它的配置项按“分区不存在”落到“其它”；与登记顺序无关。
- 迁移（都在 S1 做完，不留到后面）：外观（`nbook.settings`，声明从 `web/plugin.ts` 挪到 `shared/`，描述不反向依赖浏览器代码）、编辑器、资源管理器的 list 分区搬到描述；作品、插件、示例 snippets 改用 `settings.pages`；Lab 的设置场景局部宿主（`settings-host.ts`、`scene-data.ts`）与复用它的组件测试改成新协议，15 个场景照常可用。

### 页面拿到配置服务：`src/plugins/settings/web/contracts.ts`

新增 `settingsPage(settings, () => import("./Page.vue"))`：返回 page 实现，`load()` 交出的组件除 `context` 外还收到 `settings`（本插件自己的配置服务）。示例里手写的 `withSettings` 包装删掉。

`SettingsPageContext` 加 `dirty(value: boolean)`，见“未保存保护”。

### 按需激活：内核上下文 `ctx.activation.trigger`

- `nbook.settings` 的浏览器插件定义登记激活事件前缀 `onSettingsPage`（插件定义的 `activationEventPrefixes`，不是入口字段）。
- 触发的出口是通用的：每个入口的激活上下文加 `ctx.activation.trigger(event, {signal?})`，两端都有，内核把 `requester` 绑成这个入口所属的插件，内部调 `triggerActivationEvent`；只有前缀的拥有者能触发（`runtime/plugins.md` 输出 21 已有的核对），别的插件调用得到 `rejected {reason: "not-prefix-owner"}`。以后的激活事件（例如 Agent 工具、命令）照用，不再给每个宿主能力单开触发口。`window.plugins` 不变。
- 触发口跟着入口的这一次激活走：内核在构造激活上下文时捕获这次激活，入口停止后（包括同一插件 id 之后重新登记）再调用，返回 `rejected {reason: "requester-stopped"}`，不枚举、不激活任何入口；调用方的 `signal` 与入口的停止信号合并，任一触发都只结束等待。只绑插件 id 不够：审查实测，旧上下文在同 id 重新登记后仍能触发。
- 触发前先看这个 page 分区所属的入口是否声明了 `onSettingsPage:<分区 id>`：没有就直接是 `entry-not-activatable`，不触发（事件参数只是字符串，内核不会把它和分区的入口对上，别的入口可能也声明了同一个事件）。
- 时机：设置窗口显示一个 page 分区、它所属入口处于“已登记未激活”且声明了这个事件时，触发 `onSettingsPage:<分区 id>`；每次进入这个分区都可以触发，内核把同一代次的激活合并成一次（审查实测：重复触发只激活一次）。等待中离开或关窗口，激活照常完成，不取消；再进入时按当时的状态呈现。
- 分区的状态只跟着它自己的入口走，不等整个事件的结果：触发之后看这个入口的状态（激活中 → 等交付句柄，现有路径；失败、受阻 → 现有的 `entry-failed`、`entry-blocked`，失败经现有的“重试”恢复）。别的入口也监听同一事件、激活一直不结束，不影响这个分区。触发被拒（`not-prefix-owner`、`requester-stopped` 等）→ `entry-not-activatable`，原位写“插件没有声明打开分区时激活”，记诊断。触发的整体结果只用于诊断。
- 入口同时声明 `onStartup` 时启动就激活，`onSettingsPage` 不改变它。
- 示例 snippets 与 Lab 的“模型服务”改用它。验收从 `nbook.settings.open` 打开窗口、切到分区驱动，不在测试里直接调内核触发；Lab 的内存场景只验界面状态，激活另用真实内核的场景验。`ctx.activation.trigger` 自己的合同在 nb-runtime 的测试里两端各验：绑定调用方、非拥有者被拒、同一插件两个入口、入口停止前后的竞态、旧上下文在同 id 重新登记之后调用。设置窗口另验：只有别的入口声明了事件、目标入口成功而另一个监听者一直挂起、关闭后再打开、受阻解除后重新触发。

### 凭据（不做）

开发者 2026-10-20 决定凭据先不做：没有加密的需求，API Key 写成普通的字符串配置项，明文存在 `settings.json`，浏览器能读到值，设置窗口里是普通输入框（可以用 `x-form` 的 `widget` 换成遮住字符的显示，只是界面）。`secret: true` 维持登记时被拒。存储方案的调研与重开时的起点见 [t08](../t08-secret-store/README.md)。

### 动态选项

浏览器入口可以贡献选项提供者：贡献点 `settings.choices`（拥有者 `nbook.settings`，只在浏览器登记），贡献 id 是提供者 id（写法与前缀规则同分区 id），实现是 `{source(): MaybeRefOrGetter<OptionSource<string>>}`，直接用 nb-form 的 `OptionSource`：提供者自己的数据要取（例如向服务商要模型列表）时，它自己报加载中、不可用，设置层不再加一层形状转换。

- 设置层（`web/choice-sources.ts`）按提供者 id 合成 `FormOptionSources`：提供者已交付 → 用它给的源；声明了、入口未激活或正在激活 → `loading`；没有这个贡献、入口受阻或失败 → `unavailable`，原因写“选项来源 X 不可用”。`source()` 抛错或给出不合形状的值 → `unavailable`，记诊断。每个提供者只调一次 `source()`（按交付句柄缓存），句柄换代时重取。
- 按需激活：提供者所在的入口可以声明 `onSettingsChoices:<提供者 id>`；窗口要画一项带 `from` 的配置时触发它（同 `onSettingsPage` 的做法，复用 S1 的触发与核对；没声明就保持 `loading` 直到入口按自己的事件激活）。
- 通用列表把合成的映射交给每个 `SchemaField` 的 `:options`；page 页面经 `context.options`（`SettingsPageContext` 新字段，同一个映射）拿到，自己的 `SchemaField`、`SchemaForm` 照传。
- 当前值不在选项里时按 `ui.forms` 输出 12 显示“已不存在”，值保留；值的校验仍只看 schema。

### 未保存保护

page 页面经 `context.dirty(value)` 告诉窗口有没有未保存的改动（用 `SchemaForm` 的页面按 `@draft-state` 与自己的草稿判断，nb-form 不替它判断）。窗口在关闭（关闭按钮、`Esc`、再执行 `nbook.settings.open` 跳到别的分区）、切分区、切标签之前，若当前页面报了脏，弹 nb-ui 的 `AlertDialog`“放弃未保存的改动？”（“放弃”“继续编辑”，焦点默认在“继续编辑”）；放弃后照常离开（页面卸载，草稿丢弃），取消则留在原处、焦点回到触发的位置。页面卸载、重建时窗口把脏标记清掉，页面保存成功后调 `context.dirty(false)`。

- 刷新与关页面不拦：设置窗口不挂 `beforeunload`（工作台已有的离开保护只管编辑器正文）。
- list 分区不涉及：每项即时写入；结构字段留在行里的不合格值（t07）不算脏，离开时照旧丢掉。

### 搜索

窗口左栏上方一个搜索框（nb-ui `Input`，`type="search"`，`Mod+F` 在窗口里聚焦它）。匹配不分大小写、按空格分词、每个词都要命中：list 分区里配置项的标题、说明、键与静态选项名（两种语言都比），以及 page 分区的标题、说明与声明里新增的可选 `keywords`（`LocalizedText` 数组）。动态选项的选项名不参与（要激活提供者）。

- 有输入时右边换成结果视图：`settings-window.ts` 给出 `kind: "list"`、`id: "search"` 的视图，每个命中的分区一组（组标题是分区名），直接复用 `SettingsListSection`，每条照常可以改；只列当前标签这一层可编辑的项。page 分区的命中另列在后面，每条一个“打开”按钮，点了清空搜索并切到这个分区。没有命中时写“没有找到设置”。
- 左栏在搜索时保持原样、当前项不高亮；清空搜索（清除按钮或 `Esc`，`Esc` 在框里有内容时只清空、不关窗口）回到原分区。
- 搜索词不记、关窗口即清；未保存保护照样适用（从脏页面开始搜索先确认）。

### 设置文件视图

窗口给当前标签那一层一个“设置文件”视图：左栏“其它”下面固定一项“设置文件（JSON）”（窗口自己的，不是贡献，样子在 t06 再收），右边是这一层文件的全文。

- 远程合同 `nbook.settings/user`、`nbook.settings/project` 加两个方法（合同升到 version 2，两份同时升，方法与事件仍相同）：`readText() → {text, revision}`；`writeText({text, revision}) → {revision}`。`revision` 是拥有者给文件内容算的标识（内容哈希），文件不存在时是固定值、`text` 为空串。写入只经用户编辑路径（同 `userEdit` 的调用方核对），在拥有者的串行队列里：先比 `revision`，不同返回 `conflict`；再按读取同一套检查解析（`parseLayerText`）：解析失败、根不是对象、重复键返回 `invalid-text`，带行列；未声明的键照常留在文件里；不合 schema 的键不拒（同手改文件，按输出 13 报问题）。通过才原样落盘，随后照常发布层快照。
- 编辑控件：nb-ui `Textarea`，等宽、关掉拼写检查，`Tab` 插入两个空格（`Esc` 后 `Tab` 照常移焦点）。不用 nb-form 的 JSON 控件（会丢注释，见“前置”）；不用 Monaco（在编辑器插件里，设置插件在运行时只能引用别的插件的 `shared/contracts.ts`，为一个文本框新开跨插件的编辑器接口不值得）。语法高亮不做。
- 交互：打开时读一次；有改动时底部显示“保存”“放弃改动”，`Mod+S` 保存；保存失败把原因（含行列）写在文本框下面一行，`conflict` 写“文件在别处改过了”并给“重新读取”（丢掉这里的改动）。没改动时层快照变了就自动重读；有改动时不覆盖，只提示“文件在别处改过了”。有改动时算作脏，离开走未保存保护。
- 层 `invalid` 时照样可以打开、修好、保存：这正是修文件的入口（输出 13 的说明里加“打开设置文件”的链接）；`unavailable` 时停用。
- 用户层的文件在状态根下、浏览器拿不到路径，也走这条路；视图只显示内容，项目层另显示文件路径（层快照带）。

### Monaco 排版设置：`src/plugins/editor/`

编辑器插件用 `defineSettings` 声明（编辑器分区，新小组“代码编辑器”）：`code.fontFamily`（字符串，空为跟随主题）、`code.fontSize`（整数 8–40，缺省 14）、`code.lineHeight`（数，0 为自动）、`code.tabSize`（整数 1–8，缺省 4）、`code.detectIndentation`（布尔，缺省开：按文件内容推测缩进，推测不出时用 `code.tabSize`；关掉时一律用 `code.tabSize`，同 VS Code）、`code.lineNumbers`（开、关、相对）、`code.minimap`（布尔，缺省关）、`code.wordWrap`（布尔，缺省开）。`MonacoControl.vue` 创建编辑器时读这些值，变化时 `editor.updateOptions`，不重建编辑器；缩进的两项同时应用到已有的模型（含停放的、切回来的）。验收看模型实际的 `getOptions().tabSize` 与 Tab 的输入效果，用已含 2 空格、4 空格与制表符缩进的文件，切走再切回一致（审查第 13 条）。

### 资源管理器“显示清单文件”（不做）

原计划把 `showManifests` 从按客户端的本地记录迁成配置项。审查指出迁移要在多个客户端之间仲裁（第 12 条），而它本来就是按客户端记的显示偏好，迁过去收益小，本轮不做，保持现状。

### Lab 的“模型服务”示例：`src/plugins/lab/web/fixtures/settings-scene/`

补成验证这些能力的样子（现在的服务商是写死的示例数据）：服务商列表存成一个对象数组配置项，每项有 id、名称、地址、超时、API Key（普通的字符串字段，`x-form.widget: "secret"`，在 nb-form 做好密钥输入之前按文字画）、模型名列表；左边 `SettingsPageList` 列服务商、可以新增与删除，右边是选中服务商的 `SchemaForm`，草稿加“保存”“放弃”，用 `context.dirty`。“默认模型”是动态选项：同一插件贡献 `settings.choices` 提供者，选项来自已保存的服务商的模型；删掉一家后默认模型标“已不存在”。入口用 `onSettingsPage` 激活。外观不在本轮定。

## Spec 与文档改动

- `settings/configuration.md`：声明字段（`choices.from`、`ui`）与 `defineSettings`（S1 已改）；远程合同 v2 的 `readText`、`writeText` 与失败码 `conflict`、`invalid-text`（S5）。密钥（输出 20）保持 planned，不改。
- `runtime/plugin-api.md` 的激活上下文加 `ctx.activation.trigger`；`runtime/plugins.md` 输出 21 写明插件经它触发、`requester` 由内核绑定。
- `settings/settings-window.md`：分区拆分与按需激活（S1 已改）、输出 9 的控件（t07 已改）；新增：选项提供者贡献点 `settings.choices` 与输出 9 里动态选项的 planned 去掉（S3）、页面上下文的 `dirty` 与 `options`（S3、S4）、未保存保护与搜索（S4）、设置文件视图（S5）的输出条目，“不承诺”删去搜索与“打开设置文件的按钮”。
- 组件文档：`SettingsWindow.md`、`SettingsListSection.md`、`SettingsPageFrame.md`（脏标记），新的设置文件视图组件的同名 `.md`。
- `examples/README.md` 与示例 snippets 的讲解：`defineSettings`、`settingsPage`、`onSettingsPage`。

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S0 | 改两份设置 Spec、plugin-api 与 plugins：现在只改 S1、S6 涉及的条目，其余随各自的切片改 | Spec 改动 | `docs:check` |
| S1 | 声明 API 与分区拆分（含全部内置分区、示例、Lab 局部宿主与组件测试的迁移）、`settingsPage`、按需激活（含 `ctx.activation.trigger`） | 声明 API；分区；页面拿到服务；按需激活 | 设置的合同测试、`sections.test.ts`、`SettingsWindow.dom.test.ts`、示例场景测试、nb-runtime 的触发测试、真实内核的按需激活场景；`settings.e2e.ts` |
| S3 | 动态选项（贡献点、合成选项源、`onSettingsChoices`、`context.options`） | 前置；动态选项 | `choice-sources` 测试、`SettingsWindow.dom.test.ts`、真实内核的按需激活场景、Lab 截图 |
| S4 | 未保存保护、搜索 | 未保存保护；搜索 | `settings-window` 的搜索测试、`SettingsWindow.dom.test.ts`、Lab |
| S5 | 设置文件视图（合同 v2、拥有者的 `readText`、`writeText`、视图组件） | 设置文件视图 | `layer-owner.test.ts`、`layer-text.test.ts`、远程合同测试、Vitest |
| S6 | Monaco 排版设置 | Monaco | 编辑器测试；Lab 或 e2e 里看模型实际的缩进 |
| S7 | Lab“模型服务”示例、e2e | Lab 示例 | `settings.e2e.ts` 扩充、`lab-scenes` |

每片一个提交，在 Work 分支上；S1 之后交 omp 审查（声明 API、分区拆分、按需激活），S7 之后再一轮：S5 的合同与拥有者交 omp，S3、S4、S5 的界面与 S7 交 Sonnet。原来的 S2（密钥存储）已撤销，编号空着不复用。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| configuration 输出 1、21（新字段的登记期校验） | `src/shared/settings.test.ts` 表驱动 |
| configuration `readText`、`writeText` | 拥有者测试（修订号冲突、解析失败与重复键不落盘且带行列、注释与未声明的键原样保留、与单键写入在同一队列里不互相覆盖、非拥有者调用被拒） |
| settings-window 分区拆分与左栏 | `sections.test.ts`、`SettingsWindow.dom.test.ts` |
| settings-window 按需激活 | 经真实内核的测试：显示分区前入口未激活，显示后激活并加载 |
| settings-window 动态选项 | 提供者三态（未激活、已交付、受阻）各自的显示；`onSettingsChoices` 经真实内核激活；当前值不在选项里时标“已不存在” |
| settings-window 搜索、未保存保护、设置文件视图 | `SettingsWindow.dom.test.ts`：搜到一项并改掉、清空回原分区、page 命中跳转；脏页面切分区 / 切标签 / `Esc` 弹确认、取消留下、放弃离开；设置文件改一个键保存后列表同步、冲突提示、`invalid` 层经它修好 |
| Monaco 排版设置 | 编辑器测试：改配置后 `updateOptions` 生效、编辑器不重建 |
| 组合场景 | `e2e/settings.e2e.ts`：页面草稿离开时确认、搜索到一项并改掉、设置文件视图改一个键后窗口同步 |
| Lab“模型服务” | 新增两家服务商并各填 API Key，调整顺序、删除一家后其余各项不串 |

## 验证

- 每片自跑上表；全部完成后跑应用 `bun test`、Vitest、typecheck、`docs:check`、`governance:check`，以及 settings、plugins、browser-host 三组 e2e（直接跑 Playwright 前先 `build`、`build:e2e`）。
- 截图看 Lab 里的设置窗口各场景（list、搜索、动态选项、设置文件视图、“模型服务”）。

## 不做与风险

- 不做：凭据的加密存储与 `secret: true`（t08 搁置）；本机层（输出 22）；按层过滤；资源管理器“显示清单文件”迁成配置项（见上）；设置界面的外观（t06）；Markdown 正文排版（w00025）；真正的 provider 插件（随 Agent 与模型插件重建）。
- 风险：
  - `ctx.activation.trigger` 是新的通用内核接口：每个入口都拿得到，靠内核已有的前缀拥有者核对限权；以后的激活事件都走它。
  - `settings.sections` 拆分改动已实现的贡献点：内置 3 个 list、3 个 page、示例与 Lab 都在 S1 一起改。

## 设计审查的处理（2026-10-20）

omp 设计审查（`evidences/design-review-omp.txt`）17 条：阻断 5、重要 11、建议 1，都成立。处理：

- 密钥（第 1、2、4、6、10、11、17 条）：主密钥分代次、旧密文保留；初始化与读改写在同一把跨进程锁里、持锁后重读；显式指定 Secret Service 后端、不退到 keyutils；访问密钥库放进有截止、可杀的子进程；普通层拒收密钥、错误只给固定码；普通项与密钥项分两种定义、状态加 `unknown`、替换也通知；格式逐字段写定、AAD 绑定配置键、密钥库账号用随机 id 记在文件里。其中分代次、`SettingsService` 上的密钥接口与合同 v2 已被“可维护性修订”取代，其余各条随密钥挪到 t08，后来 t08 搁置。
- `readSecret` 的调用方（第 3 条）：不收窄合同，拥有者按原调用方的 `location` 核对（随密钥挪到 t08）。
- 按需激活（第 5、9 条）：前缀登记在插件定义上；受限的触发口（后改为通用的 `ctx.activation.trigger`）；结果按所属入口取，无人声明时有终态。
- 分区拆分（第 7、8、16 条）：三处都登记 list、校验挪到 `shared/`、跨贡献点同 id 由拥有者查重、迁移在 S1 做完。
- 显示清单文件（第 12 条）：本轮不做。
- Monaco（第 13 条）：加 `code.detectIndentation`，验收看模型实际的缩进。
- 与 t07 的接口（第 14 条）、`defineSettings` 的返回形状与类型（第 15 条）：见“前置”“声明 API”。

## 可维护性修订（2026-10-20）

开发者同意的四条（前三条随 t08 搁置作废，只留第四条）：

- 密钥不加进 `SettingsService`，改成独立的服务 `secretsKey` 与远程合同 `nbook.settings/secrets`（t08）：配置服务与它的两份合同不升版本，层快照不再分 user、project 两种 schema；调用方核对、不泄漏、存储状态都只在密钥服务里。
- 主密钥不分代次：只有一把，丢失时整个存储“无法解密”，由用户显式重置（t08）。分代次要为每条密文记主密钥、保留旧代次与它们的位置信息，换来的只是“丢一把不影响别的”，而丢失本来就少见。
- 访问密钥库的子进程脚本是单独的构建产物，同项目子进程的 `project.js`，由 `check:dist` 与打包 smoke 覆盖（t08）。
- 按需激活的触发是内核上下文上的通用接口，不是只给设置窗口开的宿主能力（见“按需激活”）。

## 第二次设计审查的处理（2026-10-20）

凭据不做之后，下面第 3、12 条与“`unknown` 的显示”随之作废，只留激活两条。t02 修订版与 t08 一起审（[t08 的 evidences/design-review-omp.txt](../t08-secret-store/evidences/design-review-omp.txt)，15 条，都成立）。落在 t02 的四条：

- 设置文件视图把人工写入的密钥原文发给浏览器（第 3 条）：`readText` 遇到密钥键只给键名与位置，另给 `removeKeys`；`writeText` 拒收密钥键。见“设置文件视图”。
- `ctx.activation.trigger` 的寿命（第 5 条）：跟着入口的这一次激活，停止后返回 `requester-stopped`。见“按需激活”。
- 分区所属入口没声明事件、别的入口声明了（第 10 条）：触发前先看所属入口；分区状态只跟着它自己的入口。见“按需激活”。
- 多家服务商的凭据（第 12 条）：Lab 用固定的几家、每家一个预先声明的密钥项；动态的凭据集合不在本轮。（作废：凭据不做，API Key 是服务商对象里的普通字段。）
- `unknown` 在设置窗口里的显示与“重新检查”（第 13 条的界面部分）：见“密钥”。

