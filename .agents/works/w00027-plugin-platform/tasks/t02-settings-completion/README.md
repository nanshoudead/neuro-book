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

推送备份没有做：Work 分支领先 `origin/master` 656 个提交，含别的会话在本地 master 上还没推送的提交，推这个分支会把它们一起发出去，留给开发者决定。

## 下一步

S5（设置文件视图），再 S7（Lab“模型服务”）；之后收口验证与实现审查（[plan.md](plan.md)“切片”）。
