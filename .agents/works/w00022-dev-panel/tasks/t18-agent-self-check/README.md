---
schema: nbook.task/v2
taskId: t18-agent-self-check
status: done
updated: 2026-10-15
---

# Agent 自助验收：dev start 带样例作品、shot 截产品页面

## 目标与范围

处理[后续清单](../../followups.md)第三档（开发者 2026-10-14 定，按 autonomous-delivery 推进）：

1. `nbdev dev start --sample`：起开发服务时顺带放一份样例作品；
2. `nbdev shot --page <路径>`：截打开了作品的真实工作台，可带点击步骤。

合同：[命令行合同](../../../../../packages/dev-panel/docs/cli.md)；neuro-book 包新增 `dev:sample`、`page:shot` 两个脚本。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-14 实施完成，分支 `feat/w00022-t18-agent-self-check` 已合进集成分支 `feat/w00022-dev-panel`（`3ec9f45e5`）；2026-10-15 经开发者同意合入 `master`（合并提交 `8634c9d70`），面板 4400 已重启。各提交：

| 提交 | 内容 |
|---|---|
| `fb69f6d7b` | S1：`NBDEV_SAMPLE=1` 时 neuro-book 开发后端在就绪后放样例作品（`.dev-sample/sample`），报 `[dev] open-path` 或 `[dev] sample-failed`；`projectUrl` 挪到 `plugins/projects/shared` |
| `4941f0c89` | S2：`page:shot` 截产品页面，步骤按命令行顺序执行 |
| `3d2f808e4` | S3：`nbdev dev start --sample`（`SAMPLE`、`SAMPLE_FAILED` 事件，`--sample` 参与复用比较，`--sample-timeout`）、`nbdev shot --page` |
| `cc36f626c`、`b4772ba3a` | 不带步骤截到空白页的修正：工作台页面画完后在根上标 `data-page-rendered`，加载中的区域标 `aria-busy`，`page:shot` 等这些信号；server-host Spec 补 `devTask` |
| `88ac82e68`、`cc23fbe74` | 前端实现审查的修正 |
| `67e2a0212`、`822013a2d` | 后端实现审查的修正 |

- 计划与两轮计划审查：[plan.md](plan.md)，[evidences/plan-review.txt](evidences/plan-review.txt)、[evidences/plan-review-2.txt](evidences/plan-review-2.txt)（omp）。
- 交付报告：[evidences/delivery.txt](evidences/delivery.txt)（S1 到 S3）、[evidences/blank-shot-fix.txt](evidences/blank-shot-fix.txt)。
- 主会话端到端实测（2026-10-14 18:22，用本分支的命令行）：`dev start --sample` 在 `READY` 后打 `SAMPLE …/?project=sample`，样例目录被删后按原 id 重建；带“打开第一章”步骤的 `shot --page` 截到样例与正文；不带步骤的截到整页空白，由上面的空白截图修正解决（冷、热各多次复测）。
- 实现审查（已处理）：
  - 前端 Sonnet，报告 [evidences/impl-review-ui.txt](evidences/impl-review-ui.txt)：重要 3、建议 5，全部修正（交付报告 [evidences/impl-review-ui-fix.txt](evidences/impl-review-ui-fix.txt)）：编辑器页面加载失败时撤掉加载占位；`page:shot` 停在宿主失败页默认以 2 退出（`--allow-host-failure` 才照常截）；补几处合同的测试；不等无限动画；步骤取第一个可见的匹配项。
  - 后端 omp，报告 [evidences/impl-review-server.txt](evidences/impl-review-server.txt)：重要 6，全部修正（交付报告 [evidences/impl-review-server-fix.txt](evidences/impl-review-server-fix.txt)）：取消后不再写登记表；沿用样例前校验目录；符号链接下按真实路径找样例；nbdev 逐代结算样例结果、首代截止只管首代、复用时固定 EOF 并只读尾部 4 MiB。其中“复用期间日志增长”的新测试在旧代码上也能通过，改用 strace 实测佐证（旧代码读 36.6 MB、540 ms，新代码读 3.08 MB、60 ms）。
- 范围外的改动：为让截图可靠，改了 neuro-book 的工作台、编辑器、项目三处产品代码，已记进[待确认清单](../../pending-confirmations.md)。
- 与 w00025 的分支在 `docs/specs/runtime/server-host.md` 第 160 行附近可能有相邻改动，后合入的一方处理。

- 集成分支合入 t18 后（`3ec9f45e5`）主会话跑的门禁：dev-panel、neuro-book、nb-ui 三个包 typecheck 通过；`test:affected --since master` 选中三个包：dev-panel 461 个、nb-ui 581 个、neuro-book bun 1173 个与 vitest 219 个，全部通过；dev-panel `build:web` 成功；`governance:check` 没有失败与警告（范围内）。

## 下一步

无，Task 完成。
