/**
 * nb-agent-ui 的核心入口：视图合同（ctx、services、action）、注册表、界面文字与宿主注入组件的形状，都是纯 TS，不依赖
 * Vue 与 DOM。行为合同是 docs/specs/ui/agent-conversation-view.md；渲染层在 `@notnotype/nb-agent-ui/vue`。
 *
 * 分轮与发送规则的纯逻辑大多只给渲染层用；这里只导出宿主单独挂轮次零件（`AgentTurnBlock`、`AgentConversationTurn`）
 * 时要的 `buildTurns`，与宿主处理 `mode.set` 时可以沿用的模式循环 `nextMode`。
 */

export type * from "./types";
export type * from "./ports";
export {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER, visibleEntries} from "./registry";
export type * from "./registry";
export {formatText, textOf} from "./messages";
export type {AgentTextKey} from "./messages";
export {buildTurns} from "./conversation-turns";
export type {BuildTurnsInput, ChainBlock, ConversationTurn, TurnBlock, TurnMetrics, TurnStatus} from "./conversation-turns";
export {nextMode} from "./composer-actions";
