# @notnotype/dev-panel

开发工具，不是 NeuroBook 的产品功能：命令行 `nbdev` 与开发者项目面板，给在这个仓库里工作的人与开发 Agent 用。管 Work 与 Task 记录、开发服务（`nbdev dev start`）、截图（`nbdev shot`）、评审板与答复（`nbdev artifact publish`、`nbdev answers`），面板在浏览器里汇总这些。不发布到 npm，只支持 Linux。

- 命令行用法：[`docs/cli.md`](docs/cli.md)；面板服务：[`docs/panel.md`](docs/panel.md)；方案与取舍：[提案](../../docs/proposals/dev-panel.md)；术语与不变量：[`CONTEXT.md`](CONTEXT.md)。
- 在仓库里运行：`bun packages/dev-panel/src/cli.ts <命令>`，或者把 `nbdev` 链到 PATH 上。
- 改本包之前读 [`AGENTS.md`](AGENTS.md)：依赖方向、核心库只用 Node 兼容 API 的约束与记录锁。

许可证：AGPL-3.0-only，见仓库根的 [LICENSE](../../LICENSE)。
