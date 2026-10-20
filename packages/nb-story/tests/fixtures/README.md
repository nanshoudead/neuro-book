# nb-story 测试数据

- `sample-100ch.json.gz`：100 章样例书《转生反派萝莉，找茬魔法少女》的 V9 记忆图（含原文），即 w00005 t34 的 `evidences/run-med-100/dataset-v9.json`（分支 `feat/w00005-v6-ingest-viewer` 的 worktree 里，未入库）用 `gzip -9` 压缩。原文件 SHA-256 `7c5060d8cf711ff9f4f669e25f3d0becb635e321ec9d0a4e476a5606bde96509`，5.4 MB；压缩后约 856 KB。按开发者 2026-10-15 的决定（w00024 t03 决定 1）入库，Spec 的验收场景都用它。
- 解压样例书、建临时书库与子进程入口等测试工具在包的 `testing/` 目录。
- `ingest/`：抽取（w00024 t06）的测试数据，都来自 w00005 t34 抽样例书那一次（`evidences/run-med-100/`，未入库），只含模型输出与原文，不含请求头或密钥。
  - `run-med-100-final.json.gz`：100 章的最终草稿（各章 `draft.json`）与 20 批整理稿（`consolidation-*.json`），编译迁移对照用。
  - `replay-ch001-010.json.gz`：前 10 章各步录下的模型回复（`content`、`usage`、`finishReason`），本机端点回放用。
  - `recorded-context-ch002-010.json.gz`：第 2 到 10 章请求里实际发出的“已有记录”，核对生成的文字逐字不变。
