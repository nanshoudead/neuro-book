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

/**
 * 去掉值为 undefined 的键：宿主常写 `{messages: props.messages}`，上游没给时是 undefined，直接展开会盖掉缺省值，
 * 到渲染时才在 `ctx.messages.length` 上炸。
 */
function defined<T extends object>(value: T | undefined): Partial<T> {
    return value === undefined ? {} : Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

/** 每次调用构造新的对象与数组，宿主改其中一份不会影响下一次调用。补丁里值为 undefined 的字段当作没写。 */
export function createAgentContext(patch: AgentContextPatch = {}): AgentConversationContext {
    const {availability, interaction, run, history, workspaceChanges, composer, usage, connection, ...rest} = defined(patch);
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
        availability: {status: "ready", message: "", actions: [], ...defined(availability)},
        interaction: {
            canSend: false, canSteer: false, canQueue: false, canAnswer: false, canMutateHistory: false,
            canStop: false, canRegisterAttachments: false, canChangeRuntime: false, canArchive: false, canRestore: false,
            ...defined(interaction),
        },
        run: {status: "idle", phase: "", ...defined(run)},
        history: {hasMore: false, loading: false, error: null, ...defined(history)},
        workspaceChanges: {groups: [], selectedPath: null, loading: false, error: null, ...defined(workspaceChanges)},
        composer: {
            models: [], modelKey: null, thinkingLevels: [], thinking: null, modes: [], mode: "",
            queued: [], attachments: [], recall: [], draft: {text: "", version: 0},
            ...defined(composer),
        },
        usage: {
            contextTokens: 0, contextLimit: null, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null, cost: null,
            currency: "USD", ...defined(usage),
        },
        connection: {status: "connected", actionRequired: false, ...defined(connection)},
    };
}
