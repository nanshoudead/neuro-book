---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: settings.window
owners:
  - nbook.settings
---

# 设置窗口

## 目标与非目标

**目标**：给用户一个查看与修改配置项（[`settings.configuration`](configuration.md)）的窗口。左栏列出分区，右边一次显示一个分区；插件经两个贡献点贡献分区：`settings.sections` 的 list 分区由窗口按配置项的声明画出控件，`settings.pages` 的 page 分区由贡献方自己画，窗口只画标题与说明。绑定作品的窗口里，“用户 | 本作品”两个标签分别编辑用户层与项目层。通用列表经用户编辑路径（configuration 输出 19）写入；page 分区经自己插件的配置服务写自己声明的项。给页面用的 `SettingsRow` 与 `SettingsPageList` 让各插件的页面与通用列表看起来一致。

**不承诺**：

- 搜索；密钥项的界面（随第一个密钥使用者）；本机层（configuration 输出 22）；打开设置文件的按钮；用户自定义快捷键。
- 路径类控件（选择目录）：路径类的项由所属插件贡献 page 分区，自己给选择方式。
- 手机宽度：只做桌面宽度。
- 入口按钮的样子：工作台活动栏底部的齿轮见 [`ui.workbench-shell`](../ui/workbench-shell.md) 输出 40，书架顶部的齿轮见 [`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1；本 Spec 只定它们执行的命令、读的公开状态与谁贡献它们（“打开窗口”）。
- 窗口的位置不记，每次居中。

## 术语与参与者

- **分区**：左栏的一项；贡献点 `settings.sections` 或 `settings.pages` 上一条已接受的声明，贡献 id 就是分区 id。
- **list 分区**、**page 分区**：前者是 `settings.sections` 的声明，窗口按配置项的声明画控件；后者是 `settings.pages` 的贡献，贡献方交出页面组件。
- **小组**：list 分区里带小标题的一组配置项。小组 id 是分区声明的公开合同，别的插件的配置项按 id 引用。
- **标签**：窗口顶部的“用户 | 本作品”，决定编辑哪一层；未绑定作品的窗口只有用户层，没有标签。
- **书名**：窗口绑定的作品的显示名：书名，没有书名时是目录原名（[`runtime.projects`](../runtime/projects.md) 术语）；不是地址栏用的短名。覆盖提示（输出 11）与页面上下文的 `projectTitle` 用它。
- **“其它”**：窗口自己的分区，不是贡献；收留没写 `section` 或指向不存在的分区的配置项。
- **交付状态**、**交付句柄**：同 [`workbench.views`](../workbench/views.md) 的定义，只对 page 分区有意义。
- 参与者：贡献分区的插件入口；声明配置项的插件；`nbook.settings`（贡献点拥有者、窗口、用户编辑的调用方）；`nbook.workbench`（通知、页面浮层与入口按钮）；用户。

## 输入与前置条件

### 分区声明

两个贡献点，拥有者都是 `nbook.settings`：

- `settings.sections`：list 分区，**顶层声明式贡献**（写在插件描述的 `contributions` 里，没有实现）。三个运行位置的 `nbook.settings` 都定义这个贡献点，每个实例都登记、都知道全部 list 分区。
- `settings.pages`：page 分区，只接受浏览器入口的贡献，实现是 `{load()}`。

```ts
// settings.sections
interface SettingsSectionDeclaration {
    readonly title: LocalizedText;
    readonly description?: LocalizedText;          // 分区标题下的一行说明
    readonly icon: string;                         // 图标类名，例如 i-lucide-palette
    readonly category: "app" | "ai" | "plugins";   // 左栏分组：应用、AI、插件
    readonly order?: number;                       // 组内顺序，缺省 0，同值按 id
    readonly groups?: ReadonlyArray<{readonly id: string; readonly title: LocalizedText}>;
}
// settings.pages
interface SettingsPageDeclaration {
    readonly title: LocalizedText;
    readonly description?: LocalizedText;
    readonly icon: string;
    readonly category: "app" | "ai" | "plugins";
    readonly order?: number;
    readonly layout?: "column" | "fill";           // 缺省 column
    readonly layers?: ReadonlyArray<"user" | "project">;   // 在哪些标签下可用，缺省两者
}
interface SettingsPageImplementation {
    load(): Promise<Component>;                    // 只取得组件定义；实例由窗口创建；props：{context: SettingsPageContext}
}
// 包页面：load 可以交模块（() => import("./Page.vue")）或组件；props() 在渲染时求值，补上 context 之外的属性
function settingsPage(load: () => Promise<Component | {default: Component}>, props?: () => Record<string, unknown>): SettingsPageImplementation;
// page 分区的入口按需激活时写进 activationEvents 的事件：`onSettingsPage:<分区 id>`（前缀归 nbook.settings）
function settingsPageEvent(sectionId: string): string;
interface SettingsPageContext {
    readonly id: string;
    readonly layer: Readonly<Ref<"user" | "project">>;    // 当前标签；页面只编辑这一层
    readonly projectTitle: Readonly<Ref<string | null>>;  // 绑定作品的书名（见术语），没有绑定时为 null
}
```

| 规则 | 不满足时 |
|---|---|
| `settings.sections` 写在插件描述的顶层；`settings.pages` 写在浏览器入口下 | 前者写在入口下为 `implementation-not-accepted`；后者写在顶层为 `implementation-required`，不是浏览器入口的贡献为 `invalid-declaration` |
| 分区 id 是点分的小写段（`a-z`、`0-9`、`-`，每段以字母开头，至少两段）、至多 128 个字符；`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头 | `invalid-declaration` |
| `title`、`description` 两种语言都非空；`icon` 非空；`category`、`layout`、`layers` 取上面的值；`order` 在 -1000000 到 1000000 之间 | 同上 |
| 小组 id 是一个小写段、至多 64 个字符，同一分区里不重复 | 同上 |
| `layers` 非空、不重复 | 同上 |
| 声明不认识的字段（包括已删除的 `kind`，以及 list 写 `layout`、`layers`，page 写 `groups`） | 同上 |
| 同一分区 id 出现在两个贡献点上（内核按贡献点分别去重，不跨点查重） | 这个 id 的分区都不显示，记一条诊断，与登记顺序无关；指向它的配置项按“分区不存在”归入“其它” |

配置项一侧的 `section`、`group`、`order`、`choices`、`applies` 见 [`settings.configuration`](configuration.md)“声明”。

### 打开窗口

- 命令 `nbook.settings.open`，参数 `{section?: string; layer?: "user" | "project"}`，默认键位 `Mod+,`（其它平台 `Ctrl+,`、macOS `⌘,`；显示与分发见 [`workbench.commands`](../workbench/commands.md)）；只读（`effect: "read"`），不对 Agent 开放。“其它”分区的 id 是 `other`（只有一段，分区贡献写不出来，不会撞名），它在左栏里时可以作 `section`。
- 公开状态 `nbook.settings/windowOpen`（布尔，[`state.public`](../state/public-state.md)）：本页的设置窗口开着时为真，没有绑定时为假。
- 入口：`nbook.settings` 的窗口入口（启动即激活）向工作台贡献两样，都随这个入口出现与消失：
  - 活动栏底部条目 `nbook.settings`（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 40）：标题“设置”、图标 `i-lucide-settings`、`order: 1000`（在头像占位之下）、命令 `nbook.settings.open`、`toggled: nbook.settings/windowOpen`。
  - 页面浮层 `nbook.settings.window`（输出 41）：窗口本身。工作台在页面根上挂一份，首页（书架）与工作台页都有，每个浏览器页面一份。
- 书架右上角的齿轮由 `nbook.projects` 自己画，执行同一条命令、读同一个公开键（[`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1）。

### 给页面用的组件

宿主与插件共用的前端组件（`src/ui/settings/`，插件在运行时直接引用，各带同名组件文档）：

- `SettingsRow`（`nbook/ui/settings/SettingsRow.vue`）：属性 `settings`（调用方插件的配置服务）、`setting`（配置定义）、`layer`（当前标签）、`locale`（显示语言）、可选的 `projectTitle`（覆盖提示里的书名）与 `wide`（宽排法，输出 9）；控件放在默认插槽里，插槽拿到这一层显示的值、是否停用与给控件用的 id、可访问名称；行自己的写入没有成功时发 `write-failed`。
- `SettingsPageList`（`nbook/ui/settings/SettingsPageList.vue`）：fill 页面里的二级列表，属性 `items`、`modelValue`（选中的 id）、`label`（可访问名称）。

前置：`nbook.settings` 的浏览器入口已激活；它激活时读本窗口已接受的全部分区声明与配置项声明。

## 输出与可观察行为

1. **左栏**：窗口从两个贡献点上已接受的分区声明取得左栏，未交付实现的 page 分区也在其中，左栏不随交付先后跳动。分三组，自上而下应用、AI、插件，组间一条分隔线、没有组标题；组内按 `order`（缺省 0），同值按分区 id。“其它”排在插件组的最后，没有项时不出现。左栏宽约 180px，右边一次只显示一个分区。没有可列的项的 list 分区在左栏停用，以“这个分区还没有设置项”作提示。
2. **配置项落到分区**：配置项按 `section` 落到 list 分区；分区里先列没写 `group` 的项（没有小标题），再按分区声明的顺序列各小组（有小标题）；同一小组内按 `order`（缺省 0），同值按键。`group` 指向分区没有声明的小组时按没写处理，记一条诊断。没写 `section` 的项、`section` 指向不存在的分区的项（记一条诊断）归入“其它”，按声明者插件分小组。指向 page 分区的项不在列表里画，由页面负责。
3. **外壳画什么**：每个分区顶部的标题与说明由窗口画。list 分区与 `layout: "column"` 的页面放在同一个内容列里（同样的内边距与封顶宽度，内容列滚动）；`layout: "fill"` 的页面拿到标题下面的整块区域（外边距同内容列，不封顶），自己分栏、自己滚动。
4. **page 的交付状态**：page 分区处于下列之一，在右边原位呈现：
   | 状态 | 含义 | 原位呈现 |
   |---|---|---|
   | `declared` | 有声明，所属入口尚未激活或激活中 | 加载占位 |
   | `entry-blocked` | 所属入口受阻 | 受阻原因，无动作 |
   | `entry-failed` | 所属入口激活失败 | 失败原因与“重试” |
   | `entry-stopped` | 已交付的实现被撤回 | 停止原因 |
   | `entry-not-activatable` | 所属入口还没激活，且不会被按需激活：没声明这个分区的激活事件，或触发被拒 | “插件没有声明打开分区时激活”与原因，无动作 |
   | `available` | 句柄已发布 | 页面内容 |
   list 分区只靠声明呈现，不看贡献方入口的状态，总是可用。

   **按需激活**：窗口每次显示一个 page 分区（窗口开着、它是当前分区、当前标签下可用），所属入口处于“已登记、未激活”时，先看这个入口是否声明了 `onSettingsPage:<分区 id>`：声明了就以 `nbook.settings` 的身份触发它（[`runtime.plugins`](../runtime/plugins.md) 输出 21），没声明就是 `entry-not-activatable` 并记一条诊断，不触发。别的入口声明了同一个事件不算数。触发之后分区的状态只看它自己的入口与交付句柄，不等事件的全部结果，别的监听者一直不结束也不影响它。内核把同一代次的激活合并成一次，反复进入不重复激活；等待中离开或关窗口不取消，激活照常完成，再进入时按当时的状态呈现。入口同时声明 `onStartup` 时启动就激活，与此无关。
5. **page 的加载与失败**：page 分区第一次显示时调用一次 `handle.implementation().load()`，取得组件后创建实例并交给它 `context`；结果回来时句柄已不是当前句柄、已不处于 `published` 或窗口已关闭，就丢弃这次结果，不挂组件，也不记为加载失败。`load()` 失败或交出的实现没有 `load()` 时原位显示错误摘要与“重新加载”（后者另记一条诊断）；组件渲染出错原位显示错误摘要与“重试”（卸载并重建这个页面）。一个分区的失败不影响别的分区与窗口。“重试”经宿主能力 `window.plugins` 恢复并重新激活该分区所属的入口（同 [`workbench.views`](../workbench/views.md) 输出 8）。
6. **页面上下文**：切换标签时 `context.layer` 变化，页面不重建；页面用自己插件的配置服务读写自己声明的项，写入带 `{layer: context.layer.value}`。离开分区时页面卸载，回到分区时重新创建（交付句柄没变时不重新加载组件定义）。
7. **标签**：绑定作品的窗口在窗口标题下、左栏上方显示“用户 | 本作品”分段控件，缺省“用户”；未绑定作品的窗口不显示，只编辑用户层。
8. **分区在标签下可用**：list 分区在“本作品”标签下可用的条件是其中至少一项允许项目层，在“用户”标签下同理看用户层；page 分区看声明的 `layers`（缺省两者），由页面作者让它与页面里配置项的层一致。不可用的分区在左栏停用并以原因作提示；当前分区在新标签下不可用时仍是当前分区，右边原位显示不可用的原因。
9. **通用控件**：布尔用开关；有 `choices` 的字面量联合不超过 3 项用分段控件，多于 3 项用下拉，选项名取 `choices` 的 `title`；没有 `choices` 的字面量联合同样排法，选项名是字面量本身；数字用数字输入框，范围与步长取 schema 的 `minimum`、`maximum`、`multipleOf`；字符串用输入框，长度取 `minLength`、`maxLength`；数组、对象等画不了的类型只读显示“只能在设置文件里改”与当前值的摘要。`applies` 不是 `now` 时标题后标注“下次运行生效”“下次会话生效”或“重启后生效”。每项的排法（混合排法）：
   - **标签列加控件列**：开关、分段、下拉、数字与单行输入。标签列约 200px（标题与说明），控件紧跟其后、左对齐，宽度按类型定：下拉 220px、数字框 120px、单行输入 320px（都不超过行宽），分段按选项名给足宽度、各段完整显示，开关原样；“恢复默认”紧跟在控件后面。
   - **宽排法**：多行文本、JSON、列表这类宽控件，以及只读显示的值。标题与说明在左上，“恢复默认”（本作品标签是“移除本作品的设置”）在标题那一行的右端，控件另起一行、占满内容列宽度；本作品标签沿用时，“沿用用户设置：X”与“在本作品里单独设置”在标题那一行的右端，控件照样画在下面、停用，显示沿用的值。page 页面里的宽控件用 `SettingsRow` 的 `wide` 得到同样的排法。
   - 长文本的声明提示（例如 `format: "multiline"`，通用列表据此画多行文本框）（planned）：随第一个使用者（Agent、向量嵌入迁回时）补进 [`settings.configuration`](configuration.md) 的声明字段。
   - 宽控件的通用编辑（多行文本、JSON、列表）（planned）：同上；在那之前这些类型在通用列表里只读显示，要编辑的插件贡献 page 分区。
10. **已修改**：当前标签这一层写了这个键就算改过：标题左侧一条强调色竖线，控件后面“恢复默认”，点了从这一层删掉这个键（`unset`），控件回到下一层的值。
11. **被本作品覆盖**：用户标签里，本作品层写了的项在行下一行用信息色提示“本作品单独设为了 X，这里的改动在《书名》里不生效”。
12. **本作品标签**：本作品层没写的项显示“沿用用户设置：X”与“在本作品里单独设置”（把当前有效值写进本作品层）；写了的项显示控件与“移除本作品的设置”（`unset`）。只允许用户层的项不列出，分区末尾一行淡色字列出这些项的标题、说明它们只能在用户设置里改（“用户”标签下只允许项目层的项同理，说明只能在本作品里设置）。
13. **层的状态**：当前标签那一层 `invalid` 时分区顶部一行说明“设置文件有错误，修好前这里不能保存”与这一层的文件路径（层快照带路径时，见 [`settings.configuration`](configuration.md) 输出 23：项目层带，用户层的文件在状态根下、不带），这一层的控件停用并显示上一份有效值；`unavailable` 时说明“暂时连不上，不能保存”，控件停用。层恢复后说明自动消失、控件恢复。
14. **写入结果**：成功不提示；写入结算之前控件显示这次的值。失败发工作台通知（[`workbench.notifications`](../workbench/notifications.md)，警告色调，标题“设置没有保存”，正文写哪一项与原因），控件回到层里的实际值；`unknown-outcome` 的通知标题是“设置可能没有保存”，正文“可能没有保存，以设置文件为准”。数字框与单行输入编辑时只改草稿，失去焦点或回车才写；不合 schema 的值由写入路径以 `invalid-value` 拒绝，同样发通知、回到实际值。
15. **一个页面一个窗口**：`nbook.settings.open` 打开本页的设置窗口，已开着时只聚焦；给了 `section` 跳到这个分区，给了 `layer` 切到这个标签。`section` 不在左栏里时以 `invalid-args` 失败，`layer: "project"` 而窗口没有绑定作品时以 `unavailable` 失败，两种都不打开、不改变窗口。关掉再开回到上次的分区与标签；刷新页面后回到第一个分区、用户标签。
16. **外框**：非模态浮动窗口，缺省 960×640（不超过页面），可拖动边缘调整大小、下限 600×400，尺寸按客户端记住；切换分区时窗口不变大小；每次打开居中。
17. **键盘**：打开时焦点在左栏的当前项；焦点在左栏时上下键切换到上一个、下一个可用分区（Home、End 到首尾），焦点跟着走；`Esc` 关窗口，焦点回到打开窗口之前的位置。
18. **`SettingsRow`**：按传入的设置定义、配置服务与层自己算出并画出：已修改竖线与“恢复默认”（经传入的配置服务以 `update(setting, undefined, {layer})` 删除这一层的键）、用户标签下的“本作品覆盖”提示（输出 11）、本作品标签下的沿用、“在本作品里单独设置”与“移除本作品的设置”（输出 12）、层 `invalid` 或 `unavailable` 时控件停用（输出 13）、声明不允许当前层时不画控件并说明；标题、说明、`applies` 标注与两种排法同通用列表。行自己的写入没有成功时交给调用方（设置窗口发通知）。页面不重写这些规则。通用列表的每一项也是一个 `SettingsRow`，写入换成用户编辑路径。
19. **`SettingsPageList`**：fill 页面做二级列表用；选中样式与左栏不同（不用左栏的选中底色），免得两层左栏读成一张表。

## 状态与转换

page 分区的交付状态：

| 初始状态 | 事件 | 下一状态 | 页面实例 |
|---|---|---|---|
| `declared` | 句柄 `published` | `available` | 分区显示时加载并创建 |
| `declared` | 入口受阻 / 激活失败 | `entry-blocked` / `entry-failed` | 无 |
| `entry-failed` | 用户点“重试”且恢复、激活成功 | `available` | 分区显示时加载 |
| `available` | 句柄撤回 | `entry-stopped` | 卸载，丢弃已加载的组件定义 |
| `entry-stopped` | 同一分区再次交付 | `available` | 新句柄，重新加载 |

窗口：关闭 →（`nbook.settings.open`）打开，`windowOpen` 为真 →（关闭按钮、`Esc`）关闭，`windowOpen` 为假。

时序与寿命：

- 交付句柄从 `published` 起可用，到撤回为止；撤回之后访问 `implementation()` 抛错，窗口不缓存实现。
- 一次加载从发起到结果回来之间，入口可能停止：撤回先于结果到达时丢弃结果（输出 5）；结果先到、撤回后到时，先挂上的页面随撤回卸载并显示停止原因。
- “重新加载”“重试”在一次进行中时重复点击不发起第二次。
- 用户编辑成功返回时本窗口已是新值（configuration 输出 19）；同一层被别处改动（另一个窗口、外部改文件）时窗口里的值即时变化。
- 设置窗口经工作台的页面浮层挂在页面根上，随页面卸载（导航、刷新）而关闭，`windowOpen` 回到假；每个浏览器页面各一份，互不影响。窗口组件加载失败或渲染出错时只是窗口不显示（工作台记诊断 `workbench.overlays`），命令照常改变 `windowOpen`。
- 窗口的数据来源与用户编辑路径由 `nbook.settings` 的配置核心入口持有：它停止时窗口关闭，进行中的写入照常结算。

## 副作用与数据

- 通用列表只经用户编辑路径（configuration 输出 19）写配置文件；page 分区经自己插件的配置服务写自己声明的项（configuration 输出 11）。
- 窗口尺寸是 `nbook.settings` 的一条 `local` 记录 `settings.window-size`（[`storage.persistence`](../storage/persistence.md)，user 分区，`{width, height}`），同一客户端的各个页面共用，第一次打开窗口时才读；记录读不到或损坏时用缺省尺寸，不阻止打开；保存失败只改本页的显示，不提示。
- 上次的分区与标签、交付状态与已加载的组件定义只在内存，随页面释放。

## 失败与恢复

| 情况 | 结果 | 用户或作者怎么办 |
|---|---|---|
| 分区声明不合规则 | 声明被拒，内核诊断写明原因；分区不出现 | 作者按诊断修正 |
| 配置项指向不存在的分区或小组 | 落到“其它”或分区最前，记一条诊断 | 作者修正 `section`、`group`，或贡献那个分区 |
| page 入口受阻、激活失败、`load()` 失败、渲染出错、撤回 | 输出 4、5 的原位呈现 | 按呈现的动作重试，或刷新页面 |
| 写入失败 | 工作台通知，控件回到实际值 | 按通知处理（例如修好文件、改权限） |
| `unknown-outcome` | 提示可能没有保存 | 以设置文件为准 |
| 层 `invalid`、`unavailable` | 分区顶部说明，这一层的控件停用 | 修好文件；等连接恢复 |
| `nbook.settings.open` 的参数不对 | `invalid-args` 或 `unavailable`，不打开 | 调用方修正参数 |

## 边界与兼容

- 公开接口：贡献点 `settings.sections` 与 `SettingsSectionDeclaration`、`settings.pages` 与 `SettingsPageDeclaration`、命令 id `OPEN_SETTINGS_COMMAND` 与公开键 `SETTINGS_WINDOW_OPEN_KEY`（`nbook/plugins/settings/shared/contracts`）；`SettingsPageImplementation`、`SettingsPageContext`（`nbook/plugins/settings/web/contracts`）；`settingsPage`（`nbook/ui/settings/settings-page`）；`settingsPageEvent` 与激活事件前缀 `onSettingsPage`（`nbook/plugins/settings/shared/contracts`）；`SettingsRow`、`SettingsPageList`（`nbook/ui/settings/`）；命令 `nbook.settings.open`；公开键 `nbook.settings/windowOpen`。分区声明与页面上下文只增不改，新增可选字段不影响旧插件；小组 id 是分区的公开合同，改名等于删掉旧小组。
- 用户编辑路径与窗口的数据来源只给 `nbook.settings` 自己（configuration 输出 19），别的插件的页面只能写自己声明的项。
- 信任边界：页面组件跑在工作台的 Vue 应用里，错误边界只覆盖 Vue 调用路径；组件自己发起、没有交给 Vue 的异步错误由所属插件处理。

## 验收与 Smoke

1. Given 工作台页与书架页，When 点各自的齿轮或按 `Ctrl+,`，Then 打开同一个窗口；再触发只聚焦；窗口开着时齿轮画成按下（按钮见入口所在的 Spec）。
2. Given 绑定同一作品的两个页面，When 在用户标签改主题，Then 两个页面即时变化；When 本作品标签单独设明暗，Then 用户标签出现覆盖提示；When 移除本作品的设置，Then 提示消失。
3. Given 改过的项，Then 有已修改标记；When 恢复默认，Then 键从文件里删掉、其余内容不变。
4. Given 用户层文件被改坏，Then 分区顶部出现说明、控件停用；When 修好文件，Then 说明消失、控件恢复。
5. Given 只读的设置文件，When 改一项，Then 发通知、控件回到实际值。
6. When 拖动调整窗口大小后关掉再开、刷新页面，Then 仍是这个尺寸；切换分区时窗口尺寸不变。
7. Given 一个 page 分区，When 切换标签，Then 页面拿到新的层并按层读写；When 页面加载失败，Then 原位显示错误、别的分区照常；When 所属入口停止，Then 原位显示停止原因。

Smoke 入口：`e2e/settings.e2e.ts`（扩展到设置窗口）。

## 实现合同

- **公开入口**：`nbook/plugins/settings/shared/contracts`（贡献点 `SETTINGS_SECTIONS_POINT`、`SETTINGS_SECTION_CATEGORIES` 与 `SettingsSectionDeclaration`，命令 id `OPEN_SETTINGS_COMMAND`，公开键 `SETTINGS_WINDOW_OPEN_KEY`）；`nbook/plugins/settings/web/contracts`（`SettingsPageImplementation`、`SettingsPageContext`）；`nbook/ui/settings/SettingsRow.vue`、`nbook/ui/settings/SettingsPageList.vue`。窗口模型 `createSettingsWindow`、分区注册表与窗口数据来源是 `nbook.settings` 的内部实现，数据来源经服务只发给 `nbook.settings` 自己的入口。
- **owner 与依赖方向**：`nbook.settings` 的浏览器侧有两个相关入口。配置核心入口持有配置实例、`settings.pages` 的接收者（分区注册表，经宿主能力 `window.plugins` 查入口状态与重试）与窗口数据来源；窗口入口持有窗口模型，贡献打开命令、公开键、活动栏底部条目（`workbench.activitybar-items`）与页面浮层（`workbench.overlays`），依赖工作台的通知与 Storage（窗口尺寸记录）。工作台依赖配置核心，窗口因此不在核心入口里，免得服务装配的静态环。通用列表经层拥有者的用户编辑写入（[`settings.configuration`](configuration.md) 输出 19）；page 分区的贡献方只引用上面的公开入口，写入走自己插件的配置服务。书架右上角的齿轮由 `nbook.projects` 画，只读公开键、执行命令（[`workbench.bookshelf`](../workbench/bookshelf.md) 输出 1）。
- **关键不变量**：
  - 窗口数据来源（含用户编辑的写入路径）只发给 `nbook.settings` 自己、没有经过代理的入口；层的拥有者对用户编辑再按内核填写的调用方核对一次（`web/sections.test.ts`“设置窗口的数据来源只给 nbook.settings 自己”，`settings.test.ts`“用户编辑”）。
  - page 分区的页面实例与已加载的组件定义归窗口模型，不归组件：交付撤回时同步作废（撤回与再次交付挨在同一轮也换用新句柄），窗口关闭时作废进行中的加载；一次加载的结果只在它的代次仍是最新、实例仍在加载时生效（输出 4、5，`window.test.ts`“page 分区的加载”）。
  - 页面上下文每个分区一份、在窗口的一生里不变，`layer` 是窗口标签的只读引用：切换标签时页面不重建，离开再回来不重新加载组件定义（输出 6，`window.test.ts`、`SettingsWindow.dom.test.ts`“page 页面的寿命”）。
  - `SettingsRow` 的已修改、沿用、覆盖提示与停用只由配置服务的 `inspect` 结果与当前标签算出，通用列表与 page 页面共用这一份规则（输出 10–13、18，`SettingsRow.dom.test.ts`）。
  - 通用控件的写入在结算之前按“标签加键”记下这次的值供控件显示，结算后清掉，控件回到层里的实际值；失败另经通知交给用户（输出 14，`window.test.ts`“通用列表的写入”）。

## 证据

- 批准依据：开发者批准的 t80 实施计划（记录在主工作区 master 的 `.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md`）“关键设计”第 2、4 节；窗口尺寸由开发者改为缺省 960×640（2026-10-12）；每项的混合排法（输出 9）由开发者确认（2026-10-12，t80 README 待定第 11 条）；开发者 2026-10-13 批准晋升为 `implemented`。
- 实现入口：[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/settings/web/plugin.ts)（配置核心入口与窗口入口：分区贡献点、打开命令、公开键、活动栏齿轮与窗口浮层）、[`web/settings-window.ts`](../../../packages/neuro-book/src/plugins/settings/web/settings-window.ts)（窗口模型）、[`web/sections.ts`](../../../packages/neuro-book/src/plugins/settings/web/sections.ts)（分区注册表与交付状态）、[`web/components/SettingsWindow.vue`](../../../packages/neuro-book/src/plugins/settings/web/components/SettingsWindow.vue)、[`src/ui/settings/`](../../../packages/neuro-book/src/ui/settings/)（`SettingsRow`、`SettingsPageList`、`settingsPage`）
- 合同测试：[`window.test.ts`](../../../packages/neuro-book/src/plugins/settings/window.test.ts)（落位、打开命令、尺寸、按需激活、page 加载、写入与层的说明，真实内核与真实设置文件）、[`web/sections.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/sections.test.ts)（分区的登记校验与交付状态）、[`commands.test.ts`](../../../packages/neuro-book/src/plugins/settings/commands.test.ts)（打开命令的登记、参数与公开键）、[`web/setting-controls.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/setting-controls.test.ts)（通用控件的选择）、组件测试 [`SettingsWindow.dom.test.ts`](../../../packages/neuro-book/src/plugins/settings/web/components/SettingsWindow.dom.test.ts)、[`SettingsRow.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsRow.dom.test.ts)、[`SettingsPageList.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/SettingsPageList.dom.test.ts)、[`settings-page.dom.test.ts`](../../../packages/neuro-book/src/ui/settings/settings-page.dom.test.ts)；[`06-settings-page.test.ts`](../../../packages/neuro-book/examples/scenarios/06-settings-page.test.ts)（示例插件 [snippets](../../../packages/neuro-book/examples/plugins/snippets/) 的 page 分区：声明、交付与撤回、按层写入、越权写入）
- Smoke：[`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)（验收 1–4、6：工作台与书架的齿轮、`Ctrl+,`、`Esc` 后焦点回到打开前的位置，两个页面即时变化，本作品覆盖与移除，恢复默认后的文件，文件改坏与修好，尺寸跨关闭与刷新、每次打开居中）；[`bookshelf.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf.e2e.ts)（“作品”分区的目录选择器叠在窗口上）；Lab 场景 `SettingsWindow`、`SettingsRow`、`SettingsPageList`、`SettingsControl`
