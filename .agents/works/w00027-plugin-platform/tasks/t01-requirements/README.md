---
schema: nbook.task/v2
taskId: t01-requirements
status: active
updated: 2026-10-17
---

# 插件平台需求与规范范围

## 目标与范围

把已接受的非内置插件设计收成**可实施、可验证、能交给第三方作者**的规范，并与开发者确定本轮的落点与切片顺序。产出：规范地图、缺口清单、切片计划（`plan.md`），经开发者确认后按切片另建 Task。

候选范围：

- 清单与包格式：`runtime.plugin-manifest`（`package.json` 字段、入口、依赖、贡献、`pluginVersions`）。
- 发现、安装与升级：`runtime.plugin-install`（安装目录、登记表、`nbook.plugins`、兼容检查、安全模式）。
- 代码装载：`runtime.plugin-code-loading`（服务端 ESM、浏览器共享模块表与插件文件端点、回收）。
- 作者合同：`runtime.plugin-api`（SDK、激活上下文、跨插件 API）、`runtime.api-docs`。
- 生命周期：`runtime.plugin-hot-plug`、`runtime.stall-watchdog`。
- 作者体验：从目录安装的完整示例插件、SDK 构建预设与纯度检查、作者文档、脚手架。
- w00017 [t63](../../../w00017-application-runtime-architecture/tasks/t63-plugin-activation-trigger/README.md)：插件触发自己定义的激活事件（`nbook.commands` 的 `onCommand` 第一个消费者）。

非目标：插件市场、在线分发、签名、沙箱（ADR 0022 已定完全信任）；多用户各自安装；把内置插件迁出仓库。

## 行为合同

本 Task 不改代码，行为以这些 Spec 为准（现状与缺口见下）：

- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)
- [`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md)
- [`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)
- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)
- [`runtime/plugin-hot-plug.md`](../../../../../docs/specs/runtime/plugin-hot-plug.md)
- [`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)（已实现，外部加载的边界在这里）

## 当前状态

2026-10-17 开工。已完成现状调查（只读），结论如下。

**已实现（代码级）**

- 代码定义插件：`defineEntry`／`PluginDefinition`、入口、按入口的服务依赖与提供项、贡献点、远程服务、插件状态 store、激活事件前缀。内置插件按 `src/plugins/<插件>/{plugin.ts,backend/,web/,shared/}` 组织。
- 产品插件集合是静态数组 `productPlugins`；服务端、项目、浏览器各自按 id 查静态定义表；内核明确只装配受信定义，不扫描、不动态加载（`packages/nb-runtime/src/plugins/plugins.ts:7`）。
- 浏览器已有按需加载**应用内**组件的能力（`views/registry.ts` 的 `load()`），不是外部插件代码加载。

**planned（Spec 已写、未实现）**

| Spec | 缺口 |
|---|---|
| `runtime.plugin-manifest` | 清单文件与校验器、`version-mismatch` 推导、第三方由 SDK 构建预设从 `defineEntry` 生成清单、内置插件以对齐测试证明能用同一清单表达（不生成清单文件） |
| `runtime.plugin-install` | State Root 安装目录与 `plugins.json` 登记表、`nbook.plugins`（列表／安装／启停／卸载／升级）、`engines.neurobook`、安全模式 |
| `runtime.plugin-code-loading` | 服务端入口装载、浏览器宿主模块表与插件文件端点、代码回收 |
| `runtime.plugin-api` | SDK 包与构建预设、激活上下文、worker、兼容承诺 |
| `runtime.api-docs` | 从清单生成 OpenAPI；路由声明模型尚未选定 |
| `runtime.plugin-hot-plug` | 运行期启停、引用撤回与在途结算 |
| `runtime.stall-watchdog` | 主线程卡死、Manager 重启、安全模式恢复 |

**已知矛盾／需在规范收口时处理**

- `plugin-manifest` 说 SDK 构建预设生成 `entries`，而当前代码定义插件的描述是唯一事实源；两套声明的生成方向与校验归属要定清。
- `plugin-install` 承诺“安装与升级即时生效、页面不刷新”，依赖 `plugin-hot-plug` 与浏览器装载；切片顺序不能让规范先于能力发布。
- `@notnotype/nb-runtime` 仍 `private: true`，exports 是内核机制入口，不是第三方 SDK；SDK 是否独立成包、公开到哪一层未定。
- `api-docs` 与已实现的“整插件 Hono 挂载”模型不一致。

## 下一步

待开发者确认本轮落点（见本轮提问）后，按 [implementation-planning](../../../../skills/implementation-planning/SKILL.md) 写 `plan.md`，再另建实施 Task。
