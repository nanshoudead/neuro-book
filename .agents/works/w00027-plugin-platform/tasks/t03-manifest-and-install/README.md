---
schema: nbook.task/v2
taskId: t03-manifest-and-install
status: planned
updated: 2026-10-17
---

# 清单校验与第三方插件安装

## 目标与范围

实现 [t01 plan](../t01-requirements/plan.md) 的 S1：第三方插件以 `package.json` 清单声明，从本地文件夹安装到 State Root，启动时发现并登记；设置窗口出现插件页，可查看、安装、启用、禁用、卸载。

范围：

- 内核清单解析与校验（`packages/nb-runtime/src/plugins/manifest.ts`），把清单映射为 `PluginDescriptor` 与 `PluginDefinition`（入口元数据 + 顶层贡献）。
- `nbook.plugins` 内置插件：`<State Root>/plugins/plugins.json` 登记表与目录布局、安装（复制、`files`、符号链接拒绝）、启用／禁用、卸载、远程服务 `nbook.plugins/registry`。
- 服务端把已安装且启用的第三方描述并入插件集合；浏览器引导携带第三方描述，窗口在运行期注入。
- 安全模式 `NEURO_BOOK_SAFE_MODE=1` 不加载第三方声明。
- 设置窗口的“插件”分区页（`settings.sections` 的 page 分区，`category: "plugins"`）。

非目标：

- 代码装载、入口激活与 SDK（[t04](../t04-browser-loading-sdk/README.md)）。
- 启用／禁用即时生效：本轮只写登记表，下次启动生效，界面标明（开发者 2026-10-17 确认）。
- 热升级与回滚：不同版本安装本轮返回明确失败，要求先卸载；私有数据的删除选项、影响预览、文件选择器。

## 行为合同

- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（清单字段、校验、顶层贡献登记；本轮实现其中可由声明式插件验证的部分）
- [`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)（安装目录、登记表、安装／启停／卸载、兼容检查、安全模式）
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（引导给窗口的插件集合）
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（page 分区）

实施设计见 [plan.md](plan.md)。

## 当前状态

2026-10-17 建 Task，同日开发者确认计划与设计审查后的修订（[plan.md](plan.md)），在 worktree `.worktree/w00027-t03-manifest-and-install`（分支 `feat/w00027-t03-manifest-and-install`，未 push、未合入）实施完 S1a–S1e，并按两份实现审查修订：

- 提交：`b41cc5025`（实现）、`3cce46618`（真实浏览器 e2e）、`98db53316`（插件页分组）、`fea2c9410`（后端审查修正）、`7ec47e9d8`（插件页按界面审查重做）。
- 实现审查：后端与内核交 omp（[evidences/impl-review-omp.txt](evidences/impl-review-omp.txt)，9 条：重要 8、建议 1），插件页交 Sonnet（[evidences/impl-review-ui.txt](evidences/impl-review-ui.txt)，17 条：重要 9、建议 8）。处理见 plan.md 的“实施记录”。
- 验证（修订后）：内核 `bun test` 342 例、应用 `bun test` 1545 例、Vitest 372 例通过；两包 typecheck；`docs:check`、`governance:check` 无失败；`e2e/plugins.e2e.ts` 在 Chrome 上通过（含键盘切换与卸载后的焦点）。修订前另跑过 `settings`、`browser-host`、`rpc` 三组 e2e，22 例通过。`markdown/asset-urls.test.ts` 的失同步用例在 master 上也约一半概率超时，与本次无关。
- 本机 `/tmp` 的用户配额被别的会话占满时，Chrome 报 `Disk quota exceeded`；这次给 Playwright 设 `TMPDIR` 到家目录下绕开，没有动别的会话的文件。

## 下一步

开发者决定是否对审查后的修订再审一轮，然后合入 master；之后去掉 Spec 里本次实现条目的“（planned）”并补实现合同（晋升由开发者批准），再开 t04。
