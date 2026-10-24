---
schema: nbook.work/v1
workId: w00027-plugin-platform
issueId: null
status: active
updated: 2026-10-23
---

# 插件平台完善：非内置插件与插件配置

## 目标

为非内置（第三方）插件制定可实施的规范与最小端到端链路：包与清单格式、发现与安装、代码加载、公开 API／SDK、示例与作者文档；同时补齐插件配置与设置插件（密钥、长文本与结构化值的编辑等），让内置插件与外部插件都能声明、编辑并使用自己的配置。

来源：开发者 2026-10-17 提出；w00017 收尾时把插件清单与 [t63 插件触发自己的激活事件](../w00017-application-runtime-architecture/tasks/t63-plugin-activation-trigger/README.md) 一并移交本 Work。

## 范围与非目标

- 范围：`docs/specs/runtime/` 下仍为 `planned` 的插件平台合同（清单、安装、代码装载、公开 API、API 文档、热插拔、看门狗），把它们变成可实施、可验证、能写给第三方的规范；以及设置插件尚未实现的配置能力。
- 已确认不做（[ADR 0022](../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)）：插件市场、在线分发、签名、权限沙箱；第一版完全信任，安装即告知插件可访问全部作品、服务器与本机资源。不支持多个用户各自安装插件。
- 内置插件仍随产品构建静态装配；本 Work 不把它们迁出仓库。

## 分支

本 Work 的代码在 worktree `.worktree/w00027-plugin-platform`、分支 `feat/w00027-plugin-platform` 上（2026-10-20 按“一个 Work 一条分支”由 t03 的分支改名而来），各 Task 依次在这条分支上提交、在这条分支上验证；合入 master 的时机由开发者决定。2026-10-20 开发者同意合入：先把 master 合进 Work 分支（合进了 w00029 t04 的弹出列表），在 Work 分支上验证后 master 快进到 `da4e006af`，内容为 t03、t07 S0 与 S1（含两轮审查修正）、t02 S1 与 S6。合并后的验证：类型检查，应用 Bun 1560 例、Vitest 382 例，内核 347 例，nb-form 93 例，nb-ui 498 例，`docs:check`、`governance:check`，以及设置、插件、代码编辑器设置、编辑器区、书架、浏览器宿主、nb-ui Lab、Markdown 输入八组 e2e 71 例。`editor-area.e2e.ts` 的“重新打开回到上次的光标”在负载重时两次失败、单独与整份重跑共五次通过，没抓到失败现场，原因未查明。之后 Work 分支继续用于后续 Task。

## 任务

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与规范范围：规范收口、切片与实施计划（计划已写，见 [plan.md](tasks/t01-requirements/plan.md)） |
| [t03](tasks/t03-manifest-and-install/README.md) | S1：清单校验与第三方插件安装、`nbook.plugins` 与设置页 |
| [t04](tasks/t04-browser-loading-sdk/README.md) | S2–S3：浏览器入口装载、插件文件端点与 SDK 构建预设 |
| [t05](tasks/t05-author-experience/README.md) | S4：脚手架、作者文档与完整示例 |
| [t02](tasks/t02-settings-completion/README.md) | 设置补齐：通用编辑、搜索、页面未保存保护、动态选项、声明 API 易用性；开发者 2026-10-20 定提前到 t04 之前、不并行 |
| [t07](tasks/t07-low-code-forms/README.md) | 低代码：全项目共用的 schema 表单与表单组件（nb-ui 控件统一合同、补缺）；排在 t02 之前 |
| [t06](tasks/t06-settings-ui-polish/README.md) | 设置界面的样式收口：按设计稿重新收口设置窗口与设置组件的外观（t02 之后） |
| [t10](tasks/t10-settings-window-chrome/README.md) | 设置窗口的外框（去掉标题栏、可拖、圆角）与“本作品”沿用行（控件一直在、标“来自用户设置”）；开发者看 t06 实现后提出 |
| [t08](tasks/t08-secret-store/README.md) | 密钥存储（搁置）：开发者 2026-10-20 定暂时不做加密，API Key 用明文的普通配置项；计划、审查与调研留作重开时的参考 |
| [t11](tasks/t11-activation-output-shape/README.md) | 内核核对入口激活产出的形状，不对时报 `activation-threw`（t05 回写建议；2026-10-24 并入 t13 S1b 完成） |
| [t12](tasks/t12-plugin-dx-review/README.md) | 插件开发体验（Sonnet 以作者身份走一遍）与可维护性复查，及待确认清单改判的三项（2026-10-24 开发者要求） |
| [t13](tasks/t13-sdk-package-split/README.md) | SDK 拆成独立包（作者工具、模板、文档、示例）、内核去掉 NeuroBook 常量、通用插件管理在目录上分开（开发者 2026-10-24 定；计划待写） |
| [t14](tasks/t14-plugin-author-api/README.md) | 作者 API 的形状：`definePlugin` 与贡献助手、结果助手、短名与缺省值、出错可见（t13 design.md A1 到 A9，开发者 2026-10-24 定 D5） |

## 关键现状

平台设计已 acceptance，机制部分已实现，但外部插件的运行路径完全没有：应用只用代码里的静态 `productPlugins` 装配内置插件，没有从目录发现、安装或执行外部代码的入口（`packages/neuro-book/src/manifest.ts`、`server/plugins.ts`、`web/plugins.ts`）。详见 [t01](tasks/t01-requirements/README.md)。

## 待确认清单

开发者 2026-10-21 指定按 autonomous-delivery 推进 t02，2026-10-23 指定 t04、t05 同样自主推进：照推荐做、等事后追认的决定记在 [pending-confirmations.md](pending-confirmations.md)。

## 后续事项

开发者 2026-10-20 确认记为本 Work 的后续，按插件需求再排，还没有建 Task：

- 缺的贡献点：编辑器的补全与悬停（例如人物名补全、悬停显示人物卡）、编辑区正文的右键菜单、文件树装饰（徽标、字数）、快速打开的提供者（命令面板里搜人物与地点）、主题与配色贡献（现在主题是写死的两个选项）。
- 内置插件都没有提供按需激活的事件，所有入口启动即激活；t02 先补“设置分区被显示时激活”。
- 凭据的加密存储（t08 搁置）：需要时按插件隔离的键值密钥库重开，起点见 t08 的“下一步”。
- 生成式视图：Agent 对话流里 LLM 生成的 TSX 可视化程序，在不同源的沙箱 iframe 里运行，只做 Web；复用 t07 的表单组件；随 Agent 对话流重建，先写提案（开发者 2026-10-20 定名）。
- 插件页显示第三方插件各入口的激活状态（plugin-manifest 输出 6 的后半），卸载与禁用确认里列出依赖它的插件（t04 设计审查提出，2026-10-23）。
- `nbdev worktree new` 只能建 Task 级 worktree，要补 Work 级的（`.worktree/<Work 编号>-<短名>`、`{type}/<Work 编号>-<slug>`）。

## 范围外发现

- `packages/neuro-book/src/server/projects/registry.ts` 的作品登记表 `projects.json` 只做进程内串行，注释写“只由本服务端进程写入”；而同一状态根可以有多个服务端进程（`runtime/projects.md`）。两个进程同时登记作品会互相覆盖。与 t03 设计审查第 8 条（插件登记表）同类，t03 改用 `replaceLocked`；`projects.json` 不在本 Work 范围，待开发者安排。

## 授权与限制

- 当前只做需求、规范与设计；实施切片经开发者确认后另建 Task。
- 远端 Issue／PR 写入、push、合并、发布逐次授权；`issueId: null`。
