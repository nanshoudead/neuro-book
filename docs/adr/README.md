# 架构决策记录

`docs/adr/` 保存已接受且需要长期解释的架构、协议、所有权和安全决策。ADR 解释“为什么”，完整可观察行为仍由 [`../specs/README.md`](../specs/README.md) 登记的当前规范定义。

文件名使用 `NNNN-kebab-case.md`；编号唯一，一级标题中的编号必须与文件名一致。新决策使用下一个空闲编号，不复用已归档或已撤销编号。ADR 接受后正文不改，只能被新的 ADR 取代；被取代的 ADR 保留原文件，在 frontmatter 记录状态与取代者。

每份 ADR 以 frontmatter 开头，状态只写在这里，正文不写“状态”行：

```yaml
---
schema: nbook.adr/v1
status: accepted         # accepted | superseded
decided: 2026-10-07      # 开发者作出决定的日期
superseded-by: null      # superseded 时填取代它的 ADR，写仓库根相对路径
---
```

`bun run docs:check` 核对 `schema` 与 `status` 的取值、`decided` 必填，以及 `superseded` 必须有 `superseded-by`。

ADR 0001–0021 是旧应用的决策，随旧包留在 [`../../packages/neuro-book-legacy/docs/adr/`](../../packages/neuro-book-legacy/docs/adr/README.md)，只作参照；编号从 0022 起在本目录延续。

| 编号 | 决策 |
|---|---|
| [0022](0022-extensible-platform-and-plugin-trust.md) | 可扩展应用平台与第一版插件信任模型 |
| [0023](0023-v2-frontend-backend-stack.md) | NeuroBook v2 去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox（其中的 UnoCSS 已被 0028 取代） |
| [0024](0024-multi-instance-runtime-topology.md) | 多实例运行时拓扑：项目子进程、内核路由的远程服务与专用 RPC 端口 |
| [0025](0025-service-keys-by-id.md) | 服务键按服务 id 识别，插件之间可引用对方的合同模块（已被 0026 取代） |
| [0026](0026-plugin-definitions-as-constants.md) | 插件定义是常量，宿主的东西走宿主能力服务；沿用 0025 的服务 id 与合同模块约定 |
| [0027](0027-builtin-and-third-party-plugins-are-equal.md) | 内置插件与第三方插件能力相同，信任所有插件：删除代理允许清单，内部服务对所有插件开放 |
| [0028](0028-tailwind-only-host-compiles-nb-ui.md) | 全仓只用 Tailwind v4 一套原子 CSS 引擎，nb-ui 不发预编译产物，宿主编译 nb-ui 源码并按 Tailwind 标准分层 |
| [0029](0029-workspace-packages-publish-source-to-npm.md) | nb-story 与它依赖的 8 个工作区包以源码发布到 npm，只承诺 Bun，内部依赖 `workspace:^`，版本手工管理 |
| [0030](0030-plugin-platform-layering.md) | 内核与应用无关（应用名由平台档案传入），第三方插件的通用管理暂留应用的 `src/plugin-platform/` 并按目录机检，作者材料留在应用包的 `plugin-sdk/` |
