---
schema: nbook.task/v2
taskId: t22-github-issues-256-259
status: active
updated: 2026-10-27
---

# GitHub issue 256 到 259

## 目标与范围

修 GitHub 上 nb-story 的四个新 bug（#256、#257、#258、#259），行为合同改 [`story.cli`](../../../../docs/specs/story/cli-skill.md)、[`story.qa`](../../../../docs/specs/story/qa.md)、[`story.ingest`](../../../../docs/specs/story/ingest.md)。计划见 [plan.md](plan.md)。#252、#254 的 PR（#253、#255）已在 2026-10-27 审过并合入本地 master，不在本 Task。

开发者 2026-10-27 的决定：

1. #258 的输出上限默认取 OMP 的做法（见计划），不取 8192；
2. #256 不读 `~/.omp` 下任何配置：nb-story 与 omp 完全独立，只改报错与 README；
3. issue、文档、示例里不写中转站的域名与服务商名，用中性占位（清理旧写法记在 [t21](../t21-usage-feedback/README.md)）。

## 当前状态

2026-10-27 开工，分支 `feat/w00024-t22-issues-256-259`（worktree `.worktree/w00024-t22`）。
