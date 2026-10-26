---
schema: nbook.task/v2
taskId: t13-sdk-package-split
status: done
updated: 2026-10-24
---

# SDK 拆成独立包、内核去掉 NeuroBook 常量

## 目标与范围

开发者 2026-10-24 定：（1）内核里写死的 NeuroBook 常量（保留的发布者 nbook、engines.neurobook 的键名、nbook. 内置前缀、诊断插件 id）改由宿主在装配时传入；（2）按做法 C 拆包：内置插件的合同留在应用，应用经包导出公开唯一的 SDK 入口；作者工具、构建预设、模板、作者文档与示例插件拆成独立的工作区包 @notnotype/nb-plugin-sdk；公开合同不再引用内部模块，收窄 SDK 带出的名字；第三方插件的通用部分（安装、登记、装载、构建）在目录上与 NeuroBook 专有部分分开、各有入口，暂不抽成通用包，出现第二个使用插件模式的应用时再抽；（3）包边界文档与 nb-runtime 说明写清：内核与应用无关，第三方插件的通用部分暂在应用里。t12 两份报告里与拆包、API 形状相关的结论并入本 Task 的计划。

合同：外部行为除诊断插件改名外不变；[plugin-manifest](../../../../../docs/specs/runtime/plugin-manifest.md) 的清单格式改由平台档案参数化，[plugins](../../../../../docs/specs/runtime/plugins.md) 的贡献 id 前缀与合同核对规则，以及诊断插件 id、插件管理失败码与 SDK 的组成都有 Spec 改动，见 [plan.md](plan.md) 第 4 节。

## 当前状态

2026-10-24 经 nbdev 新建。架构设计见 [design.md](design.md)，实施计划见 [plan.md](plan.md)；两轮设计审查（Sonnet）已处理，见 plan.md 第 9 节；开发者 2026-10-24 定 design.md 第 5 节 D0 到 D5 全部按推荐，并指定按 autonomous-delivery 推进；开工。

进展：

- S1a `0ffd9455c`：清单格式按平台档案建（`createManifestFormat`），拆成读、生成、还原；应用的 `src/plugin-platform-profile.ts` 给出 NeuroBook 档案，id 规则只剩一份。
- S1b `e0fa57fe0`：内核装配收平台档案；`idPrefix` 对保留发布者放宽，8 个内置贡献点改用它，工作台的贡献点定义导出一份供插件与测试共用；合同按内容核对，删掉应用的补丁；激活产出不是对象报 `activation-threw`（t11）；应用经 `src/application.ts` 装配，架构测试守住。三处新行为做过变异核对。
- S1c `30710af3a`：诊断插件改名 `runtime.diagnostics`；内核源码不再出现应用名，有扫描测试。
- Spec 与 ADR `65921ae97`（master）。验证：内核 393 例、应用 Bun 1434 例、Vitest 364 例、类型检查、`plugin-code` 与 `plugins` 两份 e2e 6 例；已合入 master。
- S2a `c7087471a`、`ea5c60623`：第三方插件管理搬进 `src/plugin-platform/{backend,web,shared}`（纯搬家前后用例数相同）；平台档案分纯数据与按位置的宿主模块表，通用目录里的 NeuroBook 字面量改从档案读；插件管理的数据与失败码归 `shared/types`；架构测试守边界与应用名；通用目录自己的测试用 `acme` 档案。
- S2b `fcbd57e92`、`7ce9baf7a`、`dacb14064`：三处宿主共用 `thirdPartyDefinitionsFor`；去掉并排的 `thirdParty` 描述数组；版本目录与升级预览拆出；`isInside` 修正 `..foo`（有变异核对过的用例）；失败码按方法分组、删 `reserved-id`，启动原因加 `entry-missing`、`unreadable`（D4）；文件端点的处理归平台、应用留适配器；“未共享”的说法与装载错误文案各一份。Spec `044bb4f6a`。
- S2c `8d43caf3d`：构建预设搬进 `src/plugin-platform/build`、收平台档案作参数，NeuroBook 的绑定在 `scripts/plugin-sdk/build.ts`；按导出名取定义，忘了 export 或一个模块两个定义时报错（副作用：定义模块里入口用不到的导出会被摇掉，已写进构建预设说明）；输出目录清理与开发版本收进预设。
- S2 验证：Bun 1439 例、Vitest 364 例、类型检查，`plugin-code`、`plugins`、`plugin-authoring` 三份 e2e 7 例；合入 master（`051b04811`）。合并后全量 Bun 有一例资源管理器树的测试偶发失败（来自同时合进来的别的会话的改动，单独重跑三次都过），与本 Task 无关。
- S3 `df9708d87`：SDK 子路径收成 `src/sdk/entries.ts`，Vite 与示例构建的别名、两端共享模块、打包入口与 `exports` 由它生成，两份 tsconfig 由测试对照；`/components` 逐个列出 52 个组件与 67 个类型；公开面闭包快照（运行时导入，36 个文件降到 29 个；命令插件的快捷键与菜单经它的合同模块再导出，按跨插件规则留着）；typebox、typebox/value、typebox/compile 进两端宿主模块表，构建预设不再把它打进插件。Spec `f70a9567d`。验证：Bun 与 Vitest 全过（Vitest 里 snippets 设置页的一个用例在全量时偶发失败一次，单独跑通过），插件 e2e 7 例；合入 master（`23753a10e`）。t11（激活产出形状由内核核对）并入本 Task 的 S1b。

- S4 `7ee383b26`、`4834058bb`：作者材料与示例搬进应用包的 `plugin-sdk/`（产品代码不引用它，架构测试守住）；打包产出 tarball、带示例插件的源码；作者文档的组件清单取 SDK 组件入口，主题变量取 nb-ui 导出的配色合同与样式表；测试共用一份假页面（`src/plugin-platform/testing/fake-page.ts`）、一处作者目录与一次 SDK 构建，产物按执行看取了哪些模块（F14、F15）；作者文档与示例说明修正（F16、F17）。验证：类型检查，Bun 1444 例、Vitest 364 例（搬家一片前后用例数相同，第二片多两例），插件 e2e 7 例，全量 e2e 291 例；合入 master（`22a3de487`）。实施中的调整见 plan.md 第 10 节。
- S5：[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md)（编号 0029 已被占用）、包边界、内核与应用包的说明、plugin-api 的“SDK 的组成”；`docs:check`、`governance:check` 无失败。

- 收口：实现审查 2026-10-24 启动（不阻塞）：后端、内核、构建与作者工具由 omp（默认模型），浏览器一侧由 Sonnet；审查 worktree 固定在 `4834058bb`。浏览器一侧的报告（[impl-review-sonnet.txt](evidences/impl-review-sonnet.txt)）：阻断 0、重要 1、建议 6，七条都成立并已修（`c48a492e2`，合入 `51d72dc85`）：
  1. 重要：editor 与 explorer 的 5 个贡献点删掉 `idPrefix` 测试照过。新加 `src/contribution-prefixes.test.ts`，对三张产品定义表里每个贡献点（自有 id 规则的 9 个列名豁免）注册一条用别人前缀的第三方贡献，断言因前缀被拒；变异核对过。
  2. `/components` 名单没和 nb-ui 对照：`sdk.test.ts` 改为用语法树把名单与 nb-ui 组件入口的单文件组件逐个对上。
  3. 测试用的宿主模块表是手写副本：按 `BrowserSharedModule` 定型，名单变了编译不过；注释写明只记得到工厂执行期间的 require。
  4. 合并假页面后丢了“没插脚本或样式表”的断言：补回两处，假页面加 `scripts()`。
  5. 插件页的 `entry-missing`、`unreadable` 没有组件测试：补上，Lab 场景与组件文档跟上。
  6. 样式失败的事件名写死在通用目录：改由宿主给；过时注释与导入分组修正；被跳过的第三方插件补一句为什么取得到。
  7. 宿主模块表的组件测试补 typebox 三项的身份核对。
  后端、内核、构建与作者工具的报告（[impl-review-omp.txt](evidences/impl-review-omp.txt)，omp）：重要 2、建议 1，三条都成立并已修，合入 `3ccea07df`：
  1. 合同按内容核对时，TypeBox 的 `Refine`、`Codec` 把函数放在不可枚举的键上，JSON 比较看不见，带校验函数的产出合同被换成声明那份、校验丢失（`4ab105fe7`）：带函数的合同按不同处理，可移植的仍按内容比较；用例同时覆盖“按清单还原的 JSON 对 TypeBox 产出”可用。
  2. 作者 `package.json` 的 `definitions` 写错类型时退回缺省模块、静默漏掉入口（`4a4ca3e80`）：写错即构建失败。
  3. 架构测试与公开面闭包的导入扫描漏同一行第二条语句、模板字符串的动态导入（`746866803`）：两份测试改用共用的读法（`src/testing/source-imports.ts`，TypeScript 语法树），有自己的测试。
  验证：类型检查，内核 394 例，应用 Bun 1465 例（全量时 `files/project-child.test.ts` 偶发失败一例，单独连跑三次都过，与本次无关）、Vitest 364 例。审查 worktree 已删。

## 下一步

无。本 Task 完成；作者 API 在 [t14](../t14-plugin-author-api/README.md)。
