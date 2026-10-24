/**
 * nb-agent-ui 的核心入口：视图合同（ctx、services、action）、注册表、界面文字与宿主注入组件的形状，都是纯 TS，不依赖
 * Vue 与 DOM。行为合同是 docs/specs/ui/agent-conversation-view.md；渲染层在 `@notnotype/nb-agent-ui/vue`。
 *
 * 分轮、摘要等纯逻辑只给渲染层用，不导出；宿主起步用的 `createAgentContext`、输入框动作与 harness 适配器在这里。
 */

// 公开类型逐个列出：新增类型默认是包内的，要给宿主用时在这里加一行。
export type {
    AgentConversationContext, AgentConversationServices, AgentLocale, AgentViewAction, AgentViewMode, AssistantMessageStatus,
    AgentSessionListItem, AgentSessionListState, AssistantMessageView, AvailabilityStatus, AvailabilityView, BranchView, BuiltinAgentViewAction, ComposerAttachmentView,
    ComposerModelView, ComposerModeView, ComposerView, ConnectionView, ContentBlockView, EditingView, ErrorMessageView, HistoryView,
    InteractionView, JsonValue, LocalizedText, MessageAnnotationView, MessageView, PanelsView, PendingInputView, PendingQuestionView, PluginAgentViewAction,
    RunStatus, RunView, SessionView, SubmitDelivery, SystemMessageSource, SystemMessageView, ToolCallStatus, ToolCallView,
    ToolResultView, TriggerMenu, TriggerMenuContext, TriggerMenuItem, UsageSummaryView, UsageView, UserMessageView, ViewText,
    WorkflowView, WorkspaceChangeGroupView, WorkspaceChangesView,
} from "./types";
export type {
    MarkdownActivation, MarkdownAssetResolver, MarkdownDisplayPortProps, MarkdownPreviewPort, PromptAttachment, PromptAttachmentKind, PromptDraft,
    PromptEditorPortExpose, PromptEditorPortProps, PromptLocale, PromptMenu, PromptMenuContext, PromptMenuItem, PromptPastePolicy,
    PromptTextViewPortProps, PromptToken,
} from "./ports";
export {AgentViewRegistryConflictError, createAgentViewRegistry} from "./registry";
export type {
    AgentViewContribution, AgentViewRegistry, ComposerCommandEntry, ComposerTriggerEntry, EntryComponentProps, EntryRendererEntry, ExtensionPoint,
    ExtensionPointEntries, FileChangeView, HeaderActionEntry, RegistryConflict, MessageActionEntry, MessageActionTarget, PanelEntry, RegistryEntryBase, RoleEntry,
    StatusItemEntry, ToolbarButtonEntry, ToolCategory, ToolComponentProps, ToolEffects, ToolRendererEntry, HostComponentContext, HostComponentEmits, TrayItemEntry,
} from "./registry";
export {argArray, argNumber, argString, countLines, objectString} from "./tool-args";
export type {CodeLine} from "./tool-detail-lines";
export {formatText, textOf} from "./messages";
export {formatListTime, markdownPreviewLine} from "./format";
export type {AgentTextKey} from "./messages";
export {acceptSubmission, applyComposerAction, nextMode} from "./composer-actions";
export {createAgentContext} from "./context";
export type {AgentContextPatch} from "./context";
export {createHarnessTranscript, logSeqOf} from "./harness";
export type {HarnessTranscript, HarnessTranscriptOptions, TranscriptProblem} from "./harness";
export {catalogRef, providerSelectable} from "./model-catalog";
export type {CatalogAccess, CatalogModelView, CatalogProviderView} from "./model-catalog";
