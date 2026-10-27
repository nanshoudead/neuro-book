---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-27
decided: 2026-10-27
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# 界面文字的消息目录

## 问题

界面文字现在直接写在代码里，每处一对 `{zh-CN, en-US}`，带来几个问题：

- 应用、nb-agent-ui、nb-form、nb-markdown 四处各有一套类型与代入函数；
- 英文复数只有 nb-agent-ui 处理了；
- 要加第三种语言就得改所有调用点；
- 文字分散在代码里，接不上翻译平台。

失败说明另有一个问题：各合同里的 `reason`、`message`、`detail` 既当诊断又当界面正文，用户看到的语言取决于写错误的人用了什么语言（w00031 t02 的通道矩阵）。

[ADR 0034](../adr/0034-language-policy.md) 决策 3 定了方向：每个插件、每个共享包自带按语言分的 JSON 消息目录，用 i18next 的原生格式，共享包不依赖 i18n 库。本提案把这个方向落成机制，并给各错误域的失败文案定共用的写法。

## 目标与非目标

目标：

- 插件作者和共享包作者在目录里写文字；声明按约定取键，偏离约定时才写键；
- 加一种界面语言，主要是加目录文件；声明和组件不用改；
- 切换语言时，已打开的界面不重新挂载就换文字；
- 写错键、漏翻译、两种语言的占位符不一致，在检查或测试里就能发现；
- 各错误域的失败文案按“拥有者 + 码”取，不认识的码有中性兜底。

非目标：

- 翻译平台的接入流程；
- 第三方插件新增界面语言（语言包）；
- 作品正文与 Agent 输出的本地化；
- 开发诊断的翻译（ADR 0034 定为英文）；
- 失败“详情”的界面载体与常驻通知（[w00028 t04](../../.agents/works/w00028-i18n/tasks/t04-failure-details/README.md)）；
- 各错误域具体的码与参数（w00031 t03）；
- 插件热插拔时目录的在线替换（随 `runtime.plugin-hot-plug` 实施，见方案第 1 节）。

## 当前行为与证据

- **界面文字**：约 1180 处 `"en-US"`，分布在一百多个文件里。`LocalizedTextSchema` 是闭合的两个必填字段（`packages/neuro-book/src/shared/localized-text.ts`），登记校验里有 10 处写死它，其中包括 `src/shared/settings.ts`、`src/plugins/settings/shared/sections.ts`。`DisplayLocale` 被 113 个文件引用；`localeSetting` 的 schema、共享包里的 `PromptLocale`、`MarkdownLocale` 都写死了两种语言。
- **声明里的文字**：命令标题、视图标题、设置项（分区、页面、分组、选项、`keywords`）、菜单项、活动栏与状态栏条目、视图动作、编辑器与编辑器页面、公开状态的原因，都是内联双语。命令 id 不一定带插件前缀，例如工作台的 `nbook.view.*`、`nbook.app.reload`。远程命令列表 `nbook.commands/remote` 的 `list` 输出里，`title` 是写死的 `LocalizedTextSchema`（`additionalProperties: false`，版本 1）。
- **共享包**：
  - nb-agent-ui 的 `ViewText` 有包内键 `{key, params}`，`MessageView` 里有几处适配时就折好的字符串；
  - nb-form 的 `FormText` 是开放语言集合的公开类型，取不到时回退到 `en-US`；
  - nb-markdown 有两处单独 `render()` 挂载的 Vue 树，注入到不了；
  - nb-ui 有 21 个文件写死中文，其中一部分写在模板里，没有属性可传。
- **引导**：显示语言来自设置快照，每层首份快照最多等 3 秒，超时按默认值 zh-CN 继续（`docs/specs/settings/configuration.md` 输出 16）。`HostPage`、`PageOutlet`、`FailurePage` 是三个独立的 `createApp`。两份 `index.html`、`boot.ts`、离线横幅、`NotFoundPage` 里有静态中文，`<html lang>` 写死 `zh-CN`。
- **插件交付**：
  - 内置插件随前端构建，浏览器引导只拿到 id 与版本；
  - 第三方插件由 SDK 构建出产物，`buildPlugin` 只输出入口的 `.js`/`.map`、`style.css` 与生成的 `package.json`；安装器按产物的 `files` 复制；
  - 插件文件路由按服务端启动时的快照服务，只对浏览器登记了的插件可用（`src/plugin-platform/build/build-plugin.ts`、`src/server/plugins.ts`）；
  - 插件页还会列出只有后端、已禁用、不兼容、没加载的插件。
- **已有的码**：nb-story 的 `STORY_ERROR_CODES` 与 harness 的公开码带下划线（`book_not_found`、`session_incompatible`）；远程路由有 10 个 `REMOTE_FAILURE_CODES`；第三方插件可以在远程方法的 `errors` 里声明闭合的业务码。
- **i18next 26.5.11 原型**（[w00028 t02](../../.agents/works/w00028-i18n/tasks/t02-library-prototype/README.md)）：在本项目里成立，gzip 14.2 KB；但几处默认行为不合用，见方案第 4 节。

## 方案

### 1. 目录与交付

- **目录**：每个插件、每个共享包有一份 `locales/<语言>.json`，命名空间是插件 id 或包名。语言标签按 `Intl.getCanonicalLocales` 规范化。
- **清单**：第三方插件的清单加 `l10n: {source, locales}`，`source` 必须在 `locales` 里，列表不重复。字段形状属于清单合同：形状不对，按现有规则整份清单无效。
- **两条交付路径，一个登记接口**：
  - **内置插件**：目录由插件定义模块静态导入，随前端构建进包。
  - **第三方插件**：SDK 构建读取并校验 `locales/`（源语言齐全、列出的文件存在、值是字符串或嵌套的字符串对象），复制进产物并列入 `files`。安装器照现有规则复制；安装时目录坏了，按新的安装失败码 `catalog-invalid` 拒绝。
- **目录集合与登记集合分开**：浏览器在引导时取齐**所有有效安装插件**的目录。这个集合不限于在浏览器登记的插件，因为只有后端入口的插件，它的失败码也要在浏览器里显示。目录经一个按版本摘要寻址的宿主目录端点提供，不经入口代码的文件路由；端点只读目录文件，不执行插件代码。已禁用、清单无效的插件不提供目录，插件页只显示生成清单里的源语言名称。
- **目录取不到或坏了**：插件照常登记（文字不是功能）；该插件的文字按第 4 节的回退链显示，插件页显示问题，并记诊断。
- **清单的名称与说明从目录摘出**：SDK 构建把源语言目录里的 `manifest.displayName`、`manifest.description` 写进生成的清单，插件页不执行插件代码就能列出插件；显示时按当前语言取目录。内置插件同理，由应用构建从目录取。目录是唯一的来源。
- **升级**：本提案落地时，插件升级后的新目录要**重启后生效**。在线替换（目录端点的快照、窗口撤回旧目录再登记新目录的先后）随 `runtime.plugin-hot-plug` 实施，那时按同一个版本摘要换。

### 2. 键与声明：按约定取键

**通则**：带文字的贡献点，字段没写就取约定键 `<贡献点短名>.<本地 id>.<字段>`。

- **本地 id**：贡献 id 以 `<插件 id>.` 开头时去掉这段前缀，否则用完整 id，例如工作台的 `nbook.view.toggle` 取 `commands.nbook.view.toggle.title`。
- **各贡献点的短名与字段**写在各自的 Spec 里，例如：
  - `commands.<id>.title`、`.category`；
  - `views.<id>.title`；
  - `settings.<名>.title`、`.description`、`.placeholder`、`.keywords`；
  - `settings.<名>.choices.<String(值)>.title`、`.description`；
  - 设置的分区、页面、分组；
  - 活动栏、状态栏条目、视图动作、编辑器与编辑器页面；
  - `manifest.displayName`、`manifest.description`。
- **菜单项的 `label`** 没写时沿用现有语义，取命令的标题，不另设约定键。
- **偏离约定时**写成文字引用（见第 3 节）；**写字符串**就是不翻译的字面文字。
- 宿主在登记声明时给引用补上插件自己的命名空间。

### 3. 文字值

一个类型，三种形态：`Text = string | TextRef | LocaleMap`。

- **`TextRef`**：`{kind: "text", ns?, key, params?}`，带判别字段 `kind`。
  - 声明里写的 `{kind: "text", key}` 不带 `ns`，由宿主在登记时补上；
  - 插件代码用 `text(key, params)` 构造，它由应用的插件 SDK 在激活适配层里绑定本插件的命名空间，不进内核的 `ActivationContext`；
  - 插件都受信任（ADR 0027），宿主不防伪造。
- **`LocaleMap`**：键必须是合法的语言标签（`Intl.getCanonicalLocales` 不抛错）。现有的 `LocalizedText` 和 nb-form 的 `FormText` 都属于这种形态，回退规则保持现状：取不到当前语言就取 `en-US`，再取不到就取第一项。
  - **判别**：先看 `kind`，再看字符串；`kind` 不是合法语言标签，所以不会把 `TextRef` 误判成 `LocaleMap`（前端审查里 nb-form 把无参数引用误判的问题由此消除）。
- **参数**：值只能是字符串或有限数字。字符串超过 500 字就截断、加省略号并记诊断；其它类型不传，记诊断，不静默丢弃。各错误域可以收得更紧，并在自己的 Spec 里写明。
- **跨插件传递**：运行期文字（状态栏条目、公开状态的原因、快速选择项、通知的标题与正文）都传 `Text`，接收方在渲染时翻译，切换语言后会更新。
- **并存期**：迁移期间 `LocalizedText` 作为 `LocaleMap` 继续有效。登记校验里那 10 处 `LocalizedTextSchema` 先换成 `TextSchema`（三种形态的联合），这一步不改变行为，之后按插件把字面双语改成约定键。nb-agent-ui 的 `{key, params}` 改成命名空间为 `nb-agent-ui` 的 `TextRef`；`MessageView` 里折好的字符串改成 `Text`。
- **类型放在哪**：`Text`、`TextRef`、`LocaleMap` 与翻译端口放在 nb-ui（四个共享包都已依赖它）；应用的插件 SDK 重新导出。

### 4. 宿主引擎

每个浏览器实例一个 `i18next.createInstance`，不用全局单例（同进程跑多个测试文件时会串）。宿主在它外面包一层翻译函数，拦住原型和审查发现的默认行为：

- `interpolation.escapeValue: false`：交给 Vue 转义，否则路径会变成 `a&#x2F;b`；
- 关掉 nesting，目录检查拒绝 `$t(`：否则目录里的值能跨命名空间取文字；
- `nsSeparator: false`，命名空间一律经选项传；`keySeparator` 保持 `.`。只经选项传不够：i18next 仍会先从键里解析命名空间，审查实测 `t("other:title", {ns: "own"})` 取到的是 `other` 的文字；
- 回退链自己走：当前语言 → 该命名空间的源语言（来自清单的 `l10n.source`，内置插件与共享包是 zh-CN）→ en-US → 键名。落到键名时记一次诊断，测试里直接抛错；
- 数量参数必须是有限数字：`count` 不是数字时不走复数，并记诊断（原型里 i18next 会静默返回键名）；
- 热重载先注销再登记：`addResourceBundle` 即使 `deep=false` 也是浅合并。

**翻译端口**：

```ts
interface TextPort {
    readonly locale: Readonly<Ref<string>>;
    t(text: Text): string;
    /** 各语言的写法，给命令面板与设置搜索比对用。 */
    variants(text: Text): readonly string[];
}
```

宿主经 provide/inject 交出它。三个独立的 `createApp` 根各自注入；纯 TS 模块由调用方传入。原型验证过：用一个 `shallowRef` 版本号，监听语言切换和目录增删，组件不重新挂载就会更新。共享包的默认目录由宿主在引导时一并登记进引擎。

### 5. 语言与引导

- **界面语言集合**：宿主内置目录有的语言，现在是 zh-CN、en-US。`nbook.settings/locale` 的 schema 从写死的两元联合改为字符串，按这个集合校验，选项也由它生成；`DisplayLocale`、`PromptLocale`、`MarkdownLocale` 改为字符串。所以加语言要加目录文件，代码里的语言类型不用再改（迁移时改一次）。第三方插件不能新增界面语言。
- **语言的来源**：设置快照里的 `locale`。宿主收到设置快照、并且 `locale` 来自快照（不是默认值）时，把它记进浏览器本地存储，做法同 `web/host/appearance-hint.ts`。设置快照超时、或引导失败时用这份记录，没有记录才用 zh-CN（w00031 Work README 第 8 条）。语言变了同步更新 `<html lang>`。
- **静态文字**：失败页、`NotFoundPage`、离线横幅、`index.html` 与 `boot.ts` 里的静态文字进宿主目录。加载页在脚本之前就要显示，它的两种语言写在内联脚本里，由测试核对与宿主目录一致。
- **一次取齐所有语言**：切换语言因此是同步的，设置搜索照旧比对多种语言（`variants`）。体积在迁移时实测；语言变多、超出预算时改为“当前语言加源语言”，预算在实施计划里定。

### 6. 共享包

- **端口与最小实现**：nb-ui 提供翻译端口与一份最小实现，只支持原生格式的插值与 `_one`/`_other`，原型里 31 行，16 个用例与 i18next 输出一致。
- **读注入的组件**：nb-ui 的叶子组件读注入时，在组件 `.md` 的 frontmatter 里声明 `state:inject`（`docs/standards/code/components.md` 的能力标签；`Dialog` 读宿主传送目标已有先例）。模板里写死、没有属性的文字只能这样处理。
- **包自带目录**：每个共享包自带 `locales/`，加进包的 `files`。核心层（纯 TS）只产出 `TextRef` 或码与参数，由 Vue 层翻译。
- **宿主没有注入时**：包的根组件用自带的目录和最小实现提供端口，嵌套的 nb-ui 控件因此也拿得到。已发布的 `locale` 属性只在没有注入时起作用，决定用哪份默认目录；有注入时以注入为准。nb-story 查看器不注入，照旧单语中文（w00031 Work README 第 9 条）。
- **单独挂载的 Vue 树**：nb-markdown 的两处 `render()`，挂载时带上宿主的 `appContext`。
- **JSON 的导入**：共享包在源码里导入 JSON 目录，消费者的 TypeScript 要开 `resolveJsonModule`（审查实测，`node16`、`node10` 下不开会报 TS2732）。包按 ADR 0029 只承诺 Bun；实施时二选一：在包的 README 写明这个要求，或者把目录包成 `.ts` 模块再导出。

### 7. 失败文案

- **不新增全局错误对象**：各错误域在自己的合同里带码；需要参数时，由各域用闭合 schema 定义（ADR 0034 决策 2），参数值遵守第 3 节的共用约束。
- **消息键**：`errors.<码>`，放在拥有者的命名空间里。
  - 现有的码不改名（包括带下划线的）；
  - 只拒绝会破坏取键的码：含 `:`、`.`、空白，或超过 64 个字符。这类码一律按未知码处理，拼键之前先校验。
- **谁拥有码**：
  - 远程路由的 10 个码归宿主的远程文案（应用的命名空间，内核不带文字）；
  - 远程方法在 `errors` 里声明的业务码，归声明它的插件；
  - 各插件、各包自己结果里的码，归各自所有。
- **闭合的错误域**：码表是唯一的来源，例如远程合同的 `errors` 键、`as const` 数组。它同时约束生产者的类型、目录检查和运行期；目录检查核对拥有者的源语言目录覆盖了全部码，并且没有多余的键。
- **开放的错误域**：不承诺穷举。拥有者已知、它的目录里有 `errors.<码>` 时照常显示；拥有者不明、码不合格，或目录里没有这一条时，走未知码兜底。
- **未知码兜底**：宿主目录里一条中性文案，只陈述收到了一个不认识的结果码，并附上码，不说“失败”或“未保存”。
- **用户或插件作者要照着改的校验原因**（设置文件解析错误、插件声明问题）：按码本地化，参数带位置与路径，作为主文案显示，不收进详情。

### 8. 检查

- **编译期**：内置代码用带类型的取文字辅助函数。键从源语言目录推导，要写一个把嵌套对象展开成点号路径的类型（`resolveJsonModule` 加 `keyof typeof` 只给顶层键）。参数名推导不出来，由下面两项补上。
- **目录检查**（进 `governance:check`）：
  - 各语言相对源语言的缺键与多余键；
  - 占位符集合一致；
  - 英文要有 `_one` 与 `_other`（原型发现：缺 `_one` 时，`count` 为 1 不会退到 `_other`）；
  - 不含 `$t(`；
  - 闭合错误域的码表穷举。
- **声明测试**：装载全部内置插件的定义，枚举每个声明推导出的约定键和显式写的键，逐个核对在目录里存在。
- **测试环境**：缺键、缺插值参数时抛错（i18next 的缺插值回调）。
- **lint**：Vue 模板和 TS 里新增的界面字面文字，先只告警。

### 备选方案

- **内联双语扩成多语言**：每加一种语言都要改所有调用点，接翻译平台还要另做提取。否决理由见 ADR 0034。
- **vue-i18n**：带 Vue 运行时依赖，无框架的共享核心不能直接依赖它（ADR 0034）。
- **一律显式写键**：作者每个声明都要多写一层对象。开发者 2026-10-27 定为按约定取键。
- **清单与目录各存一份名称**：两处会不一致。开发者定为从目录摘出。
- **按语言懒取目录**：切换语言时有乱序响应和闪出键名，设置搜索也比对不到别的语言。等语言变多、超出预算时再改。
- **全局的失败值类型放进 nb-runtime**：会撞上闭合的远程结果合同（`additionalProperties: false`），也违反“内核与应用无关”（ADR 0030）。所以各域在自己合同里定参数，只共用参数约束。
- **统一把码改成 kebab-case**：要改 nb-story、harness 的线上码与旧记录，收益只是好看。

## 影响

- **数据**：没有持久化的界面文字，不用迁移数据；设置里的 `locale` 值不变。
- **线协议帧**：不变。
- **业务合同**：
  - `nbook.commands/remote` 的 `list`：`title` 改为 `Text`，合同升到版本 2；
  - `nbook.plugins/registry`：安装与预览的失败码加 `catalog-invalid`，合同升到版本 5；
  - 宿主新增目录端点。

  各错误域把句子改成码与参数的合同变化，归 w00031 t03。
- **公开接口**：

  | 包 | 变化 |
  |---|---|
  | nb-runtime | 清单 schema 加 `l10n` 字段 |
  | nb-ui | 新增 `Text`、`TextRef`、`LocaleMap`、翻译端口、最小实现与自带目录；读注入的组件在 `.md` 里声明 |
  | nb-form | `FormText` 归入 `LocaleMap`，回退规则不变；支持 `TextRef` |
  | nb-agent-ui | `ViewText` 与 `MessageView` 里的文字字段改为 `Text` |
  | nb-markdown | 自带目录；`MarkdownLocale`、`PromptLocale` 改为字符串；单独挂载的树带 `appContext` |
  | nb-story | 查看器不变，依赖升级 |
  | 插件 SDK | 还没发布（ADR 0030），直接切换：去掉 `localize`、`formatText`，加 `text()`；构建时校验并复制 `locales/` |

  `locale` 属性保留。版本号与发布顺序在实施计划里定，发布逐次授权。
- **迁移**：
  - 约 1180 处内联文字用脚本按插件抽进目录；
  - `plugin-sdk/` 下 9 个示例与测试文件一起改；
  - 断言中文文字的测试改成按键或结构断言。
- **回滚**：先落地端口、宿主引擎与 `TextSchema`，这一步不改变行为；之后按插件分片迁移，每片可以单独回退。业务合同升版本的两片要随消费者一起发布。

## 对 Spec 的预期改动

- `runtime/plugin-manifest.md`：`l10n` 字段与形状校验；清单名称与说明从目录摘出。
- `runtime/plugin-install.md`：复制 `locales/`；新增安装失败码 `catalog-invalid`。
- `runtime/plugin-code-loading.md`：目录端点与按版本摘要寻址；目录集合与登记集合分开。
- `runtime/plugin-hot-plug.md`：目录的在线替换（与热插拔一起实施）。
- `runtime/plugin-api.md`：SDK 的 `text()`；去掉 `localize`、`formatText`。
- `runtime/browser-host.md`：引导时语言的来源与本地记录；静态文字；`<html lang>`。
- `state/public-state.md`：原因改为 `Text`，登记时补命名空间。
- `workbench/notifications.md`：标题与正文改为 `Text`（与 t04 协调，t04 只管详情与常驻）。
- `workbench/commands.md`（含远程 `list` 版本 2）、`workbench/menus.md`、`workbench/views.md`、`workbench/editor.md`、`workbench/quick-open.md`、`settings/settings-window.md`、`settings/configuration.md`：声明字段改为约定键、文字引用或字面文字；`locale` 的选项由宿主目录生成。命令 `description` 不变。
- `ui/forms.md`：`FormText` 归入 `LocaleMap`。
- 新建 `ui/i18n.md`：文字值、翻译端口、宿主引擎的行为、回退链、参数约束、检查。
- 各共享包组件的同名 `.md`：`locale` 属性与注入的优先级、`state:inject`。

## 待定项

1. 接受本提案。接受后由 w00028 t03 实施，w00031 t03 按错误域设计失败投影。
2. 第三方插件不能新增界面语言，等语言包另议。界面语言集合由宿主内置目录决定。推荐：同意。
3. nb-ui 的叶子组件读注入（在 `.md` 里声明 `state:inject`，有 `Dialog` 的先例），还是一律由调用方传文字属性。推荐：读注入。模板里写死、没有属性的文字只能这样处理；改成调用方传属性，要改几十处调用点，调用方也容易漏传。
4. 插件升级后的新目录要重启才生效，等热插拔实施时再做在线替换。推荐：同意，因为热插拔本身还在规划。

## 决策记录

- 2026-10-27，开发者：接受本提案；待定项 2 到 4 按推荐（第三方插件不能新增界面语言；nb-ui 叶子组件读注入并声明 `state:inject`；插件升级后的新目录重启生效，在线替换随热插拔）。简单的迁移可以视情况派 Haiku 或 Sonnet 子代理，先做实验确认 Haiku 是否够用。
- 2026-10-27，实施计划（w00028 t03，待开发者追认）：`nbook.settings/locale` 不改成字符串，而用共享常量 `HOST_LOCALES` 生成可序列化的枚举与选项；校验效果与“按集合校验”相同，不需要新增值校验入口。
