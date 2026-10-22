/**
 * nb-agent-ui 的 Vue 渲染层入口。这里导出的组件是受管组件，同名 `.md` 必有（`docs:check`）。
 *
 * 宿主通常只挂 `AgentConversationView`；单独挂零件时先用 `provideAgentView` 交出语言与渲染组件。
 */

export {default as AgentConversationView} from "./AgentConversationView.vue";
export {default as AgentConversationComposer} from "./composer/AgentConversationComposer.vue";
export {default as AgentModelPicker} from "./composer/AgentModelPicker.vue";
export {default as AgentQueuedMessages} from "./composer/AgentQueuedMessages.vue";
export {default as AgentMarkdown} from "./parts/AgentMarkdown.vue";
export {default as OriginalImagePreviewDialog} from "./parts/OriginalImagePreviewDialog.vue";
export {default as AgentChainSummary} from "./stream/AgentChainSummary.vue";
export {default as AgentConversationTurn} from "./stream/AgentConversationTurn.vue";
export {default as AgentDeliveryNotice} from "./stream/AgentDeliveryNotice.vue";
export {default as AgentFileChanges} from "./stream/AgentFileChanges.vue";
export {default as AgentMessageActions} from "./stream/AgentMessageActions.vue";
export {default as AgentRawView} from "./stream/AgentRawView.vue";
export {default as AgentTurnBlock} from "./stream/AgentTurnBlock.vue";
export {default as AgentUserContent} from "./stream/AgentUserContent.vue";
export {default as AgentCommandDetail} from "./tools/AgentCommandDetail.vue";
export {default as AgentFileContentDetail} from "./tools/AgentFileContentDetail.vue";
export {default as AgentFileDiffDetail} from "./tools/AgentFileDiffDetail.vue";
export {default as AgentTaskList} from "./tools/AgentTaskList.vue";
export {default as AgentTaskListNode} from "./tools/AgentTaskListNode.vue";
export {default as AgentToolDetail} from "./tools/AgentToolDetail.vue";
export {default as PlainMarkdown} from "./fallback/PlainMarkdown.vue";
export {default as PlainPromptEditor} from "./fallback/PlainPromptEditor.vue";
export {default as PlainPromptTextView} from "./fallback/PlainPromptTextView.vue";

export {provideAgentView, useAgentRenderers, useAgentText} from "./host";
export type {AgentTextApi, AgentViewRenderers, ResolvedRenderers} from "./host";
export {builtinComposerContribution} from "./builtin-composer";
export {builtinMessageActionsContribution} from "./builtin-message-actions";
export {builtinRolesContribution} from "./builtin-roles";
export {builtinToolsContribution} from "./builtin-tools";
