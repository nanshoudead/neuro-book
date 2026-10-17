---
schema: nbook.work/v1
workId: w00028-i18n
issueId: null
status: active
updated: 2026-10-17
---

# 界面国际化（i18n）

## 目标

把 i18n 做成前端底座能力，与主题系统同级：一处定义、按当前语言消费，插件与 nb-ui 共用同一套机制。先做需求与结构设计，**不在本 Work 立即实施**（开发者 2026-10-17）。

## 现状（2026-10-17 调查）

- 已有最小机制：`packages/neuro-book/src/shared/localized-text.ts` 的 `LocalizedText = {zh-CN, en-US}`、`localize`／`formatText`；界面文本在 863 处内联写成两份，54 个文件引用 `LocalizedText`；当前语言是配置项 `nbook.settings/locale`。
- 没有集中文案目录、复数与 `Intl` 格式化（数字、日期、相对时间）、缺失文案检查；语言只有两种，类型上是闭合集合。
- 组件普遍把 `locale` 作为 prop 逐层传递，没有注入的 i18n 上下文；插件声明的文本（命令标题、菜单项、设置项标题）是内联 `LocalizedText`，随语言切换。
- nb-ui 组件有写死的中文默认值，例如 `Editable.vue` 的 `placeholder: "点击编辑..."` 与 `aria-label="编辑"／"保存"／"取消"`、`Switch.vue` 的 `ariaLabel: "开关"`、`Toolbar.vue` 的 `ariaLabel: "工具栏"`。
- 主题系统可作参照：两项配置声明 + 响应式读取 + 文档根写入 + CSS token，业务只消费不另建来源（`docs/specs/theme/system.md`）。

## 任务

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与结构设计：消息目录形态、格式化、语言集合与回退、插件译文贡献、nb-ui 文案、检查与迁移路径（未开工） |

## 授权与限制

- 现在只建 Work 与需求 Task，不实施；实施另建 Task。
- `issueId: null`；远端操作逐次授权。
