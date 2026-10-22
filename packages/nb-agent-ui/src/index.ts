/**
 * nb-agent-ui 的核心入口：视图合同（ctx、services、action）、注册表、界面文字与宿主注入组件的形状，都是纯 TS，不依赖
 * Vue 与 DOM。行为合同是 docs/specs/ui/agent-conversation-view.md；渲染层在 `@notnotype/nb-agent-ui/vue`。
 *
 * 分轮与发送规则的纯逻辑大多只给渲染层用；这里只导出宿主单独挂轮次零件（`AgentTurnBlock`、`AgentConversationTurn`）
 * 时要的 `buildTurns`，与宿主处理 `mode.set` 时可以沿用的模式循环 `nextMode`。
 */

// 公开类型逐个列出：新增类型默认是包内的，要给宿主用时在这里加一行。
export type {
    AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AgentViewMode, AssistantMessageStatus,
    AssistantMessageView, AvailabilityStatus, AvailabilityView, BranchView, BuiltinAgentViewAction, ComposerAttachmentView,
    ComposerModelView, ComposerModeView, ComposerView, ConnectionView, ContentBlockView, EditingView, ErrorMessageView, HistoryView,
    InteractionView, JsonValue, LocalizedText, MessageView, PanelsView, PendingInputView, PendingQuestionView, PluginAgentViewAction,
    RunStatus, RunView, SessionView, SubmitDelivery, SystemMessageSource, SystemMessageView, ToolCallStatus, ToolCallView,
    ToolResultView, TriggerMenu, TriggerMenuContext, TriggerMenuItem, UsageSummaryView, UsageView, UserMessageView, ViewText,
    WorkflowView, WorkspaceChangeGroupView, WorkspaceChangesView,
} from "./types";
export type {
    MarkdownActivation, MarkdownAssetResolver, MarkdownDisplayPortProps, PromptAttachment, PromptAttachmentKind, PromptDraft,
    PromptEditorPortExpose, PromptEditorPortProps, PromptLocale, PromptMenu, PromptMenuContext, PromptMenuItem, PromptPastePolicy,
    PromptTextViewPortProps, PromptToken,
} from "./ports";
export {AgentViewRegistryConflictError, createAgentViewRegistry, GENERIC_TOOL_RENDERER, visibleEntries} from "./registry";
export type {
    AgentViewContribution, AgentViewRegistry, ComposerCommandEntry, ComposerTriggerEntry, EntryRendererEntry, ExtensionPoint,
    ExtensionPointEntries, FileChangeView, HeaderActionEntry, RegistryConflict, MessageActionEntry, MessageActionTarget, PanelEntry, RegistryEntryBase, RoleEntry,
    StatusItemEntry, ToolbarButtonEntry, ToolCategory, ToolComponentProps, ToolEffects, ToolRendererEntry, HostComponentContext, HostComponentEmits, TrayItemEntry,
} from "./registry";
export type {TaskChange, TaskItemView, TaskListView, TaskStatus} from "./task-list";
export {argArray, argNumber, argString, countLines, objectString} from "./tool-args";
export type {CodeLine} from "./tool-detail-lines";
export {formatText, textOf} from "./messages";
export type {AgentTextKey} from "./messages";
export {buildTurns} from "./conversation-turns";
export type {BuildTurnsInput, ChainBlock, ConversationTurn, TurnBlock, TurnMetrics, TurnStatus} from "./conversation-turns";
export {acceptSubmission, applyComposerAction, nextMode} from "./composer-actions";
export {createAgentContext} from "./context";
export type {AgentContextPatch} from "./context";
export {createHarnessTranscript} from "./harness";
export type {HarnessTranscript, HarnessTranscriptOptions, TranscriptProblem} from "./harness";
