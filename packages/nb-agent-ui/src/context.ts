/**
 * 宿主起步用的最小 ctx。缺省值是“什么都没有”：没有会话、没有消息、没有模型与模式，`interaction` 全部为 false，宿主声明
 * 自己支持哪些操作（不声明时输入框是只读的）。字段不改成可选：视图里到处读 `ctx.x.y`，可选会把空值分支散进各组件。
 */
import type {AgentConversationContext} from "./types";

/** 下面这几个区域按字段合并，宿主只写自己有的；其余顶层字段整个替换。`composer.draft` 是整体替换。 */
type MergedSections = "availability" | "interaction" | "run" | "history" | "workspaceChanges" | "composer" | "usage" | "connection";

export type AgentContextPatch =
    & Partial<Omit<AgentConversationContext, MergedSections>>
    & {[K in MergedSections]?: Partial<AgentConversationContext[K]>};

/** 每次调用构造新的对象与数组，宿主改其中一份不会影响下一次调用。 */
export function createAgentContext(patch: AgentContextPatch = {}): AgentConversationContext {
    const {availability, interaction, run, history, workspaceChanges, composer, usage, connection, ...rest} = patch;
    return {
        session: null,
        messages: [],
        branches: {},
        editing: null,
        pendingInputs: [],
        workflows: {},
        panels: {},
        now: 0,
        extensions: {},
        ...rest,
        availability: {status: "ready", message: "", actions: [], ...availability},
        interaction: {
            canSend: false, canSteer: false, canQueue: false, canAnswer: false, canMutateHistory: false,
            canStop: false, canRegisterAttachments: false, canChangeRuntime: false, canArchive: false, canRestore: false,
            ...interaction,
        },
        run: {status: "idle", phase: "", ...run},
        history: {hasMore: false, loading: false, error: null, ...history},
        workspaceChanges: {groups: [], selectedPath: null, loading: false, error: null, ...workspaceChanges},
        composer: {
            models: [], modelKey: null, thinkingLevels: [], thinking: null, modes: [], mode: "",
            queued: [], attachments: [], recall: [], draft: {text: "", version: 0},
            ...composer,
        },
        usage: {
            contextTokens: 0, contextLimit: null, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null, cost: null,
            currency: "USD", ...usage,
        },
        connection: {status: "connected", actionRequired: false, ...connection},
    };
}
