---
schema: nbook.task/v2
taskId: t39-npm-release-0-2
status: planned
updated: 2026-10-28
---

# nb-story 0.2.0 发布准备（含 nb-runtime 0.2.0、nb-harness 0.1.1）

## 目标与范围

自 0.1.1 以来的抽取、修订、网页等改动发 npm：改版本、release:check、release:smoke，写发布说明；push 与 bun publish 由开发者执行

合同：无新的行为合同；步骤见 [`repository-workflow.md`](../../../../docs/standards/repository-workflow.md) 的“npm 包”。前一次发布见 [t17](../t17-npm-release/README.md)。

## 决定

开发者 2026-10-28 说“可以做发布相关工作了”。版本号是我按 0.x 惯例定的（待开发者追认）：nb-story 0.1.1 到 0.2.0（大量新功能与数据字段）；nb-runtime 0.1.0 到 0.2.0（t17 记下的不兼容改名）；nb-harness 0.1.0 到 0.1.1（只有修正）；其余 6 个包自上次发布没有改动，不重发。应用 `@notnotype/neuro-book`（0.11.1）与插件 SDK 是另一条发布线，这次不动。

## 当前状态

- 版本号提交在 master（见 `git log`）；`bun run release:check` 通过，发布顺序 profile、session、runtime、ui、harness、form、markdown、agent-ui、story（已发布的版本会被跳过）。
- `bun run release:smoke` 通过（打包、仓库外安装、`nbstory` 命令行与 Skill、`serve` 加真实浏览器、Vite 宿主构建、应用与 SDK 的冒烟）。
- 发布说明草稿：[evidences/release-notes.md](evidences/release-notes.md)。

冒烟在版本号提交 `f374fa20f`（已在 master）上通过，tarball 与 `release-manifest.json` 在主工作区的 `dist/release/`（git 忽略）。`bun run release:publish` 在主工作区干跑停在门禁：`packages/nb-story/examples/journey-to-the-west/` 下有未跟踪的 `xiyouji-graph.json` 与 `xyj-library/`（示例走读留下的，不属于我，也不会进包：`files` 白名单不含 examples），发布前要先移走或清掉。

## 发布记录

- 2026-10-28 开发者发布了 nb-runtime 0.2.0、nb-harness 0.1.1、nb-story 0.2.0（`--auth-type web`；registry 的版本信息有几十秒延迟，刚发完查到的还是旧版）。
- 从 registry 装 nb-story 0.2.0 的冒烟失败：它依赖 `nb-runtime ^0.1.0`（应为 `^0.2.0`）。原因：`bun publish` 改写 `workspace:^` 用的是 `bun.lock` 里记的工作区版本，升版本号后没跑 `bun install` 刷新锁文件；打包冒烟用 file: 的 tarball 覆盖了依赖，查不出。0.2.0 能用（`nbstory`、`serve`、RPC 在 runtime 0.1.0 上都正常），只是依赖范围不对。
- 修：`release:check` 加 `lockfile_version`（锁文件里的工作区版本要与 `package.json` 一致，有测试、做过变异检查）；刷新锁文件，nb-story 升 0.2.1（`af4a3a288`）。打包冒烟通过，tarball 的依赖是 `nb-runtime ^0.2.0`、`nb-harness ^0.1.1`。

- 2026-10-28 开发者发布了 nb-story 0.2.1。`bun run release:smoke --from registry` 通过（装到 nb-harness 0.1.1、nb-runtime 0.2.0、nb-story 0.2.1；命令行、Skill、`serve`、Vite 宿主、应用与 SDK 都通过）：[证据](evidences/smoke-registry-0.2.1.txt)。

## 结果与遗留

- registry 现状：nb-runtime 0.2.0、nb-harness 0.1.1、nb-story 0.2.1（`latest`）；nb-story 0.2.0 依赖范围写旧（`nb-runtime ^0.1.0`），能用，要不要 `npm deprecate` 由开发者定。
- nb-agent-ui 的源码自上次发布以来改过（w00028）、应用与插件 SDK 的源码也改过，都没提版本号，这次没发；下次发布前提版本号。
- 经验：升版本号后先跑 `bun install` 刷新锁文件；`release:check` 现在会查。
