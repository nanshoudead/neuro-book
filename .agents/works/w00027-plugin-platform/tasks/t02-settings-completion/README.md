---
schema: nbook.task/v2
taskId: t02-settings-completion
status: planned
updated: 2026-10-17
---

# 设置插件补齐：密钥、结构化值与长文本编辑

## 目标与范围

`nbook.settings` 的配置核心与设置窗口已实现（`docs/specs/settings/configuration.md`、`settings-window.md` 均 `implemented`），本 Task 补齐内置插件开始使用配置后暴露的缺口。候选范围（待开发者与 t01 确认优先级）：

- **密钥**：`secret: true` 目前被直接拒绝；服务端密钥存储、客户端只见“是否已设置”、密文不可读时的处理，以及设置窗口里的密钥项。
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
- 本轮范围：数组、对象、多行文本的通用编辑；设置内搜索；打开设置文件；页面的未保存保护；动态选项；“设置分区被显示时激活”的激活事件；声明 API 的易用性（按插件批量声明、list 分区不交空实现、页面直接拿到配置服务）；密钥；Monaco 代码编辑器的排版设置（字体、字号、行高、Tab 宽度、行号、小地图）。Markdown 正文的排版设置不做，留给 w00025。
- 密钥本轮就做：服务端加密后存在状态根下，主密钥放系统密钥库（Linux 为 Secret Service），没有密钥库时退回状态根下只有本人可读的密钥文件（方案 A）。用 Lab 的“模型服务”示例验证。
- 设置界面的外观收口另建 [t06](../t06-settings-ui-polish/README.md)，不在本轮。

说明页：[设置分区的两种画法，与旧应用的 provider 设置](artifacts/settings-sections/index.html)。

## 下一步

写 `plan.md`（先修订 `settings/configuration.md`、`settings-window.md` 的相关条目），要点交开发者确认后交设计审查，再开工。
