---
schema: nbook.task/v2
taskId: t02-settings-completion
status: active
updated: 2026-10-21
---

# 设置插件补齐：结构化值与长文本编辑

## 目标与范围

`nbook.settings` 的配置核心与设置窗口已实现（`docs/specs/settings/configuration.md`、`settings-window.md` 均 `implemented`），本 Task 补齐内置插件开始使用配置后暴露的缺口。候选范围（待开发者与 t01 确认优先级）：

- **密钥**：（2026-10-20 撤出本轮）`secret: true` 维持登记时被拒；API Key 用明文的普通配置项，见 [t08](../t08-secret-store/README.md)。
- **通用编辑**：数组、对象目前只显示摘要并要求去设置文件里改；多行字符串（`format: "multiline"`）没有通用控件。已有的 page 分区机制可覆盖特例，但常见形态应有通用编辑。
- **设置窗口**：设置内搜索、按层过滤（用户／本作品）、设置文件（JSONC）视图或“在设置文件中编辑”的跳转。
- **随其它 Work 出现的配置项**：编辑器自动保存策略（w00025 t04）、Markdown 图片存放目录（w00025 t09）、以后的语法配色覆盖（w00025 t05）——先把机制准备好，键由各自插件声明。

非目标：本机（machine）配置层（随桌面端再定义）；memory／policy／Profile 配置（Spec 的非目标）；跨设备同步。

## 行为合同

- [`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)（已实现；密钥与本机层仍是 planned 条目）
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（已实现；多行与结构化编辑、搜索未纳入）

## 当前状态

2026-10-17 建 Task；2026-10-20 开始写计划。现状：

- 已实现：顶层 `settings.properties` 声明、默认值／用户层／项目层合成、TypeBox 校验、JSONC 保格式编辑、文件监视、跨实例快照、设置窗口（`settings.sections` 的 list 与 page 两类分区）、独立用户编辑授权、`nbook.settings.open` 与 `Mod+,`。
- 已声明配置：`nbook.settings/locale`、`nbook.workbench/theme`、`nbook.workbench/appearance`、`nbook.editor/{enablePreview,wrapTabs,breadcrumbs}`、`nbook.explorer/{indentGuides,hideMarkdownExtension}`、`nbook.projects/library`。
- 未实现：`secret`、本机层、`multiline` 等声明字段与通用多值编辑、设置内搜索。

开发者 2026-10-20 的决定：

- t02 提前到 t04 之前做，不与 t04 并行；在 Work 分支 `feat/w00027-plugin-platform` 上做。
- 本轮范围：数组、对象、多行文本的通用编辑；设置内搜索；打开设置文件；页面的未保存保护；动态选项；“设置分区被显示时激活”的激活事件；声明 API 的易用性（按插件批量声明、list 分区不交空实现、页面直接拿到配置服务）；Monaco 代码编辑器的排版设置（字体、字号、行高、Tab 宽度、行号、小地图）。Markdown 正文的排版设置不做，留给 w00025。
- 密钥本轮就做：服务端加密后存在状态根下，主密钥放系统密钥库（Linux 为 Secret Service），没有密钥库时退回状态根下只有本人可读的密钥文件（方案 A）。用 Lab 的“模型服务”示例验证。
- 凭据先不做（开发者 2026-10-20）：没有加密的需求，API Key 用明文的普通配置项，t08 搁置；上面一条与下面一条里的密钥部分作废。
- 可维护性修订（开发者 2026-10-20 同意）：密钥的存储与服务拆到 [t08](../t08-secret-store/README.md)，做成独立的服务与远程合同，主密钥丢失时显式重置、不分代次；t02 只做密钥项的声明与设置窗口里的界面。按需激活用内核上下文上通用的 `ctx.activation.trigger`。
- 设置界面的外观收口另建 [t06](../t06-settings-ui-polish/README.md)，不在本轮。

S1（Work 分支，2026-10-20）：

- `18d14f5c1`：内核激活上下文加 `ctx.activation.trigger`，`requester` 绑成入口所属插件，跟着这一代次（停止、同 id 重新登记之后为 `requester-stopped`）。
- `35ef756b3`：`defineSettings`；声明字段 `choices: {from}`（动态选项，只用在字符串上）与 `ui`（单个字段的界面提示，控件配不配交给 `ui.forms` 的描述检查，应用因此依赖 `@notnotype/nb-form`）；`SettingsService.update` 的值类型改用 `NoInfer` 只从定义推出（原来字面量联合之外的值能编译）。
- `411de6cb2`：`settings.sections` 改为 list 分区的顶层声明（三个位置都登记），新增 `settings.pages`；内置分区、示例、Lab 局部宿主与测试一起迁移；跨点同 id 两者都不显示并记诊断。
- `99b9ac7cb`：按需激活。窗口显示 page 分区时触发 `onSettingsPage:<id>`，触发前经 `window.plugins.activationEvents` 核对所属入口（内核目录的入口描述因此加了 `activationEvents`）；新状态 `entry-not-activatable`。`settingsPage(load, props?)` 放在 `nbook/ui/settings/settings-page`（插件只能在运行时引用别的插件的 `shared/contracts.ts`）。示例 snippets 与插件页改为按需激活。
- 偏离计划：`settingsPage` 的签名改为 `(load, props?)`，位置不在 `web/contracts.ts`；`window.plugins` 多了 `activationEvents`（计划写“不变”）。原因见上。
- 验证：内核 347 例、nb-form 93 例、应用 Bun 1559 例、Vitest 382 例、类型检查、`docs:check`、`governance:check` 通过；settings、plugins、browser-host、bookshelf 四组 e2e 24 例通过（插件页的 e2e 经设置窗口打开分区，走过真实浏览器里的按需激活）。按需激活、触发口寿命、三处登记做过变异检查。
- omp 实现审查（[evidences/impl-review-s1-omp.txt](evidences/impl-review-s1-omp.txt)，3 条，都是重要、都成立），`ccfc2052f` 处理：带 `signal` 的 `ctx.activation.trigger` 每次在入口的停止信号上留一个监听（100 次触发留 100 个），改为组合信号随触发结算解除（监听数不经替身观察不到，没有加测试）；`ui` 的控件校验漏了 `choices.from` 对应的 `options`，有动态选项时写下拉被拒、写多行反被接受，已修并补用例；停在分区时所属入口从受阻恢复不会再触发，窗口改为分区或交付状态变化时都再看一次，补真实内核用例（去掉修正时这条失败）。修正后内核 347 例、应用 Bun 1560 例、Vitest 382 例、类型检查通过。

S6（`57bc5eedc`，2026-10-20）：编辑器分区加“代码编辑器”小组（`defineSettings` 声明八项：字体、字号、行高、Tab 宽度、推测缩进、行号、缩略图、换行）。编辑器区把配置读成响应式选项注入源码编辑器控件；实例的选项 `updateOptions`、不重建；缩进是模型的选项，每个模型记下上次应用的缩进设置，设置没变时切走再切回不重新推测。新 e2e `editor-code-settings.e2e.ts` 在真实应用里按 Tab、保存、读磁盘：两格、四格、制表符各插入自己的缩进；关掉推测后当前与停放的文件都按新的 Tab 宽度；再打开推测时重新推测；字号、行号、缩略图即时生效且编辑器 DOM 不换。去掉“进入模型时应用缩进”这条 e2e 失败。设置、编辑器区、文件类型、Lab 编辑器等 e2e 45 例通过；Bun 1560 例、Vitest 382 例（一次跑出一例偶发失败，重跑两次全过）。

- 开发者 2026-10-20 定：低代码（[t07](../t07-low-code-forms/README.md)）排在 t02 之前实现，t02 的控件改用低代码的字段；[plan.md](plan.md) 已按此起草，待 t07 的接口定下后回改，再交开发者确认。

说明页：[设置分区的两种画法，与旧应用的 provider 设置](artifacts/settings-sections/index.html)。

2026-10-21：t07 完成并合入 master 后，按它实际的接口回改了 [plan.md](plan.md) 的 S3、S4、S5、S7（动态选项改用贡献点 `settings.choices` 直接交 nb-form 的选项源、`onSettingsChoices` 按需激活、`context.options`；未保存保护与搜索的细节；设置文件视图走远程合同 v2 的 `readText`、`writeText`）。开发者同日确认计划，并定三点：设置文件用纯文本框编辑、不做语法高亮；两份设置远程合同升到 version 2；搜索不匹配动态选项的选项名。开发者指定按 autonomous-delivery 推进完 t02，事后一次审查；照推荐做的决定记在 Work 的 [待确认清单](../../pending-confirmations.md)。

计划审查（omp，[evidences/design-review-s3-omp.txt](evidences/design-review-s3-omp.txt)，17 条：阻断 2、重要 13、建议 2，都成立）已处理进 plan.md 的“计划审查的处理（2026-10-21）”；照推荐做的产品取舍记在 Work 的待确认清单。

S3（`cde0311f2`，Spec 在 master `2ffc34ac4`）：贡献点 `settings.choices`（只收浏览器入口，id 前缀同分区，声明为空对象）；选项提供者注册表 `web/choices.ts` 给出不变的选项源映射，交付优先、按入口状态给加载中或不可用，`source()` 每次交付只调一次、每次求值在边界里核对形状，出错只让这个源不可用、同一问题只记一次诊断；`onSettingsChoices:<id>` 按需激活（核对所属入口声明、在求值之外触发）；通用列表与 `context.options` 共用；Lab 宿主补提供者与触发，加三个动态选项场景。验证：`choices.test.ts` 8 例（真实内核），设置的 Bun 125 例、Vitest 53 例，类型检查；“求值出错的边界”“激活事件核对”“选项交给控件”三处变异都被拦下。偏离计划：`settingsChoices` 小工具没做（实现就是 `{source}`，包一层没有收益）；`window.options` 是方法（放成对象属性时 Lab 的输入类型把它当成可登记的 JSON 属性）。

S4（`a7bff4c77`，Spec 在 master `3573e2620`）：搜索（输出 21）与未保存保护（输出 22）。page 声明加 `keywords`；页面上下文按一次显示给并加 `dirty`；离开当前页面的动作统一经 `requestLeave`；确认用 nb-ui `AlertDialog`。验证：`window.test.ts` 新增搜索 3 例、未保存保护 4 例，`SettingsWindow.dom.test.ts` 新增 4 例，`sections.test.ts` 补 keywords 的校验；“换词重建”“Esc 先清空”“旧上下文作废”“放弃后切标签重建”四处变异都被拦下。另：指向 page 分区、由页面画的配置项命中时列出这个页面（计划没写，改动小，Spec 已写）。

S5（`2ee1bb80f`，Spec 在 master `e48c2f74f`）：设置文件视图。两份设置远程合同升到版本 2，加 `readText`、`writeText` 与 `text` 事件，调用方核对同用户编辑；拥有者整份写在写入队列与锁里以磁盘当前文本为准，修订号是原始文本的 SHA-256，对不上为 `conflict`、不合格为 `invalid-text` 带行列，只改注释也推 `text`；新失败码 `read-failed`、`conflict`、`invalid-text`；`layer-text.ts` 从 `backend/` 挪到 `shared/`（Lab 内存层用同一套解析与编辑）；窗口左栏插件组最后固定“设置文件”，`SettingsFileView` 编辑当前标签那一层，层无效的说明加“打开设置文件”。验证：`layer-owner.test.ts` 新增 6 例（真实文件）、`window.test.ts` 新增 5 例（经远程合同版本 2）、`SettingsWindow.dom.test.ts` 新增 4 例、`layer-text.test.ts` 补行列；`smoke:server` 9 个场景通过（S9 发版本 2 帧，验整份读与冲突）；“冲突核对”“有改动时只提示”“Esc 后的 Tab”“单键写入也通知文本”四处变异都被拦下。偏离计划：层快照的 `invalid` 说明没有另带位置（远程合同的快照形状不变，位置只在整份写的失败里给）；搜索把“设置文件”当一个页面命中（按标题、说明与 settings.json）。跑受影响的 Vitest 时 `SnippetsPage.dom.test.ts` 的“本作品”一例在整批负载下失败过一次，单独跑三次、整批再跑两次都通过，没有抓到现场；那条测试直接挂页面组件，不经这次改动的窗口模型。

S7（`e4d6061a4`）：Lab“模型服务”做成 page 分区的样板。`providers`（对象数组，只允许用户层）用 nb-form 的左列表右详情编辑，草稿加“保存/放弃改动”，按值与已保存的值比较报 `context.dirty`；`defaultModel` 的选项来自同一插件的选项提供者 `example.models.models`；入口按 `onSettingsPage`、`onSettingsChoices` 按需激活。`apiKey`、`models` 改为可选（本地服务不用密钥）。过程中的发现：草稿原来是深层的 `ref`，交给配置服务写时是 Vue 代理，结构化复制抛错、保存失败却没有任何提示（未处理的 reject）；改用浅层 `ref`。验证：`SettingsWindow.dom.test.ts` 新增 4 例；`settings.e2e.ts` 新增 3 例（真实应用里 `Ctrl+F` 搜索并改值、设置文件视图 `Ctrl+S` 保存与修好改坏的文件；Lab“模型服务”的保存被拒、保存成功与确认离开，确认框弹出时焦点在“继续编辑”）。

截图时发现并修正（`6e7616438`）：设置文件保存出错写成“第 3 行第 5 列：第 3 行：CommaExpected”，行号重复、原因是英文错误码；解析模块改给中文原因，整份写的 `invalid-text` 详情只带原因、位置另给；层快照的说明随之是“第 N 行：<中文原因>”。

收口验证（合入 master 之后的 Work 分支）：类型检查；应用 Bun 1593 例、Vitest 396 例；nb-form 96 加 80 例；`docs:check`、`governance:check` 无失败；全量 e2e 255 例里 254 例通过，失败的是 `editor-area.e2e.ts`“重新打开回到上次的光标”（Work README 记过的负载下偶发失败），单独重跑三次都通过。截图：`.local/agent/works/w00027-plugin-platform/tasks/t02-settings-completion/reports/impl-shots/`（新场景两种主题 × 浅、深 × 自由画布、手机，48 张，没有溢出与页面错误；`page-fill` 有一处输入框的焦点环在边上差 0.4–1.7px；`flows/` 是真实浏览器里点出来的搜索、确认框、设置文件出错与动态选项的状态）。

实现审查（2026-10-21）：

- Sonnet 审界面（[evidences/impl-review-sonnet.txt](evidences/impl-review-sonnet.txt)，17 条：重要 5、建议 12），`f3d73ecdd` 处理。改了：设置文件里第一次 `Esc` 只放开 `Tab`、再按一次才关窗口，文本框下写出这几个键（第 1 条）；CRLF 文件按归一后的换行编辑、保存时换回（第 2 条）；先敲空白再搜索也走未保存保护（第 3 条，与 omp 第 3 条相同）；操作行挪到文本框与服务商列表上面、按钮常驻停用，样板页的操作行滚动时粘在顶上（第 4 条）；样板页遇到别处的改动先提示，给“重新读取”“仍然保存”，失败原因用新的公共函数 `settingsFailureText`（设置窗口的通知也改用它），这一层不能写时只读，比较改用规范化文本（第 5 条）；层的说明带出错原因，在设置文件视图里改说“在下面改好后保存”（第 7 条）；出错标记随编辑去掉、保存出错时光标放到出错处，冲突时加“仍然保存”（第 8 条）；放弃后焦点按动作去，标志在关闭时取走清零（第 9 条）；确认框 `Esc` 等于继续编辑（第 10 条）；`Tab` 经浏览器的编辑插入、保留撤销栈，选中一段时不插（第 11 条的一半）；只有第一次读显示“正在读取”，重读原地换文本，保存与放弃后焦点回到文本框（第 12 条）；`Mod+F`、`Mod+S` 按平台与物理键，监听挂到窗口面板，文本框里的 `Mod+F` 放行，组字判定与窗口一致（第 13 条）；搜索结果数播报、点清除后焦点回到输入框、“打开”的名字按语言写冒号（第 14 条）；动态选项那一行排到“其它”最前（第 16 条）。不改或部分改：第 6 条（服务商列表与详情各自滚动）只做了调整顺序加粘顶的操作行，各自滚动要 nb-form 的左列表右详情能撑满高度，转 t06；第 7 条“打开时光标定位到出错处”没做，层快照不带位置；第 11 条多行缩进没做（选中时不拦 `Tab`）；第 14 条清除后焦点的通用修正属于 nb-ui `Input`，这里只在设置窗口里补；第 15 条按上面各条补了用例；第 17 条两个分支的模板重复没有抽组件，层名各写一份，接受。
- omp 审后端、合同与窗口模型（[evidences/impl-review-omp.txt](evidences/impl-review-omp.txt)，有效 6 条：重要 5、建议 1；第 5 条它自己撤回），`5f4bb17d6`、`73bf5e066` 处理，都成立、都改了：文本订阅首次失败或断开后，这一层从连不上恢复时视图重新订阅（第 1 条）；修订号直接对原始字节取摘要，非法 UTF-8 整份读为 `read-failed`（第 2 条）；空白起手的搜索（第 3 条）；关窗再开的页面复用作废的上下文——原因是窗口组件缓存页面视图的计算值读不到非响应式的显示表，加一个显示版本号让它重算（第 4 条，第一次只在关窗与重新加载时结束显示，没有盖住，按它的最终结论补上）；“不能按需激活”的结论在入口换代、交付、撤回时清掉（第 6 条）；Lab 内存层以文件文本为准、记下文件在不在、内容没变不发布，并加与真实拥有者同输入的对照测试 `memory-layers.test.ts`（第 7 条）。撤回的第 5 条（读取中收到的修订号）照样做了防护，有用例。
- 新增用例都做过变异检查，改回去会失败：Esc 两次、CRLF、确认框 Esc、放弃后焦点、样板页别处改动、读取中的修订号、断开后重订阅、关窗再开的上下文、内存层不重复发布。
- 处理后的验证：类型检查；设置、Lab、示例的 Bun 220 例、Vitest 120 例；全量 e2e 255 例里 252 例通过，失败的 3 例都由审查后的修改引起，已修（`settings.e2e.ts` 两例还按“没有改动时隐藏操作行”断言；`lab-scenes.e2e.ts` 量到“模型服务”在手机宽度下多了 1 处被裁的焦点光晕，原因是页面自己也滚动、滚动折线处的“添加”按钮压在窗口分栏的下沿，改为窄窗口里交给外层滚动），重跑这两组 13 例通过。手机宽度的截图在 macOS 主题下还量到“其它”分区里正好压在滚动折线上的输入框（0.3px），与滚动位置有关，门禁用的默认主题里没有。`SnippetsPage.dom.test.ts` 的“用户”标签一例在改完代码后的第一次运行里超时过两次（默认 5 秒），之后连跑 10 次都通过、单例约 0.5 秒；推断是冷启动时现场编译动态导入的组件，这条测试原本就有，没有改它。

推送备份没有做：Work 分支领先 `origin/master` 656 个提交，含别的会话在本地 master 上还没推送的提交，推这个分支会把它们一起发出去，留给开发者决定。

## 下一步

2026-10-21 合入 master（`5acd09995`）。等开发者一次审查 t02 与追认 Work 的待确认清单；push 待开发者决定（Work 分支领先 `origin/master` 的提交里有别的会话在本地 master 上的提交）。之后按 Work 的顺序是 t04、t05，t06 收外观。
