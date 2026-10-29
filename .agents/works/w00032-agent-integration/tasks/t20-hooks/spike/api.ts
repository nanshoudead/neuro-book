/**
 * spike 第二版的公开 API：扩展与 Profile 的定义、内核事件、类型。
 *
 * 第一轮审查（Opus，2026-10-29）后改的：扩展可以有多片状态、各有作用域；扩展事件由 defineExtension
 * 生成、自动带上扩展 id 前缀；“接着做”要显式写；槽的声明与内容写在一起；每次请求现取的数据用 sample；
 * 用户输入是结构化的；类型从定义里推断，跨扩展的选择器经声明合并登记。
 */

// ---------- 内核事件 ----------

export const K = {
    sessionCreated: "session_created",
    sessionOpened: "session_opened",
    runStarted: "run_started",
    runEnded: "run_ended",
    user: "user",
    assistant: "assistant",
    toolResult: "tool_result",
    steer: "steer",
    settingsChanged: "settings_changed",
    compaction: "compaction",
    leafChanged: "leaf_changed",
    profileChanged: "profile_changed",
    modelStarted: "model_started",
    modelFailed: "model_failed",
    toolStarted: "tool_started",
    reactionLimit: "reaction_limit",
    sampleValue: "sample_value",
} as const;
export type KernelType = (typeof K)[keyof typeof K];

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}

export interface KernelData {
    session_created: {initial: unknown};
    session_opened: Record<string, never>;
    run_started: Record<string, never>;
    run_ended: {reason: "completed" | "input-rejected" | "error" | "interrupted" | "aborted"; detail?: string};
    user: {text: string; payload?: unknown; original?: string};
    assistant: {text: string; toolCalls: ToolCall[]; model: string};
    /** args：拦截改过参数时记下实际执行的参数；raw：拦截改过结果时记下工具原本的结果。 */
    tool_result: {callId: string; tool: string; text: string; isError?: boolean; args?: unknown; raw?: string};
    steer: {text: string};
    settings_changed: {patch: Record<string, unknown>};
    /** 压缩：firstKept 之前（不含）的历史换成 summary；firstKept 为 null 表示全部换掉。 */
    compaction: {method: string; summary: string; firstKept: string | null; tokensBefore: number; tokensAfter: number};
    /** 回退、切分支：只移动叶子（t03），session 作用域，重启后照它恢复当前叶子。 */
    leaf_changed: {leaf: string | null};
    /** Profile 或扩展清单变了：记下新的清单与内容哈希；各片照新清单从日志重新归约。 */
    profile_changed: {profile: string; extensions: string[]; hash: string};
    /** 发出模型请求之前写：崩溃后据此知道“请求已发出、结果未知”。 */
    /** 视图的输入（now、samples）与修改记录也记下：重启、预览过去的请求时照它重算，不取“现在”。 */
    model_started: {request: number; hash: string; now: number; samples: Record<string, Record<string, string>>; modifiedBy: {ext: string; fields: string[]}[]};
    model_failed: {request: number; message: string; partial?: string};
    /** 执行工具之前写：崩溃后据此把没有结果的调用结算为“结果未知”。 */
    tool_started: {callId: string; tool: string};
    reaction_limit: {root: string; dropped: string[]};
    /** sample 取到的值按内容寻址存一次（session 作用域）；model_started 里只放哈希。 */
    sample_value: {hash: string; value: unknown};
}

export type EntryClass = "conv" | "ctrl" | "ext";
export type Scope = "path" | "session";

export interface Entry<T extends string = string, D = unknown> {
    id: string;
    seq: number;
    /** 内核写入时的时间；反应要记时间就读它。 */
    at: number;
    parent: string | null;
    scope: Scope;
    cls: EntryClass;
    type: T;
    v?: number;
    source: string;
    /** 反应写的事件：引出它的那条事件（因果链的上一环）与它在链里的层数。 */
    cause?: string;
    depth?: number;
    /** 幂等键：同一来源同一个键只写一次（文件监听重复通知、重连后重发的外部事实）。 */
    key?: string;
    data: D;
}

/** 内核事件的类型守卫：is(e, K.user) 之后 e.data 是 {text, payload?}。 */
export function is<T extends KernelType>(e: Entry, type: T): e is Entry<T, KernelData[T]> {
    return e.type === type;
}

// ---------- 扩展自己的事件 ----------

export interface EventSpec<D> {
    cls: "conv" | "ext";
    scope: Scope;
    v: number;
    /** 只用于类型推断。 */
    _data?: D;
}
/** 对话事件：缺省投影成一条消息。 */
export const conv = <D = {text: string}>(o: {v?: number} = {}): EventSpec<D> => ({cls: "conv", scope: "path", v: o.v ?? 1});
/** 扩展事件：不进请求，只给自己归约。 */
export const ext = <D = Record<string, never>>(o: {v?: number; scope?: Scope} = {}): EventSpec<D> => ({cls: "ext", scope: o.scope ?? "path", v: o.v ?? 1});

export interface EventOut {
    cls: EntryClass;
    type: string;
    v?: number;
    scope: Scope;
    data: unknown;
    key?: string;
}

export interface EventHandle<T extends string, D> {
    type: T;
    is(e: Entry): e is Entry<T, D>;
    (data: D): EventOut;
}

type DataOf<S> = S extends EventSpec<infer D> ? D : never;
export type Handles<Id extends string, E> = {[k in keyof E & string]: EventHandle<`${Id}/${k}`, DataOf<E[k]>>};

// ---------- 状态片 ----------

export interface SliceSpec<T> {
    scope: Scope;
    initial: T;
}
export const path = <T>(initial: T): SliceSpec<T> => ({scope: "path", initial});
export const session = <T>(initial: T): SliceSpec<T> => ({scope: "session", initial});
type ValueOf<S> = S extends SliceSpec<infer T> ? T : never;
export type Mine<S> = {readonly [k in keyof S]: ValueOf<S[k]>};

// ---------- 跨扩展的选择器：插件经声明合并登记，读的一方得到类型 ----------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ExtensionExports {}
/** 只取作者写出的选择器（ExtensionSpec 上为上下文推断加的索引签名不算）。 */
export type ExportsOf<X> = X extends Extension<any, any, any, any, infer Ex> ? {[k in keyof Ex]: Ex[k] extends (...a: any[]) => infer R ? R : never} : never;

export interface Reader {
    read<Id extends keyof ExtensionExports, Sel extends keyof ExtensionExports[Id]>(extId: Id, selector: Sel): ExtensionExports[Id][Sel];
}

// ---------- 各入口的上下文 ----------

export interface Message {
    role: "user" | "assistant" | "tool";
    /** 内容是块：拼接相邻的 user 消息时块的边界与来源都留着，缓存按块比对。 */
    content: Block[];
    toolCalls?: ToolCall[];
    callId?: string;
}
export interface Block {
    text: string;
    /** 事件 id、`slot:<名字>` 或 `fixed`。 */
    origin: string;
}

export interface ModelRequest {
    model: string;
    params: {maxTokens?: number; temperature?: number};
    headers: Record<string, string>;
    system: Block[];
    messages: Message[];
    tools: string[];
}
export interface ModelResponse {
    text: string;
    toolCalls?: ToolCall[];
}
export interface ToolResult {
    text: string;
    isError?: boolean;
}
export interface UserInput {
    text: string;
    payload?: unknown;
    attachments?: {kind: "image" | "file"; uri: string}[];
}

export interface BaseCtx<S, E, Id extends string> extends Reader {
    /** 自己的全部片。 */
    mine: Mine<S>;
    /** 自己的事件构造与守卫。 */
    ev: Handles<Id, E>;
    /** 改自己的一片：生成一条内核认识的设置事件；值与反应看到的当前值相同时内核不写。 */
    set<k extends keyof S & string>(slice: k, value: ValueOf<S[k]>): EventOut;
    /** 同一个 Profile 自带的兄弟扩展的原样（只有 Profile 自带的扩展能用）。 */
    own(extId: string): any;
    /** 注入一条普通的对话消息（类型 `<id>/message`）。 */
    message(text: string): EventOut;
    settings: Record<string, any>;
    tools: string[];
    /** 内核的运行状态（只读）。 */
    run: {running: boolean};
    preview: boolean;
    /** 这次运行的中止信号；I/O 要接上它。 */
    signal: AbortSignal;
    file(path: string): string | undefined;
}

export interface ViewInput<Sm = Record<string, unknown>> extends Reader {
    /** 这次请求的时间：内核在算视图前取一次，记进请求记录。 */
    now: number;
    /** 这次请求前各扩展 sample 取到的值。 */
    sample: Sm;
    settings: Record<string, any>;
    tools: string[];
    model: {id: string; capabilities: {vision: boolean}};
}

export type Reaction = EventOut[] | {events?: EventOut[]; continue?: boolean} | void;

export interface Interceptors<C> {
    input?(input: UserInput, next: (input: UserInput) => Promise<void>, ctx: C): Promise<void | {reject: string}>;
    model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: C): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: C): Promise<ToolResult>;
    compaction?(job: CompactionJob, next: (job: CompactionJob) => Promise<CompactionResult>, ctx: C): Promise<CompactionResult>;
}

export interface CompactionJob {
    method: string;
    entries: Entry[];
    /** 给摘要的额外要求（t05、t11 的 Profile 压缩要求）。 */
    instructions: string[];
}
export interface CompactionResult {
    summary: string;
    firstKept: string | null;
}

/** sample 可能失败或超时：值是可选的，作者要处理“这次没取到”。 */
type SampleValues<Sm> = {[k in keyof Sm]?: Sm[k] extends (...a: any[]) => infer R ? Awaited<R> : never};

export interface ExtensionSpec<Id extends string, S, E, Sm, Ex> {
    id: Id;
    tags?: string[];
    replaces?: "core.history";
    /** 依赖的其它扩展：装配时按依赖排序（同一层按 id），缺失或成环直接拒绝。 */
    dependsOn?: string[];
    preview?: "run" | "skip";
    /** 片：path 跟着对话路径走，session 在树外。 */
    state?: S;
    events?: E;
    /**
     * 每片一个归约函数：看自己那片、这条事件，以及同一扩展里同一作用域的其它片（这条事件之前的值）；
     * 返回 undefined 表示不变。ctx.set 写的值内核自己处理，不必写。看不到别的作用域：path 的片若依赖
     * session 的值，回退时会用到“现在”的 session 值，归约就不确定了。
     *
     * 作用域也决定归约收到哪些事件：path 的片收 path 事件（用户消息、回复、工具结果、运行开始与结束、
     * 会话创建……）；session 的片只收 session 事件（settings_changed、leaf_changed、profile_changed 与
     * 扩展声明成 session 的事件）。session 的片若归约 path 事件，回退后再走一遍就会重复计数。要从 path 事件
     * 得到一个不随回退变的值，在反应里 ctx.set 写进 session 的片。
     */
    reduce?: {[k in keyof S]?: (state: ValueOf<S[k]>, e: Entry, ev: Handles<Id, E>, siblings: Partial<Mine<S>>) => ValueOf<S[k]> | undefined};
    exports?: Ex & {[name: string]: (mine: Mine<S>) => unknown};
    react?(e: Entry, ctx: BaseCtx<S, E, Id>): Reaction | Promise<Reaction>;
    /** 每次算视图前取一次（可以 I/O，不能有副作用），值记进请求记录；预览过去的请求用记下的值。 */
    sample?: Sm & {[name: string]: (ctx: BaseCtx<S, E, Id>) => unknown};
    /** 交给槽的内容；声明与内容写在一起。没写 volatile 的是稳定的。 */
    /** shared：有意与别的扩展共用这个槽名；不写时两个扩展撞名会写诊断。 */
    contribute?: {[slot: string]: {volatile?: boolean; shared?: boolean; value: (mine: Mine<S>, view: ViewInput<SampleValues<Sm>>) => string | null | undefined}};
    /** 自己的对话事件给模型看的样子；返回 null 不显示。 */
    render?: {[k in keyof E & string]?: (e: Entry<`${Id}/${k}`, DataOf<E[k]>>) => string | null};
    intercept?: Interceptors<BaseCtx<S, E, Id>>;
    /** 反应、拦截出错时怎么办：缺省忽略并写诊断；工具拦截出错缺省拒绝这次调用。 */
    onFailure?: {tool?: "deny" | "ignore"};
    timeoutMs?: number;
}

export interface Extension<Id extends string = string, S = any, E = any, Sm = any, Ex = any> extends ExtensionSpec<Id, S, E, Sm, Ex> {
    ev: Handles<Id, E>;
}

/** 擦掉类型参数的扩展：内核与 Profile 的列表用它（带具体类型的 Extension 都能放进来）。 */
export interface AnyExtension {
    readonly id: string;
    tags?: string[];
    replaces?: "core.history";
    dependsOn?: string[];
    preview?: "run" | "skip";
    state?: object;
    events?: object;
    reduce?: object;
    exports?: object;
    react?: (...a: any[]) => any;
    sample?: object;
    contribute?: Record<string, {volatile?: boolean; shared?: boolean; value: (...a: any[]) => string | null | undefined}>;
    render?: object;
    intercept?: {input?: (...a: any[]) => any; model?: (...a: any[]) => any; tool?: (...a: any[]) => any; compaction?: (...a: any[]) => any};
    onFailure?: {tool?: "deny" | "ignore"};
    timeoutMs?: number;
    ev: any;
}

/** 定义扩展：id 字面量、片、事件、导出都会被推断。 */
export function defineExtension<const Id extends string, S extends Record<string, SliceSpec<any>> = {}, E extends Record<string, EventSpec<any>> = {}, Sm = {}, Ex = {}>(spec: ExtensionSpec<Id, S, E, Sm, Ex>): Extension<Id, S, E, Sm, Ex> {
    return {...spec, ev: makeHandles(spec.id, spec.events ?? ({} as E))};
}

export function makeHandles<Id extends string, E>(id: Id, events: E): Handles<Id, E> {
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(events as Record<string, EventSpec<unknown>>)) {
        const type = `${id}/${k}`;
        const make = (data: unknown): EventOut => ({cls: spec.cls, type, v: spec.v, scope: spec.scope, data});
        out[k] = Object.assign(make, {type, is: (e: Entry) => e.type === type});
    }
    return out as Handles<Id, E>;
}

// ---------- Profile ----------

export type TemplateNode = {type: unknown; props: any; children: unknown[]} | unknown[];

/** Profile 自带的某个扩展的各片：own("writer") 的返回类型。 */
type OwnMine<X extends readonly AnyExtension[], Id> = Extract<X[number], {id: Id}> extends {state?: infer S} ? (S extends Record<string, SliceSpec<any>> ? Mine<S> : Record<string, never>) : never;

export interface ProfileDef<X extends readonly AnyExtension[] = readonly AnyExtension[]> {
    id: string;
    system?: string;
    tools: {required: string[]; optional?: string[]};
    globalExtensions?: {exclude: string[]} | "none";
    /** 事件给模型看的样子，对 History、Input、Transcript 一律生效；覆盖扩展给的。键拼错时装配写诊断。 */
    render?: Record<string, (e: Entry<string, any>) => string | null>;
    prompt?: (input: ViewInput & {state: Reader & {own<Id extends X[number]["id"]>(extId: Id): OwnMine<X, Id>}}) => TemplateNode;
    extensions?: X;
}
/** 定义 Profile：extensions 的类型被记住，prompt 里 state.own("<自带扩展 id>") 有类型，id 拼错是编译错误。 */
export const defineProfile = <const X extends readonly AnyExtension[] = []>(p: ProfileDef<X>): ProfileDef<X> => p;
