---
schema: nbook.task/v2
taskId: t16-cli-papercuts
status: active
updated: 2026-10-14
---

# nbdev 命令行修补：产物只提交引用到的文件等六条

## 目标与范围

处理[后续清单](../../followups.md)“试用建议”里第一档的六条（开发者 2026-10-14 定，按 autonomous-delivery 推进）：

1. `artifact publish` 只提交页面引用到的文件，其余的列出来提醒；
2. 提问标记不合规时，普通输出也逐条列出；
3. `answers --wait` 接 SIGHUP；
4. `nbdev shot` 在 Lab 里找不到组件时立即失败；
5. `task new`、`work new` 加 `--no-lease`；
6. 写命令只报与本次领号有关的撞号。

合同：包内的 [命令行合同](../../../../../packages/dev-panel/docs/cli.md) 与 [文件格式](../../../../../packages/dev-panel/docs/file-formats.md)，另有 `docs/specs/ui/component-lab.md` 场景 14 加一句。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-14 实施完成，在集成分支 `feat/w00022-dev-panel` 上，未合入 `master`：

| 片 | 提交 | 内容 |
|---|---|---|
| S1 | `7d0307e55` | `artifact publish` 只提交从入口、已跟踪文件、上一版的 `files` 与题所在页面、`--include` 出发引用得到的文件，其余给 `unreferenced_files_not_committed`；发布记录加 `files`；`srcset`、`<script src>`、CSS 与脚本 import 的引用收集 |
| S2 | `dd8aeac70` | 普通输出逐条列出 `invalid_questions` 等明细；`answers --wait` 接 SIGHUP |
| S3 | `569ac99e6` | `work new`、`task new` 只报涉及这次领号的撞号（另给 `otherConflicts`），加 `--no-lease` |
| S4 | `4a7eab593` | `lab:shot` 的组件或场景不在 Lab 清单里时立即失败，提示重启开发服务 |

- 计划与计划审查：[plan.md](plan.md)，omp 审查 [evidences/plan-review.txt](evidences/plan-review.txt)（阻断 0、重要 5、建议 1，全部改进计划）。
- 交付报告：[evidences/delivery.txt](evidences/delivery.txt)，其中 9 处与计划的偏离都有理由，主会话核对后接受。
- 主会话自跑：dev-panel typecheck 通过、全量 438 个通过、`build:web` 成功；S4 在真实开发服务上验证，见 [evidences/s4-live-check.txt](evidences/s4-live-check.txt)。
- 实现审查待处理（omp，不阻塞下一个 Task）。

## 下一步

处理实现审查；合入 `master` 要开发者授权，合入后重启面板 4400。
