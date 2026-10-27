# t03 实施计划：消息目录落地与迁移

## Context

开发者 2026-10-27 接受了 [《界面文字的消息目录》](../../../../../docs/proposals/i18n-message-catalogs.md)（决策记录写明待定项 2 到 4 按推荐）。本 Task 按提案落地：先建端口、宿主引擎、目录交付与检查，再按插件把内联双语迁进目录，最后切换 SDK 与共享包。提案的方案就是设计依据，本计划只写切片、文件与验收，不重复方案。

开发者已确认的决定：提案的决策记录；w00028 Work README“方向”；w00031 Work README 第 8、9、11 条。简单的迁移可以派 Haiku 或 Sonnet 子代理，先做实验确认 Haiku 是否够用（实验在 `evidences/haiku-experiment.txt`，结论决定第 6 片的分派）。

工作方式：自主推进；代码在 Work 分支 `feat/w00028-t03-catalogs` 的 worktree 里改；每片先改 Spec（按 `writing-specs`）再改代码、自跑验证、单独提交。

## 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 翻译引擎 | i18next 26.5（ADR 0034、t02 原型） | — |
| 嵌套键的点号路径类型 | 自写递归类型（约 15 行） | 生成类型的脚本 |
| 内联文字抽取 | 一个一次性脚本：用 TypeScript 编译器 API 找 `{"zh-CN": …, "en-US": …}` 字面量，按约定键或文件内的键名写进目录并改写调用处；不能自动处理的列出来人工改 | 正则替换：多行与嵌套对象会漏 |

## 切片

每片列出改的 Spec、主要文件、验证。验证命令统一是受影响包的 `bun run test:affected` 加 `bun run --cwd <包> typecheck`；涉及界面的另跑相关 Lab 截图与 e2e 文件；收口时全量 e2e。

### 第 1 片：文字值与翻译端口（nb-ui）

- Spec：新建 `ui/i18n.md`（文字值、端口、回退链、参数约束、检查），`status: planned`。
- 代码：`packages/nb-ui/src/i18n/`：`Text`、`TextRef`、`LocaleMap` 与判别函数，`TextPort` 注入键与 `useText()`，最小实现（原型的 31 行）与它的单测；nb-ui 自带 `locales/`；包的 `exports` 与 `files`。
- 不改变任何现有行为。

### 第 2 片：宿主引擎与引导（应用）

- Spec：`runtime/browser-host.md`（语言来源与本地记录、静态文字、`<html lang>`）。
- 代码：`packages/neuro-book/src/web/host/i18n.ts`（`createInstance`、包装层的六条拦截、回退链、参数校验、诊断）；三个 `createApp` 根注入；语言记录照 `appearance-hint.ts`；失败页、`NotFoundPage`、离线横幅、`boot.ts`、两份 `index.html` 的静态文字进宿主目录；内联脚本两种语言由测试核对。
- 测试：原型的用例搬成正式测试（缺键、复数、分隔符、热重载、切换语言不重挂载）。

### 第 3 片：`TextSchema` 替换（不改行为）

- 10 处 `LocalizedTextSchema`（`commands/shared/menus.ts`、`commands/shared/contracts.ts`、`editor/shared/contracts.ts`、`workbench/shared/home.ts`、`items.ts`、`views.ts`、`state/shared/plugin.ts`、`settings/shared/sections.ts`、`src/shared/settings.ts`）换成 `TextSchema`；渲染处改用端口的 `t`；`localized-text.ts` 的函数改为调端口。
- 现有双语字面量作为 `LocaleMap` 照常显示，测试不改。

### 第 4 片：目录交付与清单

- Spec：`runtime/plugin-manifest.md`（`l10n`、名称从目录摘出）、`runtime/plugin-install.md`（复制 `locales/`、`catalog-invalid`）、`runtime/plugin-code-loading.md`（目录端点、目录集合与登记集合分开）、`runtime/plugin-hot-plug.md`（在线替换留给热插拔）。
- 代码：nb-runtime 清单 schema 加 `l10n`；内置插件定义静态导入目录并在登记时交给引擎；服务端目录端点（按版本摘要、只读目录文件）；浏览器引导取齐有效插件的目录；SDK 构建校验并复制 `locales/`；安装器校验与 `catalog-invalid`；`nbook.plugins/registry` 升到版本 5。
- 测试：内置与第三方两条路径各一条真实链路；坏目录时插件照常登记、文字回退、插件页显示问题。

### 第 5 片：约定键与检查

- Spec：各贡献点的约定键写进 `workbench/commands.md`（含远程 `list` 版本 2）、`menus.md`、`views.md`、`editor.md`、`quick-open.md`、`settings/settings-window.md`、`state/public-state.md`。
- 代码：登记时按通则推导约定键并补命名空间；`nbook.commands/remote` 的 `list` 输出 `Text`，版本 2；目录检查脚本进 `governance:check`；声明测试（装载全部内置插件，核对约定键与显式键都存在）；内置代码的带类型取文字辅助函数。

### 第 6 片起：按插件迁移内联文字

- 顺序（按文字量）：workbench（约 200 处）、projects（190）、explorer（150）、settings（140）、editor（130）、plugins（76）、lab（61）、其余（commands、html-preview、image-viewer、state、markdown）、`src/ui`、`src/web`、`src/sdk`。
- 每个插件一片：先跑抽取脚本，人工补脚本处理不了的，把字面双语改成约定键或文字引用，测试里断言中文文字的改成断言键或结构（不放宽）；该插件的 Lab 截图与 e2e 文件。
- 分派：按 Haiku 实验的结论决定哪些插件派 Haiku、哪些派 Sonnet；主会话审每片的 diff 并自跑验证后合进 Work 分支。

### 共享包几片

- nb-agent-ui：`ViewText` 改为 `TextRef`，`MessageView` 里折好的字符串改为 `Text`；自带目录；`locale` 属性只在没注入时起作用。
- nb-form：`FormText` 归入 `LocaleMap`（回退不变），支持 `TextRef`；Spec `ui/forms.md`。
- nb-markdown：自带目录；两处 `render()` 带 `appContext`；`MarkdownLocale`、`PromptLocale` 改字符串。
- nb-ui：21 个写死中文的文件改为读端口，组件 `.md` 声明 `state:inject`。
- 已发布包的版本表与发布顺序写进本 Task README；发布逐次授权。

### 收尾几片

- 语言类型：`DisplayLocale` 改字符串；`nbook.settings/locale` 的 schema 改为字符串、按宿主目录校验并生成选项（Spec `settings/configuration.md`）。
- 插件 SDK：去掉 `localize`、`formatText`，加 `text()`；`sdk.test.ts` 导出面快照、`surface.test.ts`；9 个示例与模板；Spec `runtime/plugin-api.md`。
- `workbench/notifications.md` 的标题与正文改为 `Text`（与 t04 协调）。
- 体积实测，按结果在 `ui/i18n.md` 写“当前语言加源语言”的触发预算。
- Spec 晋升为 `implemented`、补证据。

## 验收映射

每片的 Spec 编号随该片写定；本计划的总判据：提案“对 Spec 的预期改动”里的每份 Spec 都有对应的片；原型发现的六条默认行为各有一条正式测试；全量 `test:affected`、typecheck、Lab 截图与全量 e2e 收口时通过。

## 验证

见各片。真实浏览器：Lab 里切换语言后已打开的面板换文字、命令面板与设置搜索能按两种语言找到；装一个带目录的第三方示例插件，名称与命令标题随语言变。

## 不做与风险

- 不做：语言包、伪语言、翻译平台接入、目录在线替换（随热插拔）、失败详情组件（t04）、各错误域的失败投影（w00031）。
- 风险：第 3 片换 schema 时漏掉一处，声明校验拒绝合法输入。对策：第 3 片的验收包括全部内置插件装载测试。
- 风险：抽取脚本把带插值的字面量改错。对策：脚本只处理没有插值、或插值是 `{name}` 的；其余列出来人工改；每片跑 Lab 截图对照。
- 风险：迁移期一大批文件同时改，与别的 Work 冲突。对策：按插件分片、每片尽快合进 Work 分支，Work 分支定期从 master 合入。
