---
schema: nbook.task/v2
taskId: t20-ingest-pipeline-fixes
status: done
updated: 2026-10-27
---

# 抽取管线七点修复

## 目标与范围

按 t19 西游记抽取暴露的七个问题修管线：限流退避、用量补记、坏回复留存、自动续跑、密钥来源、价格提示、人物合并

合同：改 [`story.ingest`](../../../../docs/specs/story/ingest.md) 与 [`story.cli`](../../../../docs/specs/story/cli-skill.md)，并加 ADR 0032。计划见 [plan.md](plan.md)。

## 当前状态

2026-10-25 到 26 实施完成并合入 master（ec05f5145），分支 `feat/w00024-t20-ingest-fixes`（worktree `.worktree/w00024-t20`），七点里六点已做完、第 7 点的提示词层等开发者批准真实模型验证。

- 设计审查（omp，[报告](evidences/design-review.txt)）9 条全部成立，计划已改（章内重做、启动环境口径、坏回复留存不挂提交）。
- 实现审查（omp，[报告](evidences/impl-review.txt)）8 条：2 阻断、6 重要。处理：
  - 成立并已改：提交前整本检查的错误不再重做（可能来自已提交旧章，重做无用）；`config test`（命令行与网页）补上启动环境门；服务的 `env` 选项与目录服务商状态统一；空白密钥的判断统一成 `envHas`；坏回复清理失败不影响已发布文件。
  - 不成立：“差异删除任务外资料与本任务 ADR/Spec”——审查者拿 `master..HEAD` 比，master 在这期间新增了 w00027 与本任务的文档，分支上没有删除；以分支点 `8ba5c56b3` 为基准是 676 增、69 删。
  - 不成立：“删书后同 id 重建的 ABA 写回”——持锁期间删除由本进程协调者先停任务再删、别的进程得到 `ingest_running`；`finish` 里状态与活动记录先写完才放锁，重做没有新增放锁的空档。
  - 接受取舍：命令行级的“重做成功/用完/等待中 Ctrl-C”没有真进程测试，因为等待时间只能经 `StartInput.timing` 缩短（产品不开环境变量入口）；这些在 `runner.test.ts` 里用真 Worker、真书库、本机端点验收，命令行只测 `--auto-resume` 的用法与 0 次。
- 验证：nb-story 480 个测试通过（含 `bun run test:affected`）；`docs:check` 无失败。包的 `bun run typecheck` 在 worktree 里停在 `e2e/viewer.e2e.ts` 的 `NodeListOf` 迭代器类型错误：本任务没有改这个文件，主工作区同一条命令没有这个错误，是 worktree 里 TypeScript 解析的差异（worktree 没有自己的根 `node_modules`），前四段类型检查都通过。
- 七点对照：1 密钥口径（ADR 0032，`startup-env`）、2 坏回复留存（`bad-replies/`）、3 章内重做与 `--auto-resume`、4 限流退避与 `Retry-After`、5 失败请求用量（明确拒绝记完整的 0）、6 价格提示、7 人物合并（编译校验丢 task 类 identity、点的代表取出现最多的人物）。
- 第 7 点离线重编译 t19 的 `extraction-100.json`：新增 2 个错误，正是 `s9-38` 与 `s70-2`；`s9-16`（法明和尚剃度）与 `s72-5` 是模型把事件标成 identity，只能靠提示词收紧，要真实模型验证。
- 第 7 点提示词层（2026-10-27 开发者批准）：`rules.md` 里 `identity` 收紧为“同一个个体才写；不能连到任务或物件；取名、师徒、同行、猜测写别的大类”，提交 `0e004a653`。西游记前 12 回重抽后 `s9-16`、`s9-38` 类误标消失，法明与玄奘仍是两个对象；验收 11 三次合计 396（门槛 360），详见 [证据](evidences/regress-20/README.md)。请求摘要的测试数据（`requests-t10`、`requests-t12`）因系统提示词有意改动重新生成了。
- 后续：新稿里有一条自指的 identity 说法（两端同一个对象）没有被校验挡住，可顺手加一条编译校验。
