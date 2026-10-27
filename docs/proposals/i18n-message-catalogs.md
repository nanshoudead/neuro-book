---
schema: nbook.proposal/v1
status: reviewing
created: 2026-10-27
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# 界面文字的消息目录

## 问题

界面文字现在直接写在代码里，每处一对 `{zh-CN, en-US}`。应用、nb-agent-ui、nb-form、nb-markdown 四处各有一套类型与代入函数；英文复数只有 nb-agent-ui 处理了；要加第三种语言就得改所有调用点；文字分散在代码里，接不上翻译平台。失败说明另有一个问题：各合同里的 `reason`、`message`、`detail` 既当诊断又当界面正文，用户看到的语言取决于写错误的人用了什么语言（w00031 t02 的通道矩阵）。

[ADR 0034](../adr/0034-language-policy.md) 决策 3 定了方向：每个插件、每个共享包自带按语言分的 JSON 消息目录，用 i18next 的原生格式，共享包不依赖 i18n 库。本提案把这个方向落成机制，并给各错误域的失败文案定共用的写法。

## 目标与非目标

目标：

- 插件作者和共享包作者在目录里写文字，声明按约定取键，偏离约定时才写键；
- 加一种界面语言只加目录文件，不改声明和组件；
- 切换语言时，已打开的界面不重新挂载就换文字；
- 写错键、漏翻译、两种语言的占位符不一致，在检查或测试里就能发现；
- 各错误域的失败文案按“拥有者 + 码”取，不认识的码有中性兜底。

非目标：翻译平台的接入流程；第三方插件新增界面语言（语言包）；作品正文与 Agent 输出的本地化；开发诊断的翻译（ADR 0034 定为英文）；失败“详情”的界面载体（[w00028 t04](../../.agents/works/w00028-i18n/tasks/t04-failure-details/README.md)）；各错误域具体的码与参数（w00031 t03）。

## 当前行为与证据

- 界面文字：约 1180 处 `"en-US"`、124 个文件（非测试 110 个）；`LocalizedTextSchema` 是闭合的两个必填字段（`packages/neuro-book/src/shared/localized-text.ts`）。
- 声明里的文字：命令标题、视图标题、设置项、菜单项都是内联双语（`docs/specs/workbench/menus.md`、`views.md`、`settings/settings-window.md`）；`packages/neuro-book/src/shared/settings.ts` 与 `src/plugins/settings/shared/sections.ts` 写死 `LocalizedTextSchema`。
- 共享包：nb-agent-ui 的 `ViewText` 有包内键 `{key, params}`；nb-form 的 `FormText` 是开放语言集合的公开类型；nb-markdown 有一处单独 `render()` 挂载的 Vue 树（`image-views.ts`），注入到不了。
- 引导：显示语言来自设置快照，每层首份快照最多等 3 秒，超时按默认值 zh-CN 继续（`docs/specs/settings/configuration.md` 输出 16）；`HostPage`、`PageOutlet`、`FailurePage` 是三个独立的 `createApp`；两份 `index.html` 与 `boot.ts` 里有静态中文。
- 插件交付：内置插件随前端构建，浏览器引导只拿到 id 与版本；第三方插件由 SDK 构建出产物，`buildPlugin` 只输出入口的 `.js`/`.map`、`style.css` 与生成的 `package.json`，安装器按产物的 `files` 复制，插件文件路由按服务端启动时的快照服务（`src/plugin-platform/build/build-plugin.ts`、`src/server/plugins.ts`）。
- i18next 26.5.11 原型（[w00028 t02](../../.agents/works/w00028-i18n/tasks/t02-library-prototype/README.md)）：成立，gzip 14.2 KB；但默认行为有几处不合用，见方案第 4 节。

## 方案

### 1. 目录与交付

- **目录**：每个插件、每个共享包有一份 `locales/<语言>.json`，命名空间是插件 id 或包名。语言标签按 `Intl.getCanonicalLocales` 规范化。
- **清单**：第三方插件的清单加 `l10n: {source, locales}`，`source` 必须在 `locales` 里，列表不重复。字段形状属于清单合同：形状不对，按现有规则整份清单无效。
- **两条交付路径，同一个登记接口**：
  - **内置插件**：目录由插件定义模块静态导入，随前端构建进包；插件在浏览器登记时同时登记它的目录。
  - **第三方插件**：SDK 构建读取并校验 `locales/`（源语言齐全、列出的文件存在、JSON 是扁平或嵌套的字符串对象），复制进产物并列入 `files`。安装器照现有规则复制。浏览器在插件登记时，经插件文件路由按同一个版本摘要取齐所有列出语言的目录。目录与入口代码共用版本摘要，热插拔时随入口代码一起换。
- **目录取不到或坏了**：插件照常登记（文字不是功能）。该插件的文字按第 4 节的回退链显示，插件页显示问题，并记诊断。安装时发现目录坏了，按新的安装失败码 `catalog-invalid` 拒绝安装。
- **清单的名称与说明**：从目录摘出。SDK 构建把源语言目录里的 `manifest.displayName`、`manifest.description` 写进生成的清单，插件页不执行插件代码就能列出插件；显示时按当前语言取目录。内置插件同理，由应用构建从目录取。目录是唯一的来源，不在两处各写一份。

### 2. 键与声明：按约定取键

- 声明里需要显示的字段，**没写就按约定取键**：
  - 命令：`commands.<命令名>.title`、`.category`；
  - 视图：`views.<视图名>.title`；
  - 设置项：`settings.<设置名>.title`、`.description`、`.placeholder`、`.choices.<值>`；
  - 菜单项：`menus.<菜单>.<项>.label`；
  - 清单：`manifest.displayName`、`manifest.description`。

  这里的“名”是去掉插件前缀的本地名。
- **偏离约定时**写成 `{key: "..."}`，指本插件命名空间里的另一个键；**写字符串**就是不翻译的字面文字。
- 插件不能引用别的命名空间的键：宿主在登记声明时给键补上插件自己的命名空间。

### 3. 文字值

只有一种类型：`Text = string | TextRef`。

- `TextRef` 带命名空间：`{ns, key, params?}`，`params` 是 `Record<string, string | number>`。
- 插件代码用自己上下文里的 `ctx.text(key, params)` 构造，命名空间由插件身份绑定，不能伪造；声明里的 `{key}` 由宿主在登记时补命名空间。
- 跨插件传递的运行期文字（状态栏条目、公开状态的原因、快速选择项、通知的标题与正文）都传 `Text`，接收方在渲染时翻译，所以切换语言后会更新。
- nb-agent-ui 的 `{key, params}` 就是命名空间为 `nb-agent-ui` 的 `TextRef`。nb-form 的开放语言集合 `FormText` 保留为第三种字面形态，渲染时按当前语言取，取不到用源语言。

### 4. 宿主引擎

每个浏览器实例一个 `i18next.createInstance`，不用全局单例（同进程跑多个测试文件时会串）。宿主在它外面包一层翻译函数，拦住原型发现的默认行为：

- `interpolation.escapeValue: false`：交给 Vue 转义，否则路径会变成 `a&#x2F;b`；
- 关掉 nesting，目录检查拒绝 `$t(`：否则目录里的值能跨命名空间取文字；
- 不用 `ns:key` 的写法，命名空间经选项传：否则码里的 `:` 会被静默改写成 `.`，取到别的文案；
- 回退链自己走：当前语言 → 该命名空间的源语言 → en-US → 键名。i18next 的 `fallbackLng` 只认语言，表达不了“插件自己的源语言”。落到键名时记一次诊断，测试里直接抛错；
- `count` 等数量参数必须是有限数字：不是时不走复数，记诊断（原型里 i18next 会静默返回键名）；
- 热重载先注销再登记：`addResourceBundle` 即使 `deep=false` 也是浅合并。

Vue 侧经 provide/inject 交出 `useText()`，内含当前语言与 `t`。三个独立的 `createApp` 根各自注入。纯 TS 模块由调用方传入 `t`。原型验证过：用一个 `shallowRef` 版本号，监听语言切换和目录增删，组件不重新挂载就会更新。

### 5. 语言与引导

- **界面语言集合**：宿主内置目录有的语言，现在是 zh-CN、en-US；`nbook.settings/locale` 的选项由它生成。第三方插件不能新增界面语言。
- **语言的来源**：设置快照里的 `locale`。宿主每次切换语言，就把它记进浏览器本地存储，做法同 `web/host/appearance-hint.ts`。设置快照超时、或引导失败时用这份记录，没有记录才用 zh-CN（w00031 Work README 第 8 条）。
- **静态文字**：失败页、加载页、`index.html` 与 `boot.ts` 里的静态文字进宿主目录。加载页在脚本之前就要显示，它的两种语言写在内联脚本里，由测试核对与宿主目录一致。
- **一次取齐所有语言**：浏览器在插件登记时取齐这个插件的所有语言，切换语言是同步的；设置搜索照旧比对多种语言。体积在迁移时实测；语言变多、超出预算时改为“当前语言加源语言”，预算在实施计划里定。

### 6. 共享包

- nb-ui 提供翻译端口，包括注入键、`useText()` 和一份最小实现。最小实现只支持原生格式的插值与 `_one`/`_other`，原型里 31 行，16 个用例与 i18next 输出一致。nb-ui 的叶子组件读注入时，在组件 `.md` 里声明这项能力（`docs/standards/code/components.md`）。
- 每个共享包自带 `locales/`，加进包的 `files`。核心层（纯 TS）只产出 `TextRef` 或 `{code, params}`，由 Vue 层翻译。
- **宿主没有注入时**：组件用包自带的目录和最小实现。已发布的 `locale` 属性保留，决定用哪份默认目录；有注入时以注入为准。nb-story 查看器不注入，照旧单语中文（w00031 Work README 第 9 条）。
- **单独挂载的 Vue 树**：nb-markdown 的 `render()` 这类，挂载时带上宿主的 `appContext`，或由调用方显式传 `t`。
- nb-ui 写死的中文默认文案进 nb-ui 自己的目录。

### 7. 失败文案

- **不新增全局错误对象**：各错误域在自己的合同里带码；需要参数时，由各域用闭合 schema 定义（ADR 0034 决策 2）。
- **消息键**：`errors.<码>`，在拥有者的命名空间里。码是 kebab-case（`[a-z0-9-]`，至多 64 个字符）。拼键之前先校验码，不合格的一律按未知码处理。
- **闭合的错误域**：码表是唯一的来源，例如远程合同的 `errors` 键，或 `as const` 数组。它同时约束生产者的类型、目录检查和运行期。目录检查核对拥有者的源语言目录覆盖了全部码，没有多余的键。
- **开放的错误域**：第三方插件自定义的码、`RemoteFailure.code` 这类字符串，不承诺穷举，只走未知码兜底。
- **未知码兜底**：宿主目录里一条中性文案，只陈述收到了一个不认识的结果码，并附上码，不说“失败”或“未保存”。
- **用户或插件作者要照着改的校验原因**（设置文件解析错误、插件声明问题）：按码本地化，参数带位置与路径，作为主文案显示，不收进详情。

### 8. 检查

- **编译期**：内置代码用带类型的取文字辅助函数，键从源语言目录推导（`resolveJsonModule` 加 `keyof typeof`）。参数名推导不出来，由下面两项补上。
- **目录检查**（进 `governance:check`）：
  - 各语言相对源语言的缺键与多余键；
  - 占位符集合一致；
  - 英文要有 `_one` 与 `_other`（原型发现：缺 `_one` 时，`count` 为 1 不会退到 `_other`）；
  - 不含 `$t(`，键不含 `:`；
  - 闭合错误域的码表穷举；
  - 内置插件的约定键都存在（一条测试装载全部内置插件的定义，枚举声明推导出的键）。
- **测试**：缺键、缺插值参数时抛错。
- **lint**：Vue 模板和 TS 里新增的界面字面文字，先只告警。

### 备选方案

- **内联双语扩成多语言**：每加一种语言都要改所有调用点，接翻译平台还要另做提取。否决理由见 ADR 0034。
- **vue-i18n**：带 Vue 运行时依赖，无框架的共享核心不能直接依赖它（ADR 0034）。
- **一律显式写键**：作者每个声明都要多写一层对象。开发者 2026-10-27 定为按约定取键。
- **清单与目录各存一份名称**：两处会不一致。开发者定为从目录摘出。
- **按语言懒取目录**：切换语言时有乱序响应和闪出键名，设置搜索也比对不到别的语言。等语言变多、超出预算时再改。
- **全局的失败值类型放进 nb-runtime**：会撞上闭合的远程结果合同（`additionalProperties: false`），也违反“内核与应用无关”（ADR 0030）。各域在自己合同里定参数。

## 影响

- **数据**：没有持久化的界面文字，不用迁移数据；设置里的 `locale` 值不变。
- **线协议**：不变。失败文案在浏览器端取，跨进程照旧只传码与各域合同里的参数。
- **公开接口**：

  | 包 | 变化 |
  |---|---|
  | nb-runtime | 清单 schema 加 `l10n` 字段 |
  | nb-ui | 新增翻译端口、自带目录；读注入的组件在 `.md` 里声明 |
  | nb-form、nb-agent-ui、nb-markdown | 自带目录，支持注入的 `t`；`locale` 属性保留 |
  | nb-story | 查看器不变，依赖升级 |
  | 插件 SDK | 还没发布（ADR 0030），直接切换：去掉 `localize`、`formatText`，加 `ctx.text`；构建时校验并复制 `locales/` |

  版本号与发布顺序在实施计划里定，发布逐次授权。
- **迁移**：约 1180 处内联文字用脚本按插件抽进目录；断言中文文字的测试改成按键或结构断言。
- **回滚**：实施按插件分片，每片可以单独回退；端口和宿主引擎先落地，没有消费者时不改变行为。

## 对 Spec 的预期改动

- `runtime/plugin-manifest.md`：`l10n` 字段与形状校验；清单名称与说明从目录摘出。
- `runtime/plugin-install.md`：复制 `locales/`，新增安装失败码 `catalog-invalid`。
- `runtime/plugin-code-loading.md`：目录这种资源，与入口代码共用版本摘要；登记前取齐。
- `runtime/plugin-hot-plug.md`：目录随入口代码一起换与撤回。
- `runtime/browser-host.md`：引导时语言的来源与本地记录；静态文字。
- `workbench/commands.md`、`workbench/menus.md`、`workbench/views.md`、`workbench/editor.md`、`settings/settings-window.md`、`settings/configuration.md`：声明字段改为约定键、`{key}` 或字面字符串；`locale` 的选项由宿主目录生成。命令 `description` 不变。
- 新建 `ui/i18n.md`：文字值、宿主引擎的行为、回退链、检查。
- 各共享包组件的同名 `.md`：`locale` 属性与注入的优先级。

## 待定项

1. 接受本提案。接受后由 w00028 t03 实施，w00031 t03 按错误域设计失败投影。
2. 第三方插件不能新增界面语言，等语言包另议。推荐：同意。
3. nb-ui 的叶子组件读注入（在 `.md` 里声明能力），还是一律由调用方传文字属性。推荐：读注入。后者要改几十处调用点，而且调用方容易漏传。

## 决策记录

无（等开发者）。
