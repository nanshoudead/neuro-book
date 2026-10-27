# t03 实施计划：消息目录落地与迁移（第二版）

## Context

开发者 2026-10-27 接受了 [《界面文字的消息目录》](../../../../../docs/proposals/i18n-message-catalogs.md)（决策记录写明待定项 2 到 4 按推荐）。本 Task 按提案落地，提案的方案是设计依据，本计划只写切片、边界、文件与验收。

第一版计划的审查（omp 10 条、Claude Sonnet 前端 14 条，`evidences/plan-review-*.txt`）指出切片边界与兼容窗口没想清楚，本版按它重排。处理记录在末尾。

开发者已确认的决定：提案的决策记录；w00028 Work README“方向”；w00031 Work README 第 8、9、11 条。简单迁移的分派按 [Haiku 实验](evidences/haiku-experiment.txt) 的结论（`~/.claude/CLAUDE.md` 分派表已更新）。

工作方式：自主推进；Spec 随实现分支提交（`.agents/works/README.md`：实现分支带代码、测试、Spec 与文档；根 `AGENTS.md` 写的“Spec 在 master 更新”与它冲突，交付时作回写建议）；代码在 Work 分支 `feat/w00028-i18n`（worktree `.worktree/w00028-i18n`） 的 worktree 里改；每片先改 Spec（按 `writing-specs`）再改代码、自跑验证、单独提交；跨合同的改动（schema、版本、调用方、Spec）放在同一片里原子提交。

## 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 翻译引擎 | i18next 26.5（ADR 0034、t02 原型） | — |
| 嵌套键的点号路径类型 | 自写递归类型 | 生成类型的脚本 |
| 内联文字抽取 | 一次性脚本：`.ts` 用 TypeScript 编译器 API；`.vue` 先用 `@vue/compiler-sfc` 取出 `<script>` 块再同样处理；只改写无插值或 `{name}` 插值的字面量，其余列清单人工改；脚本同时输出“键 → 旧字面量”对照表 | 正则替换：多行与嵌套会漏 |
| 共享包的默认目录 | 写成 `.ts` 模块（`locales/zh-CN.ts` 默认导出对象），由包的 `./locales` 子路径导出；应用与插件的目录仍是 JSON | JSON 加 `resolveJsonModule`：nb-story、dev-panel 等消费方都没开，导入即 TS2732，外部消费者也要跟着改配置（提案允许的另一种写法） |

## 边界（各片都遵守）

- **两层**：纯数据层（`Text` 类型、判别、`LocaleMap` 解析、`TextRef` 构造，没有 Vue、没有 i18next，服务端可用）与浏览器端口层（i18next 引擎、`TextPort`、`useText()`）。`shared/localized-text.ts` 这类服务端也会加载的模块只依赖纯数据层。
- **服务端不翻译 `TextRef`**：服务端路径（命令的 `when` 求值、设置合同里的 `switchSetting` 等）在本 Task 里继续只产出 `LocaleMap` 或字符串；改成结构化失败的那部分随 w00031 的失败投影一起切。
- **一个语言来源**：引擎的当前语言由宿主驱动：设置插件激活前用本地记录，激活后订阅它的 `locale`。过渡期还在往下传 `locale` 属性的地方，由宿主从同一个来源传，不另读设置。

## 切片

验证统一是受影响包的 `bun run test:affected` 与 `typecheck`；涉及界面的跑相关 Lab 截图与 e2e 文件；收口时全量 e2e。每片列出改的 Spec 与新增的测试入口。

### 第 1 片：纯数据层与端口（nb-ui）

- Spec：新建 `ui/i18n.md`（`planned`）：文字值、判别、参数约束、端口、回退链、检查；每条输出编号对应下面的测试。
- 代码：nb-ui 新子路径 `./text`（纯 TS，不引 Vue）：`Text`、`TextRef`、`LocaleMap`、判别函数、`resolveLocaleMap`、参数整理；子路径 `./text-port`（Vue）：`TextPort` 注入键、`useText()`；注入键的缺省值是 nb-ui 自带目录加最小实现的端口（zh-CN），没有宿主的场景（nb-story、dev-panel、nb-ui 自己的测试、Lab 里单独挂载）照常显示中文。
- `TextSchema`（TypeBox）放应用的 `src/shared/text.ts`（nb-ui 不依赖 TypeBox），只引 nb-ui 的 `./text`。
- 测试：纯数据层与最小实现的单测，按 `ui/i18n.md` 的条目编号写。不改任何现有行为。

### 第 2 片：语言类型改字符串（锁步合同片）

- 同片改 `DisplayLocale`、`MarkdownLocale`、`PromptLocale`、`AgentLocale` 为 `string`，以及 `markdown/web/host.ts` 的锁步断言；`localize`、`textOf` 里的 `text[locale]` 改用纯数据层的 `resolveLocaleMap`（取不到当前语言取 `en-US`，再取第一项，与现有 `FormText` 回退一致）。包内按两种语言写的文字表在本片保持原样（表的键仍是 `"zh-CN" | "en-US"`，查表经 `resolveLocaleMap`），迁移在后面的片。语言集合是一个共享常量 `HOST_LOCALES`（纯模块，服务端、项目、浏览器共用）。
- `nbook.settings/locale` 的 schema 保持可序列化的枚举，枚举值与 `choices` 都由 `HOST_LOCALES` 生成；切换语言命令的参数也由它生成。加一种语言只改这个常量与宿主目录。
- Spec：`settings/configuration.md`（`locale` 的取值来源）、`workbench/commands.md`（切换语言命令）。
- 命令：`bun run --cwd packages/nb-markdown typecheck && bun test`、`nb-agent-ui`、`nb-form`、`neuro-book` 同样各跑 `typecheck` 与 `test`。
- 测试：用一个按语言集合生成设置定义的工厂，跑假设第三种语言的组合用例：两种写入入口与文件读取都接受集合里的语言、拒绝集合外的；命令参数与设置选项一致。

### 第 3 片：宿主引擎与引导

- Spec：`runtime/browser-host.md`（语言来源与本地记录、静态文字、`<html lang>`）。
- 代码：共享包目录登记表：宿主在引导时从 `@notnotype/nb-ui/locales`、`@notnotype/nb-form/locales`、`@notnotype/nb-agent-ui/locales`、`@notnotype/nb-markdown/locales` 导入各包目录，按包名登记（各包在第 1 片或各自的片里加这个子路径；没有的包先登记空目录）；七处各自 `computed(displayLocale(settings))` 的写法在本片改为读端口的 `locale`。`src/web/host/i18n.ts`：`createInstance`；包装层（不转义、关 nesting、`nsSeparator: false`、按命名空间的源语言回退、数量参数校验、热重载先注销再登记）；`TextPort` 实现与 `variants`；语言由宿主驱动（见“边界”）；三个 `createApp` 根注入；本地记录照 `appearance-hint.ts`，只由收到的设置快照写入；失败页、`NotFoundPage`、离线横幅、`boot.ts`、两份 `index.html` 的静态文字进宿主目录，内联脚本的两种语言由测试核对。
- 测试（按 `ui/i18n.md` 条目，和原型的探索测试分开）：`escapeValue` 关闭后参数里的 `/`、`<` 原样；最小实现与宿主引擎对同一组用例输出一致；非中文源语言的命名空间回退、缺参数在测试环境抛错、数量参数非有限数、501 字参数、键里的冒号与 nesting 被拒、目录注销再登记、切换语言不重新挂载。

### 第 4 片：声明的文字类型（schema 替换）

- 9 个文件 22 处 `LocalizedTextSchema` 换成 `TextSchema`。**这改变行为**：单语言写法、纯字符串原先被拒，之后合法（字符串是字面文字）。同片改 `settings/configuration.md` 输出 1、21 与 `shared/settings.test.ts` 里对应的断言，测试名写明“改为接受”。
- **不含**：命令声明的 `title`、`category`（远程 `list` 直接转发它们，随第 6 片与合同版本 2 一起放宽）；公开状态的 `reason`（服务端也求值，随第 6 片）。这两处本片仍是 `LocalizedTextSchema`。
- **消费方**：设置窗口（`createSettingsWindow` 里读 `options.locale.value` 的 12 行）、命令搜索 `searchCommands`、`otherTexts` 等纯 TS 函数改为接收 `TextPort`（`t` 与 `variants`），不再收 `locale`；`otherTexts` 不能再用 `Object.entries` 遍历文字（遇到 `TextRef` 会把 `kind`、`key` 当成语言写法），改用 `variants`。动手前先列全调用点（粗查下限 34 处、18 个文件）。
- 浏览器渲染处显式取端口的 `t`；服务端路径照旧用纯数据层解析 `LocaleMap`。
- 测试：全部内置插件装载（服务端与浏览器两端），声明照常登记、标题照常显示。

### 第 5 片：目录交付、清单与引导协议

- Spec：`runtime/plugin-manifest.md`（`l10n`、名称从目录摘出）、`runtime/plugin-install.md`（复制 `locales/`、`catalog-invalid`）、`runtime/plugin-code-loading.md`（目录端点、目录集合与登记集合分开）、`runtime/browser-host.md`（引导响应里的目录索引、修订号、非致命的目录问题）、`runtime/plugin-hot-plug.md`（在线替换留给热插拔）。
- 代码：nb-runtime 清单 schema 加 `l10n`；内置插件定义静态导入目录；`shared/browser-bootstrap.ts` 的引导响应加目录索引（插件 id、源语言、语言列表、摘要），修订号把它算进去；服务端目录端点；窗口取齐目录，取不到或坏了进插件问题通道，不让整窗启动失败；SDK 构建校验并复制 `locales/`；安装与预览校验，失败码 `catalog-invalid`，`nbook.plugins/registry` 升到版本 5。
- 验收场景：① SDK 缺源语言、非法 JSON、非字符串叶子时构建失败；② 手写清单的坏目录让预览与安装都返回 `catalog-invalid`；③ `files` 漏了目录文件时安装拒绝且不留安装目录与登记；④ 安装后目录损坏或端点 404，插件功能照常、窗口里看得到目录问题；⑤ 升级后新目录重启才生效，核对新旧摘要；⑥ 只有后端入口、没有顶层声明的插件不进浏览器登记集合，但目录取得到。

### 第 6 片：约定键、SDK 贡献助手与运行期文字

- Spec：各贡献点的约定键写进 `workbench/commands.md`（远程 `list` 升版本 2）、`menus.md`、`views.md`、`editor.md`、`quick-open.md`、`ui/workbench-shell.md`（输出 33、36、40：状态栏、标题栏、活动栏底部条目与首页）、`settings/settings-window.md`、`state/public-state.md`、`runtime/plugin-api.md`（SDK 助手）。
- 代码：
  - 补键与命名空间只在一处：宿主登记时。`defineSetting`、`defineSettings` 的加载期检查不再要求写标题；SDK 的 6 个贡献助手（command、section、setting、view、statusItem、settingsPage）去掉 `localizedText` 改写，字段可省略；
  - 状态栏、标题栏条目运行期的 `text()`、`tooltip()` 返回 `Text`，消费注册表渲染时翻译；
  - `RemoteCommandSchema.title` 改为 `Text`，合同版本 2，所有调用方与远程往返用例同片；
  - 目录检查脚本进 `governance:check`；声明测试；内置代码的带类型取文字辅助函数。
- 验收：经真实运行实例，省略标题的命令与设置分别从内置代码、SDK 助手、手写清单进入消费表，得到所属插件的引用；缺目录键时由声明测试报告；一个经贡献服务交出的状态栏条目返回固定 `TextRef`，切换语言后文字更新；版本 1 的调用方调用版本 2 得到 `version-changed`。检查脚本对每种坏样本（缺键、多键、占位符不一致、英文缺 `_one`、`$t(`、闭合码缺或多文案）退出非零。

### 第 7 片起：按插件迁移内联文字

- 目标形态：现有“文字表加调用”的写法（`messages.ts` 里的表、`editorText(locale, key, params)` 这类函数）改成插件目录加 `useText().t(ref)`；声明字段改成约定键或省略。
- 每个插件一片，按文字量：workbench、projects、explorer、settings、editor、plugins、lab，再到其余插件、`src/ui`、`src/web`、`src/sdk`。
- 每片：跑抽取脚本；人工改脚本列出的；用脚本输出的对照表生成一条测试，断言每个迁移键的 zh-CN、en-US 目录值与旧字面量相同（防止抽取改错文字）；测试里断言中文文字的改成断言键或结构，不放宽；该插件的 Lab 截图在迁移前后各拍一组，逐张目视对照（`lab:shot` 没有基线比对）。
- 分派：文案改写少、纯搬运的插件派 Haiku；需要改写或新写界面文案的派 Sonnet；主会话审每片的 diff、自跑验证后合进 Work 分支。

### 第 7 片之后：共享包（按包各一片）

- nb-agent-ui：`ViewText` 改为 `TextRef`；`MessageView` 里折好的字符串改为 `Text`；自带目录；`locale` 属性只在没有注入时起作用。
- nb-form：`FormText` 归入 `LocaleMap`（回退不变），支持 `TextRef`；Spec `ui/forms.md`。
- nb-markdown：自带目录；两处 `render()` 带 `appContext`。
- nb-ui：21 个写死中文的文件改为读端口，组件 `.md` 声明 `state:inject`。

### SDK 与通知（共享包之后）

- 插件 SDK 两个公开入口：纯入口（`text()` 引用构造与类型，激活适配层绑定所属插件）；浏览器入口（复用宿主注入键的 `useText`、`TextPort`）。新增子路径时同步 entries 表、两端共享模块表、SDK 声明打包路径与作者文档。去掉 `localize`、`formatText`；改 `sdk.test.ts` 导出面快照、`surface.test.ts`、9 个示例与模板。Spec `runtime/plugin-api.md`。
- 验收：用生成的 tarball 构建一个第三方组件（改写 snippets 示例），调浏览器入口、切换语言后组件文字更新。
- `workbench/notifications.md` 的标题与正文改为 `Text`（t04 只管详情与常驻）。

### 交付片（最后）

- 版本表（写进 Task README）：nb-runtime 与 nb-ui 的新入口先发，再发 nb-form、nb-agent-ui、nb-markdown，最后 nb-story；每个包写目标版本、破坏性变化、消费者范围。发布逐次授权。
- 验收：`bun run release:check`、`bun run release:smoke`；共享包 tarball 在没有注入的宿主里能显示默认文字、JSON 目录确实随包；SDK 的 `pack.test.ts` 与仓库外类型检查；重建 nb-story 的 `dist/web`，按 `docs/testing/README.md` 的打包验收跑单语中文 smoke。
- 体积实测，在 `ui/i18n.md` 写“当前语言加源语言”的触发预算；Spec 晋升 `implemented` 并补证据。

## 每片提交后旧入口怎么继续工作

| 片 | 新增 | 旧入口的状态 | 谁在哪片删旧入口 |
|---|---|---|---|
| 1 | nb-ui `./text`、`./text-port`、`./locales`；应用 `src/shared/text.ts` | 全部不变，新入口暂无消费者 | — |
| 2 | 语言类型为字符串；`resolveLocaleMap` | `localize`、`textOf`、`formatText` 签名不变，内部改用 `resolveLocaleMap` | 第 7 片起随迁移删 |
| 3 | 宿主引擎、端口、共享包目录登记 | 组件仍可接 `locale` 属性，由宿主从端口的 `locale` 传；服务端不受影响 | 共享包各片 |
| 4 | 声明 schema 为 `TextSchema`（不含命令标题与公开状态原因） | 浏览器渲染经端口；服务端路径仍按 `LocaleMap` 解析 | — |
| 5 | 清单 `l10n`、目录端点、引导目录索引、`catalog-invalid` | 没有目录的插件照常工作 | — |
| 6 | 约定键；命令标题与公开状态原因为 `Text`；远程 `list` 版本 2；运行期条目返回 `Text` | 字面双语仍作为 `LocaleMap` 有效 | 第 7 片起 |
| 7 起 | 各插件目录 | 迁完的插件不再有字面双语 | SDK 片删 `localize`、`formatText` |

每片列出实际跑的命令与结果，写进 Task README 的切片记录；一片不过不进下一片。

## 验收映射

每片的 Spec 条目随该片写定，测试按条目编号命名。总判据：提案“对 Spec 的预期改动”里的每份 Spec 都有对应的片；包装层与检查器的每条合同各有正式测试；全量 `test:affected`、typecheck、Lab 截图对照、全量 e2e 与交付片的打包验收通过。

## 不做与风险

- 不做：语言包、伪语言、翻译平台接入、目录在线替换（随热插拔）、失败详情组件（t04）、各错误域的失败投影（w00031）。
- 风险：第 4 片放宽声明校验后，以前被拒的写法被接受。这是有意的变化，已在 Spec 与测试里写明。
- 风险：迁移期大批文件同时改，与别的 Work 冲突。对策：按插件分片、每片尽快合进 Work 分支，Work 分支定期从 master 合入。

## 审查处理（2026-10-27）

第一版的审查有效 24 条，阻断 0：

- **第 3 片的“不改行为”不对**（前端第 1 条）：放宽声明校验，现改为第 4 片，写明 Spec 与测试的变化。
- **体量与纯函数没有端口**（前端第 2 条、omp 第 2 条）：分出纯数据层，服务端路径不翻译 `TextRef`。
- **`TextSchema` 的位置**（前端第 3 条）：放应用的 `src/shared/text.ts`，类型放 nb-ui 的纯子路径。
- **语言来源与两份来源**（前端第 4 条）：语言由宿主驱动，过渡期的 `locale` 属性取同一来源。
- **类型锁步**（前端第 5 条）：语言类型提前成第 2 片。
- **没有宿主时的缺省**（前端第 6 条）：注入键的缺省值是 nb-ui 自带端口。
- **`.vue` 抽取与目标形态、文字没变的核对、截图没有基线**（前端第 7、8 条）：已改。
- **交付验收**（前端第 9 条、omp 第 10 条）：新增交付片；JSON 导入的二选一已选。
- **远程列表升版本要原子**（omp 第 1 条）：并入第 6 片。
- **加载期校验与 6 个 SDK 助手**（omp 第 3 条）：并入第 6 片。
- **`ui/workbench-shell.md` 与运行期 `text()`**（omp 第 4 条）：并入第 6 片。
- **安装的验收场景**（omp 第 5 条）：第 5 片列六组。
- **SDK 的浏览器出口**（omp 第 6 条）：两个公开入口与 tarball 验收。
- **语言设置的校验**（omp 第 7 条）：用共享常量生成可序列化的枚举。这比提案写的“改为字符串、按集合校验”更简单，校验效果相同。
- **引导协议**（omp 第 8 条）：第 5 片含目录索引、修订号与非致命问题。
- **正式测试与原型分开**（omp 第 9 条）：已改。

前端的“其余建议”与 omp 各条的细节，在对应切片实施时逐条对照报告。

## 第二轮审查处理（2026-10-27）

第二轮：omp 6 条、Claude Sonnet 前端 9 条，阻断 0（报告存 `evidences/plan-review-r2-*.txt`）。已处理：每片的兼容边界与删旧入口的时机写成上表（omp 第 1、6 条）；第 2 片写成锁步合同片并列出四个包的命令（omp 第 2 条、前端第 3 条）；共享包目录改为 `.ts` 模块（omp 第 3 条、前端第 6 条）；第 4 片的消费方改法、命令标题与公开状态原因挪到第 6 片（前端第 1、2 条）；第 3 片加共享包目录登记表、`escapeValue` 与最小实现一致性测试、七处 `displayLocale` 的改法（前端第 4、5、7 条）；后面几节编号（前端第 8 条）；Spec 随实现分支（前端第 9 条）。omp 第 4、5 条（引导协议的原子切换点、registry 版本 5 同片）已在第 5 片写明同片提交，实施时再逐条对照。这是本计划的第二轮，按三轮上限不再开第三轮，第 1 片按两份报告的结论直接开工。
