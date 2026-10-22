---
schema: nbook.task/v2
taskId: t12-shared-boundary-plural
status: active
updated: 2026-10-22
---

# 共用的导入边界检查、nb-form 进 CI 选包矩阵、英文单复数

## 目标与范围

t10 审查引出的三条后续：导入边界扫描收进 neuro-book-test-support 由 nb-form 与 nb-agent-ui 共用（修掉 branch-from 误报与夹注释的导入漏报）；nb-form 登记进 workspace-packages 选包矩阵；nb-agent-ui 的英文文字用 Intl.PluralRules 区分单复数

合同：行为合同未变。英文界面文字的措辞属于 nb-agent-ui 的文字表；导入边界与 CI 选包是仓库工具。来源：t10 实现审查（[前端报告](../t10-migrate-nb-agent-ui/evidences/impl-review-sonnet.txt)第 14 条、[核心报告](../t10-migrate-nb-agent-ui/evidences/impl-review-omp.txt)第 9 条）与 t10 交付时的建议；开发者 2026-10-22 同意按推荐做法做。

## 当前状态（2026-10-22）：已提交，待随 w00019 分支合入

在 Work 分支 `feat/w00019-nb-agent-ui` 上提交 `7c4ba0a69`：

- **共用的导入边界检查**：`packages/neuro-book-test-support/src/import-boundary.ts`（导出 `./import-boundary`），nb-form 与 nb-agent-ui 的 `boundary.test.ts` 只写各自的规则。扫描的取舍写在模块头：先去掉块注释与整行注释，`from` 前面是连字符或点时不算导入。nb-form 因此一并修掉了这两处缺口。扫描写法的测试移到 test-support 的 `tests/import-boundary.test.ts`。
- **nb-form 进 CI 选包矩阵**：`scripts/ci/workspace-package-matrix.ts` 加一行，`workspace-packages.yml` 的 paths 加一行。只改 nb-form 时选出 nb-form 与依赖它的 neuro-book。
- **英文单复数**：nb-agent-ui 英文表里带数量的 11 条分单数、复数两种写法，按 `Intl.PluralRules` 选；读改合成的那句按“读了几个”选。中文表不变。

验证：
- **通过**：nb-form `typecheck`、`test`（bun 95、Vitest 80）；nb-agent-ui `typecheck`、`test`（bun 58、Vitest 54）；`scripts/ci` 的 workflow 测试；选包脚本对 nb-form 的改动选出预期的两个包。
- **原有问题**：test-support 自己的 `test` 有 1 条失败（`tests/paths.test.ts`“拒绝不安全的 run/task 段与超长结果”），master 上同样失败，与本 Task 无关，未处理。

## 下一步

随 w00019 分支合入；test-support 的 `paths.test.ts` 原有失败另报开发者。
