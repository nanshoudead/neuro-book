# nb-story 测试数据

- `sample-100ch.json.gz`：100 章样例书《转生反派萝莉，找茬魔法少女》的 V9 记忆图（含原文），即 w00005 t34 的 `evidences/run-med-100/dataset-v9.json`（分支 `feat/w00005-v6-ingest-viewer` 的 worktree 里，未入库）用 `gzip -9` 压缩。原文件 SHA-256 `7c5060d8cf711ff9f4f669e25f3d0becb635e321ec9d0a4e476a5606bde96509`，5.4 MB；压缩后约 856 KB。按开发者 2026-10-15 的决定（w00024 t03 决定 1）入库，Spec 的验收场景都用它。
- `sample.ts`：解压样例书、建临时书库的测试工具。
- `import-child.ts`：在子进程里导入一本书，测并发导入与中途结束进程。
