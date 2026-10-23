---
schema: nbook.task/v2
taskId: t04-browser-loading-sdk
status: active
updated: 2026-10-23
---

# 浏览器入口装载与插件 SDK

## 目标与范围

实现 [t01 plan](../t01-requirements/plan.md) 的 S2–S3：第三方插件的浏览器入口代码从安装目录经插件文件端点取回，与宿主共享 Vue、nb-ui 与 SDK；插件自带视图、命令与服务端远程服务。作者用 SDK 构建预设产出一个可安装的插件目录（生成清单、纯度检查）。

范围（2026-10-23 按设计审查修订，详见 [plan.md](plan.md)）：

- SDK：应用的公开面 `src/sdk/`（`index` 与 `browser`），仓库内经别名解析；`build:sdk` 生成可安装的 `@notnotype/nb-plugin-sdk`（打包的实现、打平的类型、构建预设）。
- 构建预设：作者合同、清单生成（含远程合同与贡献点 schema）、逐入口构建、浏览器登记工厂、共享模块与纯度检查、样式与图标。
- 内核：合同进清单、贡献点 schema、版本范围、第三方入口不挡启动。
- 启动数据带清单与内容摘要、运行版本的跨进程租约、插件文件端点。
- 浏览器装载（宿主模块表、`<script src>` 加登记工厂、样式）与窗口接入；服务端与项目实例装载（每次激活新实例）。
- 升级确认框列出重启后受阻的插件；`entries-not-loaded` 收尾。
- 示例 snippets、clock、notes、counter 外置，经构建、安装运行。

非目标：启用／禁用即时生效（`plugin-hot-plug`，t01 plan 的 S5）与运行中注销；热升级回滚；代码回收的强承诺（按 Spec 尽力回收）；插件市场与在线分发；工作台视图贡献的示例（menu、file-menu 与完整示例在 t05）。

## 行为合同

- [`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)（装载、共享模块表、纯度检查、回收、文件端点、错误边界）
- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（SDK、激活上下文、远程形态）
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（入口 `main`、清单生成）
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（第三方浏览器入口接入、失败页）

实施设计见 [plan.md](plan.md)。

## 当前状态

2026-10-17 建 Task，未开工。依赖 [t03](../t03-manifest-and-install/README.md) 的清单解析、登记表与宿主接入。

2026-10-23 计划按 t02 改过的设置接口核对更新（[plan.md](plan.md)）。开发者定：t04、t05 按 autonomous-delivery 自主推进，照推荐做的决定记进 Work 的待确认清单；本次可以做深入审查（多个、多种模型交叉审查）。

2026-10-23 深入设计审查：omp（默认模型，10 条，写完后因上游额度用完退出，未续跑）、Claude Opus（15 条：阻断 1、重要 8、建议 6）、Claude Sonnet（20 条：重要 14、建议 6），报告在 [`evidences/`](evidences/)。没有不成立的条目，按 plan.md 的“设计审查的处理”修订计划；主要变化：SDK 由应用生成、不建依赖应用的工作区包；浏览器回到 `<script src>` 加登记工厂；服务端每次激活前删模块缓存再装载；`@vue/reactivity` 进共享模块；运行版本的跨进程租约；文件 URL 带内容摘要；贡献点 schema 进清单。照推荐做的取舍记进 Work 的待确认清单。

- 2026-10-23 S2a（`1b6a19fdf`，Spec `a889bd7f3`）：清单 `contracts` 与贡献点 `schema`（纯 JSON Schema）、内核 `manifestOf`、`pluginVersions` 版本要求（必需依赖受阻、可选依赖不注入）、远程校验的 schema 写坏不再留下未处理的 rejection、第三方插件不挡启动。内核 369 例、应用 1354 例（单独跑）通过。
- 2026-10-23 S2b（`bc29ef830`）：SDK 公开面 `src/sdk/`、`settingsPageContribution`、`build:sdk` 生成可安装的 SDK 包（仓库外 tsc 通过）；示例插件只从 SDK 导入，clock 改用宿主时钟。`test:affected` 里 llmlint 的 web 测试因缺 Nuxt 生成的 tsconfig 失败（主工作区同样缺，与本次无关）。
- 2026-10-23 S2c（`abf503229`）：构建预设 `scripts/plugin-sdk/build-plugin.ts`（作者合同、经 Vite SSR 读声明、逐入口构建、浏览器登记工厂、模块图纯度检查、样式包进 `@layer components` 并生成 Lucide 图标规则、清单 `style` 字段），`build:examples`，生成的 SDK 包带上构建预设；测试 12 例（含仓库外用生成的包构建插件）。实施发现：Vite 的 `runnerImport` 不初始化 CSS 插件，改用不监听端口的开发服务 `ssrLoadModule`；Bun 的 `require.resolve` 会套用 tsconfig 路径别名，包根目录改为逐级找 `node_modules`；服务端与浏览器入口写在同一个定义模块里时，服务端产物会带上 `/browser`，纯度检查照常拦下（作者要分模块写，t05 写进作者文档）。
- 2026-10-23 S2d（`2fd4088a6`）：启动数据带清单原文、版本目录与内容摘要；项目子进程的 `plugins` 消息改带安装信息；运行版本的跨进程租约（真实子进程测试：另一个服务端切换版本、移除卸载记录，但本服务端在用的目录留到它退出后才回收）；插件文件端点（真实请求测试编码穿越、摘要不符、符号链接、同版本重装后旧地址 404）；浏览器引导 v4。三处宿主仍只登记第三方插件的顶层声明（`thirdPartyDefinition`），按清单登记入口随装载器在 S2e（浏览器）、S3a（服务端与项目）接上。e2e 发现 S2a 的回归：窗口引入 `semver`（CommonJS）后开发会话白屏，加进 Vite 预构建清单后 `settings`、`plugins` 两组 e2e 17 例通过。

## 下一步

按修订后的计划从 S2a 开始，在 Work 分支 `feat/w00027-plugin-platform` 上逐片实现。
