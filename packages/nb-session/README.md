# @notnotype/nb-session

Agent 的会话日志：只追加的条目（消息、工具调用与结果、用量、元数据、快照、压缩）与两种存放：JSONL 文件（`createJsonlSessionLog`）与内存（`createMemorySessionLog`）。`@notnotype/nb-harness` 写它，也从它恢复会话。

行为合同见 [`agent.harness`](../../docs/specs/agent/harness.md)。

## 安装

```bash
bun add @notnotype/nb-session
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
