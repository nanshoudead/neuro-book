---
schema: nbook.task/v2
taskId: t02-settings-completion
status: planned
updated: 2026-10-17
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

- 开发者 2026-10-20 定：低代码（[t07](../t07-low-code-forms/README.md)）排在 t02 之前实现，t02 的控件改用低代码的字段；[plan.md](plan.md) 已按此起草，待 t07 的接口定下后回改，再交开发者确认。

说明页：[设置分区的两种画法，与旧应用的 provider 设置](artifacts/settings-sections/index.html)。

## 下一步

S1 交 omp 实现审查（报告在 `.local/agent/works/w00027-plugin-platform/tasks/t02-settings-completion/reports/impl-review-s1-omp.md`），处理后做 S6（Monaco 排版设置）；S3–S5、S7 等 t07 完成后做（[plan.md](plan.md)“切片”）。
