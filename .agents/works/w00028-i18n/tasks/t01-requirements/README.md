---
schema: nbook.task/v2
taskId: t01-requirements
status: planned
updated: 2026-10-27
---

# i18n 目录机制设计

## 目标与范围

按 [Work README](../../README.md) 的“方向”设计消息目录机制，写成结构方案，开发者确认后写 `plan.md` 与 Spec。2026-10-27 起范围从“选不选目录”收窄到“目录怎么做”；选库原型在 t02，共享包落地与迁移在 t03。

要回答：

1. **目录位置与清单**：插件的 `locales/<语言>.json` 由清单哪个字段引用；登记时校验什么（现在 `missingEntries` 只检查 `main`，`style` 也不检查）；缺键、坏目录怎么显示、在哪一层拒绝；语言包作为单独插件贡献译文要不要留出路；ADR 0033（应用以构建产物发布）对目录文件的影响。
2. **键与声明**：约定键的规则（例如 `<插件 id>:settings.<名字>.title`）、显式写键的写法、字面字符串；跨插件运行期文字用 `{key, params}`，命名空间强制用插件前缀（可复用 `idPrefix`）；改 menus、views、settings-window、editor 几份 Spec 的声明字段。
3. **跨运行实例与语言切换**：顶层声明式贡献在每个运行实例登记（`runtime/plugin-manifest.md` 输出 11），哪些实例要读目录；浏览器何时取目录（与插件激活、热卸载的先后）；设置搜索现在同时比对两种语言（`settings-window` 输出 21），因此要么一次取全各语言目录（压缩后约 34 KB 以内），要么改搜索规则；切换语言时的乱序响应、首屏闪出键名或基准语言。
4. **消费方式**：注入的 i18n 上下文取代逐层传 `locale`；Vue 组件与纯 TS 模块各从哪里取；`nbook.settings/locale` 现在是静态 Union，选项要能随已装目录生成。
5. **语言集合与回退**：开放 BCP 47 语言，回退链（用户语言、同语种、插件源语言、`en-US`、键本身）；内置插件要求两种语言齐全，第三方只要求源语言。
6. **共享包端口**：`t(key, params)` 的形状与包自带的最小实现；nb-story 查看器这类不是 NeuroBook 的宿主怎么用；保留已发布的 `locale` 属性（AgentSessionList.md 等写明的做法）；Spec 里写的“宿主提供的 i18n（inject）”现在没有实现。
7. **nb-ui 写死的文案**：`Editable.vue`、`Switch.vue`、`Toolbar.vue` 等的默认中文由谁提供、怎么回退。
8. **检查**：键用 `resolveJsonModule` 加 `keyof typeof` 在编译期检查（前端第三轮审查实测可行）；目录检查（缺键、多余键、占位符一致、复数形式）；禁止硬编码界面字面文字的 lint；开发期缺键抛错；Lab 里的伪语言。
9. **已知的坑**（前两轮审查里与内联无关的仍有效）：数量参数要传数字并在运行时校验；错误上报不能是模块级全局状态（`bun test` 同进程跑多个文件）；nb-form 的 `FormText` 是开放语言集合；nb-agent-ui 的 `harness.ts` 把译文烘进 `MessageView`，切换语言不会跟着换；Vue 深层响应式代理会改变对象身份。

非目标：翻译平台的接入流程；作品正文与 Agent 输出的本地化；开发诊断的翻译（w00031 定为英文、不翻译）。

## 行为合同

本 Task 只做设计，行为合同未变；设计定稿后建 Spec 并链接。

## 当前状态

2026-10-27 按开发者确认的方向修订，未开工。输入在 `evidences/`：

- `independent-design.txt`：只拿到目标、不看主 Agent 方案的独立设计，本 Work 的方向主要取自它；
- `design-review-sonnet-r1.txt` 到 `r3.txt`：三轮前端审查。前两轮是在“保留内联”的前提下写的，那个前提已撤销，只取第 9 条列出的部分；第三轮审的是目录方向。

讨论稿与后端审查在 [w00031 t01 证据](../../../w00031-language-policy/tasks/t01-adr/evidences/)。

## 下一步

开发者安排开工时，按 [implementation-planning](../../../../skills/implementation-planning/SKILL.md) 先写结构方案。可以和 t02 的原型并行。
