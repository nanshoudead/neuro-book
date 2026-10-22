/**
 * nb-agent-ui 的核心入口：视图合同（ctx、services、action）、注册表、界面文字与宿主注入组件的形状，都是纯 TS，不依赖
 * Vue 与 DOM。行为合同是 docs/specs/ui/agent-conversation-view.md；渲染层在 `@notnotype/nb-agent-ui/vue`。
 *
 * 分轮、过程摘要、任务清单等纯逻辑只给渲染层用，不从这里导出。
 */

export type * from "./types";
export type * from "./ports";
export {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER, visibleEntries} from "./registry";
export type * from "./registry";
export {formatText, textOf} from "./messages";
export type {AgentTextKey} from "./messages";
