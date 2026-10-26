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

浏览器入口可以贡献选项提供者。

- **贡献点** `settings.choices`（拥有者 `nbook.settings`，只在浏览器定义里登记，`implementation: "required"`，声明 `{}` 关闭额外属性）。校验 `validateChoiceContribution` 放 `shared/sections.ts`，与分区共用 `idProblem`（点分小写段、贡献者前缀：`nbook.*` 写 `nbook.<名>`，其它插件以自己的 id 加 `.` 开头），并只接受浏览器入口的贡献；不合格只拒这一条。贡献 id 就是提供者 id，也就是声明里 `choices: {from}` 写的值。常量 `SETTINGS_CHOICES_POINT`、`SETTINGS_CHOICES_ACTIVATION_PREFIX = "onSettingsChoices"`、`settingsChoicesEvent(id)` 从 `shared/contracts.ts` 导出。
- **实现**：`{source(): MaybeRefOrGetter<OptionSource<string>>}`，直接用 nb-form 的 `OptionSource`（提供者自己的数据要取时自己报加载中、不可用）。`ui/settings/` 加 `settingsChoices(source)` 小工具，同 `settingsPage` 的用法。
- **设置层**（`web/choices.ts`，`ChoiceSourceRegistry`，做法照 `web/sections.ts` 的 page 注册表）：目录来自已接受的声明；接收者记交付句柄；入口状态经 `window.plugins`。对外给一份**稳定的** `FormOptionSources`：每个提供者 id 一个 `computed`，它读当前句柄与入口状态：
  - 句柄 published → 安全求值：`source()` 每个句柄只调一次并缓存，返回值每次求值都经 `toValue` 包在 try 里，再校验形状（三态之一；`items` 的 `value` 是字符串、`label` 是字符串或多语言文字、可选字段类型对）。抛错或形状不对 → `unavailable`（原因“选项来源 X 出错”），同一句柄同一种问题只记一次诊断。
  - 声明了、入口已登记未激活或正在激活 → `loading`；没有这条贡献（声明里引用了不存在的 id）、入口受阻、失败、已停止、句柄撤回 → `unavailable` 并写原因。
  - 句柄换代时丢掉旧缓存，旧句柄的结果不再被读；映射对象在窗口一生中不变，page 页面拿到的就是它。
- **按需激活**：`nbook.settings` 浏览器定义的 `activationEventPrefixes` 加 `onSettingsChoices`。窗口里有一项带 `from` 的配置被画出时（`SettingsListSection` 渲染该项、page 页面读 `context.options[id]`，都经映射的 `computed` 被读到），注册表在第一次读到 `loading` 且入口处于“已登记未激活”、入口声明了 `onSettingsChoices:<id>` 时经 `ctx.activation.trigger` 触发一次；同 S1：入口没声明这个事件（它不会因此激活）或触发被拒 → `unavailable`，原因写“插件没有声明打开设置时提供选项”，记诊断。触发在 `computed` 之外排进微任务，不在求值里改状态。
- **交给表单**：通用列表把映射交给每个 `SchemaField` 的 `:options`；`SettingsPageContext` 加只读的 `options: FormOptionSources`（同一份映射）。
- 当前值不在选项里时按 `ui.forms` 输出 12 显示“已不存在”，值保留；值的校验仍只看 schema。

### 未保存保护

- **报告**：`SettingsPageContext` 加 `dirty(value: boolean)`。页面自己判断有没有没保存的改动：按“已保存的值 + 当前草稿”比较整个值（列表的增删排序经 `update:modelValue` 直接给出新值，不进 `draft-state`），`draft-state` 只补“有解析不了的输入”。nb-form 不替页面判断。
- **上下文按挂载分代**：每次页面组件挂载（进入分区、重新加载、渲染重试）窗口给一份新的上下文，`id`、`layer`、`projectTitle`、`options` 与之前相同，`dirty` 绑着这一次挂载；页面卸载后旧上下文的 `dirty` 调用一律忽略，脏标记随卸载清掉。输出 6 的“切换标签页面不重建、`context.layer` 变化”不变。
- **离开**：窗口模型把会离开当前页面的动作收成一个 `requestLeave(target)`：切分区、切标签、关闭（关闭按钮、`Esc`）、`nbook.settings.open` 改了分区或标签、在搜索框输入第一个字。当前页面不脏 → 立即执行；脏 → 记下目标、弹 nb-ui `AlertDialog`“放弃未保存的改动？”（“放弃”“继续编辑”，焦点默认在“继续编辑”）。对话框开着时又来一个离开请求，目标换成新的（后到的赢），不叠第二个对话框。放弃 → 执行记下的目标；取消 → 留在原处、焦点回到触发的位置。
- **拦不住的**：页面所属入口停止或撤回（交付失效）、窗口所属入口释放（`dispose`）、刷新或关闭浏览器页面。这些照现在的做法卸载页面，改动丢失，不弹确认；Spec 写明。工作台已有的 `beforeunload` 只管编辑器正文，设置窗口不另挂。
- list 分区不涉及：每项即时写入；结构字段留在行里的不合格值（t07）不算脏，离开时照旧丢掉。设置文件视图有改动时也算脏（见下）。

### 搜索

- **入口**：左栏上方一个搜索框（nb-ui `Input`，`type="search"`）。`Mod+F` 只在设置窗口的根元素上处理（事件冒泡到窗口根、不是输入法组合中）：`preventDefault` 并聚焦搜索框；焦点在窗口外时不拦，浏览器与编辑器照旧。
- **匹配**：不分大小写、按空白分词、每个词都要命中。list 分区里配置项的标题、说明、键与静态选项名（两种语言都比）；page 分区的标题、说明与新增的可选声明字段 `keywords`（`LocalizedText` 数组，至多 20 个、每个非空；写进 `SettingsPageDeclarationSchema`、Spec 的“分区声明”，坏的只拒这一条）。动态选项的选项名不参与（开发者已定）。
- **结果**：有输入时右边换成结果视图：`settings-window.ts` 给出 `kind: "list"`、`id: "search"` 的视图，每个命中的分区一组（组标题是分区名），复用 `SettingsListSection`，每条照常可以改；只列当前标签这一层允许的项（同输出 12）。page 分区的命中只列当前标签下可用的（同输出 8），在后面各给一个“打开”按钮，点了清空搜索并切到这个分区。没有命中时写“没有找到设置”。`SettingsListSection` 以搜索词作 `key`：换词即重建，留在行里的不合格值随之丢掉（同“换分区”）。
- **左栏与退出**：搜索时左栏保持原样、当前项不高亮；清空搜索（清除按钮，或焦点在搜索框、框里有内容时按 `Esc`；框空时 `Esc` 照输出 17 关窗口）回到原分区。搜索词不记，关窗口即清。从脏页面开始搜索先走未保存保护。

### 设置文件视图

窗口给当前标签那一层一个“设置文件”视图：左栏“其它”下面固定一项“设置文件（JSON）”（窗口自己的，不是贡献，样子在 t06 再收），右边是这一层文件的全文。

- **失败码**：`SETTINGS_FAILURES` 加 `read-failed`（文件存在但读不了）、`conflict`（文本修订号对不上）、`invalid-text`（文本不是合格的配置文件）。它们是配置的领域失败码，经远程的 `settings-failed` 带回，`remote-link` 的折算、命令失败映射与窗口的原因文案一起补；`invalid-text` 的详情另带位置 `{line, column}`（从 1 起）。
- **远程合同 version 2**（`nbook.settings/user`、`nbook.settings/project` 同时升，方法与事件仍相同）：
  - `readText() → {text, revision, exists}`；读不了 → `read-failed`。`revision` 是原始字节的 SHA-256（十六进制），不存在时 `exists: false`、`text: ""`、`revision` 为空字节的摘要。与层快照的 `{boot, seq}` 无关：后者按解析结果变，只改注释、格式时不变。
  - `writeText({text, revision}) → {revision, snapshot}`：只经用户编辑路径（与 `userEdit` 同样核对调用方，别的一律 `denied`）。排进拥有者的串行队列，经 `writeLayerFile` 在锁里执行：当前字节的摘要不等于 `revision` → `conflict`；按 `parseLayerText` 的检查不过（语法、根不是对象、重复键）→ `invalid-text` 带位置；未声明的键原样留下；不合 schema 的键不拒（同手改文件，按输出 13 报问题）。通过才原样落盘，随后照常发布层快照。
  - 新事件 `text`：载荷 `{revision}`，原始文本变了就发（监视重读与任何写入之后），只改注释、格式也发；`layer` 事件的“格式变化不发布”不变。拥有者在同一队列里维护当前文本摘要。
  - `parseLayerText` 的失败改为结构化 `{detail, position}`：语法错误给出错位置，根不是对象给根节点位置，重复键给第二次出现的属性位置；层 `invalid` 的说明与诊断沿用文字，另带位置。
  - 打包 smoke（`scripts/smoke-server.ts`）里手写的 `version: 1` 帧改为 2，加一次 `readText`、一次修订号不对的 `writeText`；盘点仓库里所有按字符串写的 `nbook.settings/user`、`nbook.settings/project` 调用。Lab 的内存层（`memory-layers.ts`）与测试替身同样补上三样。
- **编辑控件**：nb-ui `Textarea`，等宽、关掉拼写检查，`Tab` 插入两个空格（`Esc` 后 `Tab` 照常移焦点）。不用 nb-form 的 JSON 控件（会丢注释）；不用 Monaco（开发者已定）。
- **交互**：打开时读一次；`read-failed` 或层 `unavailable` 时文本框只读、写出原因，不给保存。有改动时底部显示“保存”“放弃改动”，`Mod+S` 保存；保存失败把原因写在文本框下面一行（`invalid-text` 写“第 N 行第 M 列：…”），`conflict` 写“文件在别处改过了”并给“重新读取”（丢掉这里的改动）。收到 `text` 事件：没有改动 → 自动重读；有改动 → 只提示“文件在别处改过了”。有改动时算作脏，离开走未保存保护。
- 层 `invalid` 时照样可以打开、修好、保存：这正是修文件的入口（输出 13 的说明加“打开设置文件”的链接）。
- 用户层的文件在状态根下、浏览器拿不到路径，也走这条路；视图与错误文案不出现用户层的绝对路径，项目层另显示文件路径（层快照带）。

### Monaco 排版设置：`src/plugins/editor/`

编辑器插件用 `defineSettings` 声明（编辑器分区，新小组“代码编辑器”）：`code.fontFamily`（字符串，空为跟随主题）、`code.fontSize`（整数 8–40，缺省 14）、`code.lineHeight`（数，0 为自动）、`code.tabSize`（整数 1–8，缺省 4）、`code.detectIndentation`（布尔，缺省开：按文件内容推测缩进，推测不出时用 `code.tabSize`；关掉时一律用 `code.tabSize`，同 VS Code）、`code.lineNumbers`（开、关、相对）、`code.minimap`（布尔，缺省关）、`code.wordWrap`（布尔，缺省开）。`MonacoControl.vue` 创建编辑器时读这些值，变化时 `editor.updateOptions`，不重建编辑器；缩进的两项同时应用到已有的模型（含停放的、切回来的）。验收看模型实际的 `getOptions().tabSize` 与 Tab 的输入效果，用已含 2 空格、4 空格与制表符缩进的文件，切走再切回一致（审查第 13 条）。

### 资源管理器“显示清单文件”（不做）

原计划把 `showManifests` 从按客户端的本地记录迁成配置项。审查指出迁移要在多个客户端之间仲裁（第 12 条），而它本来就是按客户端记的显示偏好，迁过去收益小，本轮不做，保持现状。

### Lab 的“模型服务”示例：`src/plugins/lab/web/fixtures/settings-scene/`

补成验证这些能力的样子（现在的服务商是写死的示例数据）：

- 配置项：`providers`（对象数组，每项 id、名称、地址、超时、API Key、模型名列表；API Key 是普通字符串字段，`x-form.widget: "secret"`，在 nb-form 做好密钥输入之前按文字画）与 `defaultModel`（字符串，`choices: {from: "example.models.models"}`）。两项都 `layers: ["user"]`（连接信息与凭据不进作品目录，configuration.md 的作者规则），page 的 `layers` 也只写 `user`。
- 页面：用 nb-form 的 `SchemaForm` 把 `providers` 画成左列表右详情（`x-form.widget: "master-detail"`，增删、上移下移、焦点与身份都由 nb-form 管），替掉现在写死的 `SettingsPageList`；页面维护“已保存的值 + 草稿”，任何 `update:modelValue` 都与已保存值比较后报 `context.dirty`；底部“保存”“放弃”，放弃时 `reset()` 并换回已保存的值；保存成功以写回后的值作新的基准。
- “默认模型”：同一插件贡献 `settings.choices` 提供者 `example.models.models`，选项来自已保存的服务商的模型（`服务商 / 模型`），没有服务商时为 `ready` 的空列表；删掉一家后默认模型标“已不存在”。
- 入口用 `onSettingsPage` 与 `onSettingsChoices` 激活。外观不在本轮定。
- **Lab 局部宿主**（`settings-host.ts`）补上：选项提供者目录与交付句柄；入口的 `activationEvents` 来自场景，触发由场景处理（收到触发后交付），新增“打开前未交付、打开后交付、撤回后不可用”的场景。真实时序另由真实内核的测试覆盖（见验收映射），Lab 的结果不当作远程合同与文件写入的验收。

## Spec 与文档改动

- `settings/configuration.md`：声明字段（`choices.from`、`ui`）与 `defineSettings`（S1 已改）；远程合同 v2 的 `readText`、`writeText`、`text` 事件，失败码 `read-failed`、`conflict`、`invalid-text`，层 `invalid` 的位置（S5）。密钥（输出 20）保持 planned，不改。
- `runtime/plugin-api.md` 的激活上下文加 `ctx.activation.trigger`；`runtime/plugins.md` 输出 21 写明插件经它触发、`requester` 由内核绑定。
- `settings/settings-window.md`：分区拆分与按需激活（S1 已改）、输出 9 的控件（t07 已改）；新增：选项提供者贡献点 `settings.choices`、`onSettingsChoices` 与输出 9 里动态选项的 planned 去掉（S3）；页面上下文的 `options`（S3）与 `dirty`、page 声明的 `keywords`、未保存保护（含拦不住的路径）与搜索（S4）；设置文件视图（S5）的输出条目，“不承诺”删去搜索与“打开设置文件的按钮”。
- 组件文档：`SettingsWindow.md`、`SettingsListSection.md`、`SettingsPageFrame.md`（脏标记），新的设置文件视图组件的同名 `.md`。
- `examples/README.md` 与示例 snippets 的讲解：`defineSettings`、`settingsPage`、`onSettingsPage`。

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S0 | 改两份设置 Spec、plugin-api 与 plugins：现在只改 S1、S6 涉及的条目，其余随各自的切片改 | Spec 改动 | `docs:check` |
| S1 | 声明 API 与分区拆分（含全部内置分区、示例、Lab 局部宿主与组件测试的迁移）、`settingsPage`、按需激活（含 `ctx.activation.trigger`） | 声明 API；分区；页面拿到服务；按需激活 | 设置的合同测试、`sections.test.ts`、`SettingsWindow.dom.test.ts`、示例场景测试、nb-runtime 的触发测试、真实内核的按需激活场景；`settings.e2e.ts` |
| S3 | 动态选项（贡献点、选项源注册表、`onSettingsChoices`、`context.options`、Lab 宿主的提供者） | 前置；动态选项 | `choices.test.ts`、`SettingsWindow.dom.test.ts`、真实内核的按需激活场景、Lab 截图 |
| S4 | 未保存保护、搜索 | 未保存保护；搜索 | `settings-window` 的搜索测试、`SettingsWindow.dom.test.ts`、Lab |
| S5 | 设置文件视图（失败码、合同 v2 与 `text` 事件、拥有者、解析位置、smoke 帧、视图组件） | 设置文件视图 | `layer-owner.test.ts`、`layer-text.test.ts`、远程合同测试、`smoke:server`、Vitest、`settings.e2e.ts` 的真实文件用例 |
| S6 | Monaco 排版设置 | Monaco | 编辑器测试；Lab 或 e2e 里看模型实际的缩进 |
| S7 | Lab“模型服务”示例、e2e | Lab 示例 | `settings.e2e.ts` 扩充、`lab-scenes` |

每片一个提交，在 Work 分支上；S1 之后交 omp 审查（声明 API、分区拆分、按需激活），S7 之后再一轮：S5 的合同与拥有者交 omp，S3、S4、S5 的界面与 S7 交 Sonnet。原来的 S2（密钥存储）已撤销，编号空着不复用。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| configuration 输出 1、21（新字段的登记期校验） | `src/shared/settings.test.ts` 表驱动 |
| configuration `readText`、`writeText`、`text` 事件 | 拥有者测试（修订号冲突、解析失败、根不是对象与重复键不落盘且带行列、注释与未声明的键原样保留、与单键写入在同一队列里不互相覆盖、非拥有者调用被拒、文件不存在与读不了、只改注释时发 `text` 不发 `layer`）；`smoke:server` 经打包产物发 v2 帧 |
| settings-window 分区拆分与左栏 | `sections.test.ts`、`SettingsWindow.dom.test.ts` |
| settings-window 按需激活 | 经真实内核的测试：显示分区前入口未激活，显示后激活并加载 |
| settings-window 动态选项 | `choices.test.ts`：未激活、已交付、受阻、撤回、换代、`source()` 抛错、求值中途抛错与形状不对各自的状态；贡献点校验（前缀、位置）；`onSettingsChoices` 经真实内核激活（照 S1 的真实内核场景）；当前值不在选项里时标“已不存在” |
| settings-window 搜索、未保存保护、设置文件视图 | `SettingsWindow.dom.test.ts`：搜到一项并改掉、换词后留下的不合格值不复活、清空回原分区、page 命中按层过滤与跳转、`keywords` 命中、`Mod+F` 只在窗口里拦；脏页面切分区 / 切标签 / 关闭 / 命令打开别的分区都弹确认、取消留下、放弃离开、对话框开着时后到的目标为准、旧挂载的 `dirty` 被忽略；设置文件改一个键保存后列表同步、冲突与外部修改提示、读不了时只读、`invalid` 层经它修好 |
| Monaco 排版设置 | 编辑器测试：改配置后 `updateOptions` 生效、编辑器不重建 |
| 组合场景 | `e2e/settings.e2e.ts`（真实应用、真实 `settings.json`）：搜索到一项并改掉、设置文件视图改一个键保存后窗口与磁盘一致、在外部改坏文件后经视图修好 |
| Lab“模型服务” | Lab 的 e2e（开发会话、内存层）：新增两家服务商并各填 API Key，调整顺序、删除一家后其余各项不串，默认模型的选项随保存更新、删掉后标“已不存在”，有改动时切分区弹确认。只验界面，不当作文件写入的验收 |

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


## 计划审查的处理（2026-10-21）

omp 设计审查（[evidences/design-review-s3-omp.txt](evidences/design-review-s3-omp.txt)，17 条：阻断 2、重要 13、建议 2），逐条对照代码核实，都成立，已改进计划：

- 设置文件视图的合同（第 1、2、3、4、17 条）：新失败码 `read-failed`、`conflict`、`invalid-text` 进领域失败码；`readText` 区分不存在与读不了；修订号是原始字节摘要，另加 `text` 事件（只改注释也发）；解析失败带行列；smoke 的手写 v1 帧与 Lab 内存层一起迁移。
- 动态选项（第 5、6 条）：稳定的映射、每次求值都安全求值并校验形状、句柄换代丢缓存；贡献点的校验、前缀与 `onSettingsChoices` 前缀登记写明。
- 搜索（第 7、10、15、16 条）：`keywords` 是新声明字段，进 schema 与 Spec；结果列表以搜索词作 key；page 命中按当前层过滤；`Mod+F` 只在窗口根上处理。
- 未保存保护（第 8、9 条）：离开统一收进 `requestLeave`，对话框开着时后到的目标为准；上下文按挂载分代，旧挂载的 `dirty` 忽略；入口停止、窗口释放、刷新是拦不住的丢弃路径，写进 Spec；页面按“已保存 + 草稿”比较，不只看 `draft-state`。
- Lab 示例（第 11、12、13、14 条）：服务商列表改用 nb-form 的左列表右详情；两项只允许用户层；Lab 宿主补提供者与触发，真实时序另由真实内核测试；Lab 的 e2e 只验界面，文件写入由设置文件视图的真实 e2e 验。
