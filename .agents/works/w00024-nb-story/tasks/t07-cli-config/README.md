---
schema: nbook.task/v2
taskId: t07-cli-config
status: done
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

- 2026-10-20：omp（默认模型）实现审查，报告 [evidences/impl-review.txt](evidences/impl-review.txt)，9 条（阻断 1、重要 7、建议 1），全部成立，在 a1a59db33 一并修正并补测试：命令专属选项写在命令名前与开关带等号恢复旧行为（交给 commander 前整理命令行）；密钥环境变量名在字段解码处统一检查（非交互 init、set 原先不查，会把误贴的密钥写进配置并回显，smoke 也发现了）；字段表不再认原型上的名字；写失败后清理失败不再盖掉 `qa_config_write_failed`；终端里已有配置又给了字段选项时确认覆盖；`config test` 不再输出模型回的正文；cli-skill 的调用模型边界写全、帮助条目改为输出 15；交互测试失败时收口。接受的差异：`nbstory books --` 旧版报用法错误，现在成功。
- smoke（2026-10-20）：临时配置目录下 init、show、set、unset、test 的输出与退出码；伪终端里交互 init（拒绝误贴的密钥、Ctrl-C 退出 130 不写盘、已有配置带字段选项时确认覆盖）；真实 luna 渠道 `config test` 带 xhigh 与不带推理档各通过一次。
- 2026-10-20：合入 master（270ddfe41），worktree 与分支已删。开发者同日批准：`story/qa.md` 晋升 implemented（7084bc0e1）；两条回写进 implementation-planning（1556b0637）：实施前先做技术选型，用库替换已有实现时先写对照测试。

## 决定

开发者 2026-10-16 在会话里定：

1. 命令行换 commander。
2. 配置命令与第 1 条一起做。
3. init 可以用交互库；选 `@clack/prompts`（仓库根已声明，Nuxt、Vite 的命令行同款）。

## 下一步

无。`server.test.ts` 的偶发失败另行处理。
