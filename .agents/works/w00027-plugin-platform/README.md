---
schema: nbook.work/v1
workId: w00027-plugin-platform
issueId: null
status: active
updated: 2026-10-17
---

# 插件平台完善：非内置插件与插件配置

## 目标

为非内置（第三方）插件制定可实施的规范与最小端到端链路：包与清单格式、发现与安装、代码加载、公开 API／SDK、示例与作者文档；同时补齐插件配置与设置插件（密钥、长文本与结构化值的编辑等），让内置插件与外部插件都能声明、编辑并使用自己的配置。

来源：开发者 2026-10-17 提出；w00017 收尾时把插件清单与 [t63 插件触发自己的激活事件](../w00017-application-runtime-architecture/tasks/t63-plugin-activation-trigger/README.md) 一并移交本 Work。

## 范围与非目标

- 范围：`docs/specs/runtime/` 下仍为 `planned` 的插件平台合同（清单、安装、代码装载、公开 API、API 文档、热插拔、看门狗），把它们变成可实施、可验证、能写给第三方的规范；以及设置插件尚未实现的配置能力。
- 已确认不做（[ADR 0022](../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)）：插件市场、在线分发、签名、权限沙箱；第一版完全信任，安装即告知插件可访问全部作品、服务器与本机资源。不支持多个用户各自安装插件。
- 内置插件仍随产品构建静态装配；本 Work 不把它们迁出仓库。

## 任务

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与规范范围：确定本轮落点与切片顺序，产出规范地图、缺口清单与实施计划 |
| [t02](tasks/t02-settings-completion/README.md) | 设置插件补齐：密钥、长文本与数组／对象的通用编辑、设置内搜索等（未开工，范围待 t01 确认） |

## 关键现状

平台设计已 acceptance，机制部分已实现，但外部插件的运行路径完全没有：应用只用代码里的静态 `productPlugins` 装配内置插件，没有从目录发现、安装或执行外部代码的入口（`packages/neuro-book/src/manifest.ts`、`server/plugins.ts`、`web/plugins.ts`）。详见 [t01](tasks/t01-requirements/README.md)。

## 授权与限制

- 当前只做需求、规范与设计；实施切片经开发者确认后另建 Task。
- 远端 Issue／PR 写入、push、合并、发布逐次授权；`issueId: null`。
