---
schema: nbook.task/v2
taskId: t04-browser-loading-sdk
status: active
updated: 2026-10-23
---

# 浏览器入口装载与插件 SDK

## 目标与范围

实现 [t01 plan](../t01-requirements/plan.md) 的 S2–S3：第三方插件的浏览器入口代码从安装目录经插件文件端点取回，与宿主共享 Vue、nb-ui 与 SDK；插件自带视图、命令与服务端远程服务。作者用 SDK 构建预设产出一个可安装的插件目录（生成清单、纯度检查）。

范围：

- SDK 包 `packages/nb-plugin-sdk`：公开入口类型、`defineEntry` 等纯函数再导出、构建预设（服务端 ESM／浏览器登记工厂式 CJS）、清单生成、纯度检查。
- 宿主模块表、插件文件端点、浏览器装载与注销、样式装载。
- 窗口启动时把第三方浏览器入口纳入插件集合；入口激活失败只影响该入口。
- 服务端入口装载（同一代次一份模块实例）与 `onRemote` 激活。
- 示例外部插件：视图 + 命令 + 服务端远程服务，构建产物可直接安装。

非目标：启用／禁用即时生效（`plugin-hot-plug`，t01 plan 的 S5）；热升级回滚；代码回收的强承诺（按 Spec 尽力回收）；插件市场与在线分发。

## 行为合同

- [`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md)（装载、共享模块表、纯度检查、回收、文件端点、错误边界）
- [`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)（SDK、激活上下文、远程形态）
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（入口 `main`、清单生成）
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)（第三方浏览器入口接入、失败页）

实施设计见 [plan.md](plan.md)。

## 当前状态

2026-10-17 建 Task，未开工。依赖 [t03](../t03-manifest-and-install/README.md) 的清单解析、登记表与宿主接入。

2026-10-23 计划按 t02 改过的设置接口核对更新（[plan.md](plan.md)）。开发者定：t04、t05 按 autonomous-delivery 自主推进，照推荐做的决定记进 Work 的待确认清单；本次可以做深入审查（多个、多种模型交叉审查）。

## 下一步

计划的深入设计审查：omp（默认模型）审后端、内核与安全，Claude Opus 交叉审同一范围，Claude Sonnet 审浏览器装载与 SDK 的接口形状；处理后在 Work 分支 `feat/w00027-plugin-platform` 上按切片开工。
