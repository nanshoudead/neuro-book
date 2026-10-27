---
schema: nbook.task/v2
taskId: t03-shared-packages-migration
status: active
updated: 2026-10-27
---

# 共享包与迁移

## 目标与范围

按 t01 的方案与 t02 的结论落地：

- 共享包端口：nb-form、nb-agent-ui、nb-markdown、nb-ui 合并各自的 `say`、`formatText`、locale 类型（现有四份副本：`neuro-book/src/shared/localized-text.ts`、`nb-agent-ui` 的 `types.ts`、nb-form 的 `text.ts`、`nb-markdown/src/locale.ts`）；
- 已发布包的兼容：列出包、公开接口是否变、目标版本、发布顺序、宿主重建（nb-form、nb-agent-ui、nb-markdown 已发 0.1.0，nb-story 已发 0.1.1 且随包带 `dist/web`），加 tarball 安装与 `dist/web` 的 smoke。发布本身逐次授权；
- 插件 SDK 还没发布（ADR 0030），直接切换，同时改 `sdk.test.ts` 的导出面快照与 `surface.test.ts`；
- 内联文字用脚本抽进目录：约 1178 处 `"en-US"`、124 个文件（非测试 110 个），按插件逐个切；
- 测试：约 369 个文件断言了中文文字（e2e 37 个里有 30 个），改成按键或结构断言。

估计 8 到 11 个工作日（独立设计的估算），t01 定稿后重估并考虑再拆。

合同：按 t01 定稿后的 Spec，会改 [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 等的声明字段。

## 当前状态

提案已接受（2026-10-27）。计划：[plan.md](plan.md)（第二版，两轮计划审查已处理）。Haiku 与 Sonnet 的对照实验：`evidences/haiku-experiment.txt`。代码在 Work 分支 `feat/w00028-i18n`（worktree `.worktree/w00028-i18n`）。

### 切片记录

| 片 | 提交 | 验证（实际跑的命令与结果） |
|---|---|---|
| 1 纯数据层与端口 | `d8a2234af` | `packages/nb-ui`：`bunx vitest run src/text src/text-port` 15 过；`bun run typecheck` 退出 0。`packages/neuro-book`：`bun test src/shared/text.test.ts` 11 过；`bun run typecheck` 退出 0。`docs:check`、`governance:check` 无失败 |
| 2 语言类型改字符串 | `967053a30` | `nb-agent-ui`：`bun test` 184 过、vitest 51 过、typecheck 退出 0；`nb-markdown`：`bun test` 261 过、vitest 112 过、typecheck 退出 0；`nb-form`：bun 99 过、vitest 88 过；`dev-panel` typecheck 退出 0；`neuro-book`：`test:bun` 1538 过、`test:vitest` 373 过、typecheck 退出 0。另：nb-agent-ui、nb-markdown 的核心边界与应用 SDK 的服务端子路径放宽到可导入 `@notnotype/nb-ui/text`（纯数据层，没有外部依赖），两包 AGENTS.md 同步改。`nb-story` typecheck 报 `relations-view.ts` 找不到 `StoryNetwork.vue`，master 上同样报，与本片无关 |
| 3a 宿主引擎、窗口能力、注入与本地记录 | `e9cbe52e9` | `neuro-book`：`bun test src/web/host/text-engine.test.ts` 17 过（含与最小实现一致的 8 例）、`locale-hint.test.ts` 2 过；`test:bun` 1555 过、`test:vitest` 373 过、typecheck 退出 0；`docs:check`、`governance:check` 无失败。设计：引擎是窗口能力 `windowTextKey`（`src/shared/window-text.ts`），设置插件新增 `locale` 入口（启动即激活，引擎是可选依赖）把设置值推给引擎，值来自用户层时宿主写本地记录 `nbook.host-locale`；切换语言命令的选项改由 `HOST_LOCALES` 生成。还没有端到端测试覆盖“改设置后界面换语言”，留到 3c 替换各插件的 `displayLocale` 时一起补 |

## 下一步

第 3b 片：静态文字进宿主目录（失败页、`NotFoundPage`、离线横幅、`boot.ts`、两份 `index.html`）、`<html lang>`；再 3c：各插件改从端口取语言、共享包目录登记表、端到端测试。
