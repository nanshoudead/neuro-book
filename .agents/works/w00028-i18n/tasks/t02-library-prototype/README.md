---
schema: nbook.task/v2
taskId: t02-library-prototype
status: done
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

2026-10-27 完成（自主推进；原型由 Claude Sonnet 编码子代理在 worktree `spike/w00028-t02-i18next` 里做，主会话复跑测试）。结论：i18next 在本项目里成立。

- 报告：`evidences/prototype-report.txt`（九项，每项有结论、证据与复现命令）；复跑结果 `evidences/prototype-tests.txt`（bun 24 条、vitest 6 条全过）。
- 原型代码：`prototype/`（原在 `packages/neuro-book/src/__i18n-spike__/`，没有进产品代码；复现时放回该目录并 `bun add i18next`）。
- 对 t01 的影响：
  - 热重载：`addResourceBundle` 即使 `deep=false` 也是浅合并，热重载要先注销再登记；
  - 缺键：返回去掉命名空间的裸键；
  - 复数：`count` 不是数字时静默返回裸键；英文目录缺 `_one` 时，`count` 为 1 不会退到 `_other`；
  - 分隔符：默认分隔符下，码里的 `:` 会被静默改写成 `.`，取到别的码的文案，所以要限制码的字符并在取文案处拦截；
  - 类型检查：自写的 `keyof` 能抓键写错，推不出参数名；i18next 自带的类型只对静态已知的命名空间可用；
  - 共享包最小实现：31 行，16 个用例与 i18next 输出一致；
  - 体积：gzip 14.2 KB；
  - Vue 接法：`shallowRef` 版本号加监听语言切换与目录增删，不重新挂载就更新；
  - 翻译平台：Weblate 支持 JSON v4，Crowdin 原生支持但版本未查到。
- 未验证：跨 Vue 副本的插件组件、目录按语言懒取时的乱序、`i18next-icu`。

实现审查：原型不进产品代码，按 reviewing 的“自审”做：主会话复跑测试、核对改动只在原型目录。

## 下一步

无；结论交 t01。
