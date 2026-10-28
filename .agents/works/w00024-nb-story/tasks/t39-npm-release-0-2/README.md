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

## 下一步（开发者）

0. 清掉上面的未跟踪文件（`release:publish` 要求会发布的目录干净）。
1. `git push origin master`（README 图片与发布门禁要用 origin/master）。
2. `npm login`，在 master 上 `bun run release:publish`（先不带 `--yes` 看清单，再带 `--yes`）。
3. 发布后在发布用的提交上 `bun run release:smoke --from registry`，把结果记进本 Task 的证据。
