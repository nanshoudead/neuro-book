# nb-form 包入口

本包位于 `packages/nb-form`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-form` 按数据 schema 画表单，行为合同是 [`ui.forms`](../../docs/specs/ui/forms.md)。设置、nbdev 的提问、Agent 的提问与审批、命令参数都用它。

## 边界

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）只依赖 `typebox`：不依赖 Vue、DOM、应用包与宿主的服务。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 渲染层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`@notnotype/nb-ui` 与核心，以便以后打进生成式视图的沙箱。
- 表单不持有数据：值、问题、选项与带外状态都由调用方给出；核心不调用调用方的函数。
- 描述可能来自模型：处理描述的函数（`checkDescription`、`resolveForm`、`validateForm`）不因描述写坏而抛异常。

## 验证

```text
bun run typecheck
bun run test
```
