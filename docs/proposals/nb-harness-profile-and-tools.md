---
schema: nbook.proposal/v1
status: draft
created: 2026-10-15
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# nb-harness：Profile 定义、工具三层与一次运行的结果

## 问题

nb-story 要做内置问答（w00024 t05）：一个 Agent 用查图、搜索、读原文的工具查资料，最后调作答工具交出结构化的答案。这是 nb-harness 的第一个真实调用方。照这个场景核对现在的 nb-harness（`packages/nb-harness`，211 行的 `harness.ts`），缺的不止一处：

- **工具不由 Agent 自己决定**：`createHarness` 总会挂上以 cwd 为根的读文件、改文件两个工具；问答 Agent 不该能改文件，也读不该读的目录。插件的工具一律合进同一个列表，Profile 管不了。
- **Profile 只接了一半**：每轮渲染 Profile 后只取系统提示词，渲染出的消息被丢掉；交给模型的历史实际在 OMP Agent 的内存里，会话日志只是旁记，重启后接不上。
- **一次运行的结果说不清**：`turn()` 只返回最后一段文字。模型出错、被取消、输出被截断时，调用方拿到的是空文字或半截文字，分不清“说完了”和“失败了”；用量与费用没有交出，会话日志里也没有。
- **结构化的收尾做不到**：问答的作答工具调完就该结束，并且参数不通过校验时要退回给模型改；现在没有这种工具。
- **模型只认 OMP 内置目录**：自建的 OpenAI 兼容端点（例如 jiji）用不了；`DEEPSEEK_API_BASE` 是只对 deepseek 生效的特例。
- **前缀缓存的路由键没带上**：创建 OMP Agent 时没传会话 id，OpenAI 一类服务的 `prompt_cache_key` 一直为空。
- **没有单次请求**：只有带工具的循环，不带工具的一次调用要调用方自己绕开 harness 去用 pi-ai。

## 目标与非目标

目标：

1. Profile 是一个 Agent 的完整定义：身份、需要的工具、上下文；上下文每轮由会话日志渲染，交给模型的就是渲染结果。nb-harness 只经 Profile 运行。
2. 工具分三层：登记表（有什么）、Profile 声明（要什么）、用户配置（禁用什么）。会话开始时算出生效工具集，会话内不变。
3. 一次运行（`turn`）返回停止原因、出错信息、用量与费用；会话日志记下这些和工具的结构化结果。
4. 收尾工具：调用且通过校验时结束这次运行，参数就是结果；不通过时当普通工具出错，模型改了再交。
5. 模型可以按配置给出（服务地址、模型名、密钥环境变量名、单价），不限于 OMP 内置目录。
6. 单次请求：同样经 Profile，与 Agent 共用模型配置、停止原因与用量统计。

非目标（开发者 2026-10-15 定为后续 Task，本稿先搁置）：

- 工具发现（OMP 的 `loadMode` 与 `xd://`、Claude Code 的延迟工具）。
- 插件给所有 Profile 提供的公共工具（MCP 一类）；配置里给 Profile 追加工具；工具审批。
- 步数上限与失控保护：现在的模型很少失控，有需要再做。
- 模型角色（role）的解析：属于宿主，见[模型角色的后端契约](model-roles-contract.md)。harness 只接收解析好的模型。

## 当前行为与证据

| 位置 | 行为 |
|---|---|
| `packages/nb-harness/src/harness.ts` 的 `createHarness` | 内置 `read`、`edit` 两个工具总在工具列表里；`use()` 中途加插件会立刻改动发给模型的工具列表 |
| 同上 `turn()` | `renderProfile(...)` 只取 `systemPrompt`；返回 `{text, entries}`；`agent.prompt` 出错时不抛，错误留在最后一条消息的 `stopReason: "error"` 与 `errorMessage` 上，被忽略 |
| `src/plugins.ts` | 插件 = `{manifest, tools?, readFormats?}`；只在同一插件内查工具重名，两个插件撞名不报错 |
| `src/model.ts` | `resolveModel` 只查 OMP 内置目录；`applyBaseUrlOverride` 只认 `DEEPSEEK_API_BASE` |
| `packages/nb-profile` | Profile 模块默认导出一棵 `ProfileNode` 树；节点只管提示词与消息，没有工具声明 |
| `packages/nb-session` | 工具结果只存文字；没有用量条目 |
| OMP `pi-agent-core` 18.2.5 | 有 `afterToolCall` 钩子、`sessionId` 与 `promptCacheKey` 选项、每条模型消息带 `usage`（含 `cost`）与 `stopReason`；没有内建的“调完某个工具就结束” |
| 旧应用 `packages/neuro-book-legacy/server/agent/profiles/` | Profile 用 `defineAgentProfile({manifest, tools: toolset(builtin.web.search, …), context})` 声明工具，工具以带类型的引用写出 |

调用方：目前只有 nb-harness 自己的测试调用 `createHarness`；`packages/llmlint` 用的是已冻结的 `neuro-agent-harness`，不受影响。

## 方案

### 1. Profile 定义

Profile 模块的默认导出从一棵树改成一份定义：

```ts
export default defineProfile({
    manifest: {key: "story-qa", name: "剧情问答", description: "…"},
    tools: toolset(story.find, story.card, story.search, story.readSource, optional(story.timeline), answerTool),
    context: (ctx) => (
        <ProfilePrompt>
            <System>{rules(ctx.initial)}</System>
            <If tool="story.timeline"><System>…时间线的用法…</System></If>
            <HistorySet />
        </ProfilePrompt>
    ),
});
```

- `tools` 里每项是一个**工具引用**（提供方导出的带类型句柄，`builtin.read`、`story.search`），或者 Profile **自带的工具**（定义与实现都写在 Profile 文件里，例如问答的作答工具，只有这个 Profile 用）。默认是必需的；用 `optional(…)` 标为可选。
- `context` 每轮由会话日志渲染。渲染出的系统提示词与消息就是交给模型的全部上下文（经 OMP 的上下文变换钩子交出），不再另有一份内存里的历史。`<If tool="…">` 按生效工具集取舍段落。
- nb-harness 只经 Profile 运行，单次请求也一样（见第 5 节）。

### 2. 工具三层

1. **登记表**：内置工具与插件贡献的工具都登记在这里。工具 id 带命名空间（`builtin.read`、`story.search`），另有给模型看的名字；插件只能贡献工具（原来的 `readFormats` 改成 `read` 工具自己的构造参数）。
2. **Profile 声明**：见上一节。
3. **用户配置**：宿主传入禁用清单（全局或按 Profile）。harness 不读配置文件，只接收解析好的策略。

会话开始时算一次生效工具集：

```
Profile 必需 ∪（Profile 可选 ∩ 已登记 − 已禁用）
必需的工具没登记或被禁用 → 会话起不来，报 tool_unavailable（写明 Profile、工具、原因、该由谁提供）
两个工具给模型看的名字相同 → 报 tool_name_conflict
```

生效工具集在会话内不变，前缀缓存不会因为中途装卸插件失效。会话运行中插件被移除时，按[可扩展应用平台](extensible-application-platform.md)已定的规则：之后对它的调用得到 `plugin-unavailable` 的工具错误，运行继续。

### 3. 一次运行的结果

`turn()` 返回：

```ts
type TurnResult = {
    stopReason: "stop" | "finished" | "length" | "error" | "aborted";
    text: string;                         // 最后一段助手文字
    finish: {tool: string; args: unknown} | null;   // 收尾工具结束时
    error: {kind: "network" | "rate_limit" | "auth" | "context_overflow" | "provider"; message: string} | null;
    usage: {input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null};
    entries: SessionEntry[];
};
```

- 出错不抛异常，按 `stopReason: "error"` 返回；`error.kind` 由 OMP 的错误归类而来（网络与网关超时、限流、密钥或余额、上下文超长、其他）。启动期的合同错误（Profile 不合法、`tool_unavailable`）照旧抛出。
- 用量逐条模型消息累加；模型没有单价时 `cost` 为 `null`。
- 会话日志：每条模型消息之后记一条用量；工具结果多存结构化的 `details`（nb-session 的工具结果条目加可选字段）；出错与取消也记一条。

### 4. 收尾工具

工具定义上标 `finish: true`。模型调用它时：

- `execute` 返回成功：这次运行结束，参数（按工具的 schema 校验过）放进 `TurnResult.finish`，`stopReason` 为 `"finished"`；工具结果照常写进会话日志（保持调用与结果成对），但不再回传给模型，省掉一次只会回“已提交”的调用。
- `execute` 返回 `isError`（例如问答的作答工具发现依据晚于阅读位置）：当普通工具出错，结果回传，模型改了再交。

实现上用 `afterToolCall` 钩子判定后结束循环；要实测确认 OMP 结束后消息历史仍然成对。做不干净时退一步：成功也回传一句“已记录”，多一次很短的调用。

### 5. 单次请求

`complete({model, profile, input, signal})`：同样用 Profile 渲染系统提示词与消息，不带工具；返回与 `TurnResult` 同形的结果（没有 `finish`）。问答的全读、以后的摘要一类调用都走它。

### 6. 模型与缓存

- `defineModel({provider, baseUrl, id, api, apiKeyEnv, cost?})` 造出 OMP 的模型对象（经 `@oh-my-pi/pi-catalog` 的 `buildModel`，要实测这个子路径可用）；密钥按 `apiKeyEnv` 从环境变量读出，只交给 HTTP 客户端。`resolveModel` 查内置目录照旧保留。去掉 `DEEPSEEK_API_BASE` 特例。
- 创建 OMP Agent 时传会话 id 作 `sessionId`，OpenAI 一类服务据此带上 `prompt_cache_key`，开头相同的请求路由到同一缓存。

### 备选与取舍

- **Profile 只写工具的 schema，实现缺失时调用报错**：模型会看到一个用不了的工具反复去试，依赖它的提示词照样误导。不取。这个形态适合“实现由宿主在运行时提供”的工具（浏览器侧执行），以后需要时作为一种工具来源再加。
- **保留内置工具常驻，Profile 只能减**：问答这类封闭的 Agent 要逐个列出不要的工具，新增内置工具时还会悄悄多出来。不取：工具只来自 Profile 的声明。
- **加步数上限**：开发者定不加（见非目标）。

## 影响

- **接口**：`createHarness` 的入参从 `{node, plugins, …}` 改成 `{profile, registry, policy, model, sessionLog, …}`；`turn()` 的结果加字段；插件接口去掉 `readFormats`；nb-profile 的默认导出改成 `defineProfile`。目前只有 nb-harness 自己的测试是调用方，一并改。
- **数据**：nb-session 的工具结果条目加可选的 `details`；新增用量条目（`meta` 键 `usage`）。旧日志照常可读。
- **安全**：工具只来自 Profile 声明，默认没有读写文件的能力；密钥只从指定的环境变量读，不进会话日志。
- **依赖**：不新增依赖；OMP 版本照旧精确锁定 18.2.5。
- **回滚**：改动都在 nb-harness、nb-profile、nb-session 三个包里，整体回退即可。

## 对 Spec 的预期改动

新建 `docs/specs/agent/harness.md`（`planned`，capability `agent.harness`）：

- 输入：Profile 定义、工具登记表、禁用策略、模型、会话日志。
- 输出：生效工具集的算法；Profile 渲染结果就是模型的上下文；`TurnResult` 各字段的含义；收尾工具的两种结局；单次请求。
- 失败：`tool_unavailable`、`tool_name_conflict`、`plugin-unavailable`（工具错误）、`error.kind` 的五类。
- 验收：脚本化流（不调用模型）覆盖工具集计算、收尾工具成功与退回、出错与取消的停止原因、用量累加；真实模型两条：自定义端点的模型、收尾工具结束循环。

## 待定项

无。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-15 | 开发者 | 在 w00024 t05 讨论问答时定：nb-harness 强制使用 Profile；工具由 Profile 选；不加步数上限；加单次请求；工具发现、公共工具、配置追加工具放到后续 Task；插件只能贡献工具。 |
| 2026-10-15 | 开发者 | 草稿要点确认，三个待定项按推荐：插件接口去掉 `readFormats`（改成 `read` 工具的构造参数）；Spec 新建在 `docs/specs/agent/harness.md`；在 w00002 下新开 Task 实施，w00024 t05 等它完成再接问答。 |
