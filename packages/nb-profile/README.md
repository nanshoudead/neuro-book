# @notnotype/nb-profile

Agent Profile 的定义、加载与 JSX 渲染：用 JSX 写系统提示词、历史与提醒，用 `defineProfile` 声明工具与初始参数，渲染成交给模型的消息。由 `@notnotype/nb-harness` 使用。

行为合同见 [`agent.harness`](../../docs/specs/agent/harness.md)。

- `@notnotype/nb-profile`：`defineProfile`、`toolset`、`toolRef`、节点（`System`、`HistorySet`、`Reminder` 等）、`renderProfile`、`loadProfile`。
- `@notnotype/nb-profile/jsx-runtime`、`./jsx-dev-runtime`：JSX 运行时。Profile 文件开头写 `/** @jsxImportSource @notnotype/nb-profile */`，不依赖调用方的 tsconfig。

## 安装

```bash
bun add @notnotype/nb-profile
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
