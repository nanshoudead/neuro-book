# nb-story 包入口

本包位于 `packages/nb-story`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-story` 是剧情图谱：把抽好的 V9 小说记忆图收进本机书库，按“读到哪里”回答查询，提供命令行 `nbstory`、网页查看器的独立服务与给外部 Agent 的 Skill。行为合同见 [`story/queries.md`](../../docs/specs/story/queries.md)、[`story/viewer.md`](../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../docs/specs/story/cli-skill.md)；方案见 [提案](../../docs/proposals/novel-story-app.md)。

## 边界

- Owner：w00024（nb-story）。公开合同是核心库入口 `src/core/index.ts`（`.`）、查询接口合同 `src/contract/` 与 `nbstory` 的命令行合同。
- 依赖方向：只依赖 `@notnotype/nb-runtime` 的 `./remote`（合同写法）与 `@notnotype/nb-ui`（网页）；不依赖 `@notnotype/neuro-book` 与 `packages/nb-memory`，不导入根 `scripts/`。
- `src/core/` 与 `src/contract/` 只用 Node 兼容 API：以后插件在 NeuroBook 的 Node 环境里直接调用。`tsconfig.core.json` 只带 Node 类型，并把 `bun`、`bun:*` 指到空模块 `types/no-bun-in-core.d.ts`。不要在这两个目录里用 `Bun.*` 或 `bun:*`。
- 不剧透的过滤只在核心库里做：查询只经 `src/core/projection.ts` 的视图取数，不直接读索引里的数组；命令行、服务与网页不另外过滤或补数据。
- 书库的并发与原子性靠同一文件系统内的 `rename`（见 `src/core/library.ts` 模块头）；不要改成“先写目标再补”的写法。

## 测试

- 用 `bun test`；临时目录用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot`。
- 测试与被测源码同目录（`<module>.test.ts`）；测试工具与子进程入口放 `testing/`，不含断言。
- 样例书是 `tests/fixtures/sample-100ch.json.gz`（来源见同目录 README），Spec 验收里的数字都按它；`testing/sample.ts` 负责解压与建临时书库。
- 并发导入、中途结束进程、服务登记这类跨进程合同用真的子进程测。

## 完成门禁

```text
bun run --cwd packages/nb-story typecheck
bun run --cwd packages/nb-story test
```
