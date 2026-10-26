# @notnotype/nb-runtime

NeuroBook 的内核，后端与浏览器宿主共用：运行作用域与资源生命周期、服务装配、插件描述与激活、运行实例与启动门禁、诊断记录、远程服务与 RPC 协议、插件清单解析。运行时依赖只有 TypeBox。

每个机制一个入口（`@notnotype/nb-runtime/<机制>`），行为合同在 [`docs/specs/runtime/`](../../docs/specs/runtime/)：[`lifecycle`](../../docs/specs/runtime/lifecycle.md)、[`services`](../../docs/specs/runtime/services.md)、[`plugins`](../../docs/specs/runtime/plugins.md)、[`application`](../../docs/specs/runtime/application.md)、[`diagnostics`](../../docs/specs/runtime/diagnostics.md)、[`remote`](../../docs/specs/runtime/plugin-channel.md)、[`plugin-manifest`](../../docs/specs/runtime/plugin-manifest.md)。`./lifecycle/testing` 与 `./remote/testing` 是给宿主测试用的替身。

## 安装

```bash
bun add @notnotype/nb-runtime
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
