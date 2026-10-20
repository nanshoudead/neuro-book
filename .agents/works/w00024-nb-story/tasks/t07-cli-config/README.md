---
schema: nbook.task/v2
taskId: t07-cli-config
status: in-progress
updated: 2026-10-20
---

# nb-story 命令行换 commander，加 nbstory config

## 目标与范围

两件事，一起做：

1. 命令行解析换成 commander：命令表与解码器不变，获得按命令的 `--help`、统一的未知选项处理。
2. 新增 `nbstory config`（`init`、`show`、`set`、`unset`、`test`），配置不再手编文件。`init` 的交互用 `@clack/prompts`。

合同：改 [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)（命令列表、边界）与 [`story/qa.md`](../../../../../docs/specs/story/qa.md)（配置一节，新增输出与失败）。设计与切片见 [plan.md](plan.md)。

## 当前状态

- 2026-10-16：开发者在会话里定：换 commander；配置命令现在就做；init 可以用常和 commander 搭配的交互库（问答连续对话另立 [t08](../t08-qa-conversation/README.md) 排后面）。经 nbdev 新建，plan.md 写好，等开发者看要点。

- 2026-10-20：分支 `feat/w00024-t07-cli-config`（worktree `.worktree/w00024-t07-cli-config`）实现 S1 到 S5，nb-story 测试与类型检查通过；plan.md 补了“技术选型”一节（开发者 2026-10-16 要求实施前先做选型）。`src/server/server.test.ts` 的“--json 时启动成功只输出一份 JSON”在 master 上就不稳定（12 次挂 5 次，serve 收到 SIGTERM 后以 143 退出、留下 `.serve.json`），不是本 Task 引入的，另行处理。

## 决定

开发者 2026-10-16 在会话里定：

1. 命令行换 commander。
2. 配置命令与第 1 条一起做。
3. init 可以用交互库；选 `@clack/prompts`（仓库根已声明，Nuxt、Vite 的命令行同款）。

## 下一步

omp 实现审查与 smoke，之后交开发者合入。
