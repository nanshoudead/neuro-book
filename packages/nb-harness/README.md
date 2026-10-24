# @notnotype/nb-harness

NeuroBook 的 Agent harness：只经 Profile 运行的 Agent。按 Profile 与工具登记算出生效工具集、渲染交给模型的上下文、跑一次带工具的循环或一次不带工具的请求，交出停止原因、错误、用量与收尾工具的结果，并写进可以恢复的会话日志（`@notnotype/nb-session`）。模型目录、认证与请求经 [OMP](https://www.npmjs.com/package/@oh-my-pi/pi-ai)（`@oh-my-pi/*`）。

行为合同见 [`agent.harness`](../../docs/specs/agent/harness.md)；OMP 能力的调研见 [docs/omp-capabilities.md](docs/omp-capabilities.md)。

- `@notnotype/nb-harness`：`createHarness`、`complete`、模型目录与解析（`listCatalog`、`resolveModel`、`discoverModels`）、工具登记与内置工具、SSE 序列化、进程中断与终止信号的收口。
- `@notnotype/nb-harness/testing`：给宿主测试用的替身。

## 安装

```bash
bun add @notnotype/nb-harness
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。 OMP 的原生模块按平台安装。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
