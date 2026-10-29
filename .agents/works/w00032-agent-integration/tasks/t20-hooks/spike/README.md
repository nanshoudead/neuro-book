# 事件模型 spike

一次性原型，检验 [Agent harness 的事件模型](../../../../../../docs/proposals/agent-harness-event-model.md) 的架构、API 形状与性能。不是产品代码：模型与工具是假的，日志在内存里，不做流式、压缩方法、并行工具、插话与中止。

| 文件 | 内容 |
|---|---|
| `kernel.ts` | 内核：追加与归约、按“全部归约 → 同一份状态上全部反应 → 按扩展顺序写入”派发、一次运行、视图、请求校验、拦截链、预览、缓存比对 |
| `template.ts` | Profile 模板：经典 JSX，`<System>`、`<History>`、`<Input>`、`<Transcript>`、`<Slot>`、`<User>`、`<Tag>`、`<If>` |
| `core.ts` | 内置扩展 `core.history`（持久链表）与辅助函数 `pathState`、`sessionState`、`seed`、`reminder` |
| `examples/plugins.ts` | 全局扩展：文件变更、记忆、模式、任务、库结构、工作区焦点、时间，以及路由、用量、想绕过审批的插件 |
| `examples/profiles.tsx` | 写手、主创（旧 leader.default 的结构）、行内编辑（单轮模板）、总结者（替换 `core.history`）、写错的历史投影 |
| `check.ts` | 15 个场景检查，每个对应提案里的一条承诺 |
| `bench.ts` | 性能粗测 |

在本目录运行（`tsconfig.json` 里的 JSX 设置要在这里才生效）：

```sh
bun check.ts
bun bench.ts 1200
../../../../../../node_modules/.bin/tsc -p tsconfig.json
```
