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
- 启用／禁用即时生效：本轮只写登记表，下次启动生效，界面标明（开发者 2026-10-17 待确认；若要求即时生效，先做 `plugin-hot-plug` 再回到本 Task）。
- 热升级与回滚：不同版本安装本轮返回明确失败，要求先卸载；私有数据的删除选项、影响预览、文件选择器。

## 行为合同

- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（清单字段、校验、顶层贡献登记；本轮实现其中可由声明式插件验证的部分）
- [`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)（安装目录、登记表、安装／启停／卸载、兼容检查、安全模式）
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（引导给窗口的插件集合）
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)（page 分区）

实施设计见 [plan.md](plan.md)。

## 当前状态

2026-10-17 建 Task，未开工。设计见 plan.md。

已核实的关键约束：

- 窗口的 `selectPlugins` 要求引导集合里的每个插件都在页面构建内的 `builtin` 里、版本一致，且 `locations` 含 `browser` 时必须有定义（`packages/neuro-book/src/web/host/window.ts:301-333`）。第三方插件必须经运行期描述注入，引导协议要携带描述而不只是 id 与版本。
- 插件集合在进程生命期内不变（`src/server/browser-bootstrap.ts` 的注释与实现），所以本轮启停只能下次启动生效。
- 内核是零依赖包，清单校验用普通 TypeScript 手写，不引入 schema 库。

## 下一步

开发者确认 plan.md 后开工；先做内核清单解析与表驱动测试，再做登记表与 `nbook.plugins`。
