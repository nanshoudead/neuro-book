# @notnotype/owned-process

启动一棵由 NeuroBook 拥有的进程树，宿主退出或 IPC 断开时把整棵树收掉：POSIX 上由监督进程持有独立的进程组，Windows 上在目标创建前建好 Job Object。入口是 `spawnOwnedProcess(spec)`，返回的租约管停止与结果。

现在只有旧应用在用；新应用的项目子进程由服务端自己托管（[`runtime/server-host`](../../docs/specs/runtime/server-host.md)）。不发布到 npm。测试：`bun run test`（Windows 的用例只在 Windows 上跑）。

许可证：AGPL-3.0-only，见仓库根的 [LICENSE](../../LICENSE)。
