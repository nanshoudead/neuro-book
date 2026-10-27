# nb-story 测试数据

- `sample-100ch.json.gz`：100 章样例书《转生反派萝莉，找茬魔法少女》的 V9 记忆图（含原文），即 w00005 t34 的 `evidences/run-med-100/dataset-v9.json`（分支 `feat/w00005-v6-ingest-viewer` 的 worktree 里，未入库）用 `gzip -9` 压缩。原文件 SHA-256 `7c5060d8cf711ff9f4f669e25f3d0becb635e321ec9d0a4e476a5606bde96509`，5.4 MB；压缩后约 856 KB。按开发者 2026-10-15 的决定（w00024 t03 决定 1）入库，Spec 的验收场景都用它。
- 解压样例书、建临时书库与子进程入口等测试工具在包的 `testing/` 目录。
- `ingest/`：抽取（w00024 t06）的测试数据，都来自 w00005 t34 抽样例书那一次（`evidences/run-med-100/`，未入库），只含模型输出与原文，不含请求头或密钥。
  - `run-med-100-final.json.gz`：100 章的最终草稿（各章 `draft.json`）与 20 批整理稿（`consolidation-*.json`），编译迁移对照用。
  - `replay-ch001-010.json.gz`：前 10 章各步录下的模型回复（`content`、`usage`、`finishReason`），本机端点回放用。
  - `replay-ch099-100.json.gz`：第 99、100 章各步录下的模型回复（来自 `ch099/`、`ch100/` 的 `*.response.json`，格式同上），服务响应的验收只回放这两章。
  - `prefix-098-fixes.json.gz`：前 98 章最终草稿按新管线的兜底逐章处理后有改动的 62 章（程序生成，`testing/build-prefix-fixes.ts`），`testing/ingest-state.ts` 用它造“前 98 章已提交”的书。t34 的旧管线不要求提交时全书没有错误，原样提交过不了新管线的检查。改了编译或兜底规则后要重新生成。
  - `recorded-context-ch002-010.json.gz`：第 2 到 10 章请求里实际发出的“已有记录”，核对生成的文字逐字不变。
  - `recorded-requests-ch001-010.json.gz`：前 10 章每一步请求的摘要（系统提示词加用户消息的 SHA-256，另一份把核对清单里的校验说明换成固定文字后的摘要）与推理档，核对回放时发出的请求逐字不变。
  - `requests-t10.json`：不同于上面几份，它不是 t34 录下的：是 w00024 t10 合入时的代码回放前 10 章（`replay-ch001-010`）与挑选开着抽第 10 章（`recall-ch010`）实际发出的每个请求的 SHA-256（系统提示词加用户消息，原样，不换回全量已有记录），由 `chapter.test.ts` 的同一段回放算出。t11 起两项开关都开时，请求必须与它逐字相同；有意改动请求文字时要重新生成。w00024 t20 收紧规则里 `identity` 的写法后重新生成过一次（只有系统提示词变）；对照 t34 的 `recorded-requests` 时，`chapter.test.ts` 先把这两处文字换回当时的写法，其余部分仍须逐字相同。
  - `requests-t12.json`：w00024 t12 的增量整理：前 10 章回放（`replay-ch001-010`）强制走增量（`fullLimit: 0`，第 10 章的整理换成 `chapter.test.ts` 里手写的增量回复）时两次整理请求的 SHA-256，算法同 `requests-t10.json`。普通章与全量整理的请求仍对照 `requests-t10.json`；有意改动增量整理请求的文字时重新生成这一份。
  - `compile-t11.json`：t12 开工前（`1d4ad1ffa`）的编译程序把 `run-med-100-final` 的草稿与 20 批整批整理稿编到第 5、10、…、100 章，每个前缀的 SHA-256（去掉归纳的 `entity` 后）与最终那份归纳的 `entity` 列表，由 t12 Task 目录下的 `scripts/compile-baseline.ts` 生成。`compile.test.ts` 用它证明旧整理稿编出的书不变（只有被合并掉的对象名下的归纳改记到合并后的对象）。
