---
schema: nbook.task/v2
taskId: t02-library-prototype
status: active
updated: 2026-10-27
---

# 选库原型与消息格式

## 目标与范围

用最小原型验证 i18next 在本项目里成立，结论交 t01 的结构方案：

- 插件热装、热卸时用 `addResourceBundle`、`removeResourceBundle` 登记与注销命名空间，卸载后不残留；
- 共享同一份 Vue 的插件里，渲染期调用 `t()` 能否随语言切换更新（独立设计列为未验证）；
- 原生格式的插值与复数（`_one`/`_other`），中文只写 `_other`；参数类型推断；
- 共享包端口：包自带的最小实现与 i18next 的结果一致；
- 打包体积：i18next 原生格式 gzip 约 14.2 KB，加 ICU 约 23.7 KB（2026-10-27 实测，未含 `i18next-icu` 本身）；
- 翻译平台（Crowdin、Weblate 等）对 i18next JSON 的支持，按 2026 年各平台文档核实。

对照组：`@formatjs/intl`（原生 ICU；前端第三轮审查指出它读传入的 messages 对象，增删键立即生效，所以“目录装卸”不是两者的真正差别，差别在 Vue 响应式、回退链与缺键行为）。

合同：原型不进产品代码，行为合同未变。

## 当前状态

2026-10-27 建，未开工。

## 下一步

开工时在 worktree 里做原型，证据存本 Task 的 `evidences/`。
