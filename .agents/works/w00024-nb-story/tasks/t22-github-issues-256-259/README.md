---
schema: nbook.task/v2
taskId: t22-github-issues-256-259
status: done
updated: 2026-10-27
---

# GitHub issue 256 到 259

## 目标与范围

修 GitHub 上 nb-story 的四个新 bug（#256、#257、#258、#259），行为合同改 [`story.cli`](../../../../docs/specs/story/cli-skill.md)、[`story.qa`](../../../../docs/specs/story/qa.md)、[`story.ingest`](../../../../docs/specs/story/ingest.md)。计划见 [plan.md](plan.md)。#252、#254 的 PR（#253、#255）已在 2026-10-27 审过并合入本地 master，不在本 Task。

开发者 2026-10-27 的决定：

1. #258 的输出上限默认取 OMP 的做法（见计划），不取 8192；
2. #256 不读 `~/.omp` 下任何配置：nb-story 与 omp 完全独立，只改报错与 README；
3. issue、文档、示例里不写中转站的域名与服务商名，用中性占位（清理旧写法记在 [t21](../t21-usage-feedback/README.md)）。

## 设计审查

omp 一轮，3 条（重要 3），全部成立并已改计划：共享 schema 不加 64000 上限、流结束完整性要做（在 nb-harness）、降档照 OMP 不夹到 none。报告见 [evidences/design-review.txt](evidences/design-review.txt)。

## 当前状态

2026-10-27 三个切片已实现，分支 `feat/w00024-t22-issues-256-259`（worktree `.worktree/w00024-t22`），nb-story 496 个测试通过、nb-harness 86 个通过，`docs:check` 无失败。

- #259：`nbstory --version`（`-V`，`--json`）、`config <动作> --help`、`config set ingest.model --base-url --model --api-key-env`（缺的沿用已有，价格等原样保留）。`ingest --preview` 的疑似标题提示不做（#252 已修根因）。
- #256：只改报错（说明 nbstory 只认内置目录、不读其他工具的配置）与 README，不读 omp 配置（开发者定）。
- #258：自定义模型输出上限默认 32768。与计划不同：不在 `modelOf` 里夹 64000，pi-ai 发 OpenAI 系请求前自己夹到 64000（`config test` 的测试验证了 100000 → 64000），少一处重复。流以 `[DONE]` 收尾却没有 `finish_reason`：`nb-harness` 新增 `finish-watch.ts`，会话与单次请求都记 `length`（被截断）。
- #257：`ingest/model.ts` 在 400 列出合法档位时按 OMP 的规则改发最近的启用档并重发一次，进程内记住，`config test --ingest` 写明改发了哪一档；Spec 的“不降档”因此改了，记入待确认清单。
- Spec：cli-skill.md 输出 18，qa.md（上限默认、截断、输出 23），ingest.md（输出 95 与 F4）。

实现审查（omp，[报告](evidences/impl-review.txt)）7 条：重要 5、建议 2，全部成立并已改（提交 `fix(nb-story): t22 实现审查处理`）：
- 降档的识别只认推理档（正文要写 `reasoning_effort` 或点名我们发的那一档），别的参数的 400 不重发；一次逻辑调用最多改发一次，之后仍被拒就按那条 400 失败，缓存只记成功的映射（审查实测 50 毫秒内发出 213 个请求的循环）。
- `config <动作> --help` 跳过选项和它的值再认动作（`--config init` 的 init 是文件名）。
- 已有自定义地址时，`init --model x/y`（x 不在内置目录、没给地址和密钥变量）也报“没有这个服务商”，不再悄悄记成 `custom/x/y`。
- 结束原因探针：顶层 `finish_reason`（带 usage 的末块）算有，字面量 `"null"` 与空串不算。
- `--json --version` 与 `--version --json` 一样。
- 补测试：探针单测、工具调用两轮的真 provider 场景（最后一次请求决定结果）、上面各条。

验证：nb-story 498 个测试、nb-harness 92 个通过，`docs:check` 无失败。

后续：GitHub 上 #253、#255 两个 PR 与 #252、#254、#256 到 #259 五个 issue 还是开着，关闭、评论、push 都是远端写入，等开发者授权。
