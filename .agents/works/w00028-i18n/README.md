---
schema: nbook.work/v1
workId: w00028-i18n
issueId: null
status: active
updated: 2026-10-27
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

## 方向（开发者 2026-10-27 确认）

在 [w00031](../w00031-language-policy/README.md) 的语言治理讨论里定下（讨论稿与审查见 w00031 t01 与本 Work t01 的证据）：

- 每个插件、每个共享包自带按语言分的 JSON 消息目录（`locales/<语言>.json`），按插件 id 或包名分命名空间，随插件激活登记、停用注销；源语言 zh-CN，缺译文按回退链取。不再写内联 `{zh-CN, en-US}`，也不用 vue-i18n（ADR 0023 的这一项由 w00031 t01 的新 ADR 取代）。
- 用 i18next，消息用它的原生格式（`{{name}}`、`_one`/`_other`）；需要 ICU 时再加 `i18next-icu`。日期、数字用 `Intl`。
- 共享包（nb-form、nb-agent-ui、nb-markdown、nb-ui）不依赖 i18n 库：导出自己的默认目录，接收宿主给的 `t(key, params)`，没给时用包自带的最小实现。
- 声明按约定取键，偏离约定时才写键；直接写的字符串是不翻译的字面文字；跨插件、带参数的运行期文字用 `{key, params}`。清单的名称与说明在构建时从目录摘出。
- 错误的界面文案按“拥有者命名空间 + 错误码”取键，投影设计在 w00031 t03。

## 任务

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 目录机制设计：目录位置与清单字段、键与声明、跨运行实例与语言切换、共享包端口、nb-ui 文案、检查（未开工） |
| [t02](tasks/t02-library-prototype/README.md) | 选库原型：在插件热装卸、共享 Vue、语言切换下验证 i18next，并定格式细节（未开工） |
| [t03](tasks/t03-shared-packages-migration/README.md) | 共享包与迁移：端口落地、已发布包的版本与发布窗口、内联文字抽进目录（暂不开工） |

## 授权与限制

- 设计（t01、t02）先于实施；t03 等设计定稿后开工。
- `issueId: null`；远端操作逐次授权。
