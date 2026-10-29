/**
 * 一次性 spike：按提案 docs/proposals/agent-harness-event-model.md 写的最小内核，只用来检验架构与 API 形状，
 * 不是产品代码。模型与工具是假的；日志在内存里；不做流式、压缩方法、并行工具、插话与中止。
 *
 * 读法：Session 是内核。append 只追加事件并算出新状态；dispatch 按“全部归约 → 同一份状态上全部反应 →
 * 按扩展顺序写入”的规则推进；send 是一次运行；buildRequest 是视图（core.history 投影 + contribute + 模板）。
 */

import {renderTemplate, defaultLayout, type TemplateNode} from "./template.ts";

export type EntryClass = "conv" | "ctrl" | "ext";
export type Scope = "path" | "session";

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}

export interface Entry {
    id: string;
    seq: number;
    /** path 作用域的父节点；session 作用域与根为 null。 */
    parent: string | null;
    scope: Scope;
    cls: EntryClass;
    type: string;
    v?: number;
    source: string;
    data: any;
}

export interface EventInput {
    cls: EntryClass;
    type: string;
    v?: number;
    data?: any;
    scope?: Scope;
}

export interface Slice<S> {
    initial: S;
    scope?: Scope;
    reduce(state: S, entry: Entry): S;
    exports?: Record<string, (state: S) => unknown>;
}

export interface Message {
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCall[];
    callId?: string;
    /** 这条消息从哪来：事件 id、`slot:<名字>` 或 `fixed`；缓存诊断用它指出是模板里哪里变了。 */
    origin: string;
}

export interface ModelRequest {
    model: string;
    params: {maxTokens?: number; temperature?: number};
    headers: Record<string, string>;
    system: string;
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

export interface ReadCtx {
    /** 自己那一片（按作用域取 path 或 session 的值）。 */
    mine: any;
    /** 读别的扩展导出的选择器；读不到原样。 */
    read(extId: string, selector: string): unknown;
    settings: Record<string, any>;
    tools: string[];
    preview: boolean;
    /** 这次请求的时间：内核在算视图前取一次，记进请求记录；预览过去的请求时用记下的值（待定项 9）。 */
    now: number;
    /** 读“项目文件”。spike 里是一张内存表；产品里是 t08 的地址。 */
    file(path: string): string | undefined;
}

export type RenderFn = (entry: Entry) => string | null;

export interface Interceptors {
    input?(input: string, next: (input: string) => Promise<void>, ctx: ReadCtx): Promise<void>;
    model?(request: ModelRequest, next: (request: ModelRequest) => Promise<ModelResponse>, ctx: ReadCtx): Promise<ModelResponse>;
    tool?(call: ToolCall, next: (call: ToolCall) => Promise<ToolResult>, ctx: ReadCtx): Promise<ToolResult>;
}

export interface Parts {
    state?: Slice<any>;
    react?(entry: Entry, ctx: ReadCtx): EventInput[] | void | Promise<EventInput[] | void>;
    contribute?(mine: any, ctx: ReadCtx): Record<string, string | null | undefined>;
    render?: Record<string, RenderFn>;
    intercept?: Interceptors;
}

export interface ExtensionDef {
    id: string;
    tags?: string[];
    replaces?: "core.history";
    slots?: Record<string, {volatile?: boolean}>;
    preview?: "run" | "skip";
    setup(): Parts;
}

export interface ViewInput {
    /** Profile 读状态：自己扩展的片可读原样（不给选择器名），别的扩展只能经选择器。 */
    state: {read(extId: string, selector?: string): any};
    settings: Record<string, any>;
    tools: string[];
    model: {id: string; capabilities: {vision: boolean}};
}

export interface ProfileDef {
    id: string;
    system?: string;
    tools: {required: string[]; optional?: string[]};
    globalExtensions?: {exclude: string[]} | "none";
    /** 事件怎么渲染给模型，对 History、Input、Transcript 一律生效；覆盖扩展给的缺省渲染。 */
    render?: Record<string, RenderFn>;
    prompt?: (input: ViewInput) => TemplateNode;
    extensions?: ExtensionDef[];
}

export interface RecordedRequest {
    leaf: string;
    now: number;
    request: ModelRequest;
    modifiedBy: {ext: string; fields: string[]}[];
    tokens: number;
    /** 与上一次请求相同的前缀有多少 token。 */
    prefixTokens: number;
    /** 上一次请求里不在这次前缀里、要重新计算的 token。 */
    recomputedTokens: number;
    firstDiff: string | null;
}

interface Loaded {
    def: ExtensionDef;
    parts: Parts;
    own: boolean;
}

type Snap = Record<string, unknown>;

const WRITE_TOOLS = new Set(["write", "edit"]);
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
export const REACT_DEPTH_LIMIT = 3;
export const CONTINUE_LIMIT = 3;

/** 粗估 token：中文约 1.5 字一个，英文约 4 字一个；只用来比较，不当计费。 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 2);
}

export function messageText(m: Message): string {
    return `${m.role}|${m.callId ?? ""}|${m.content}|${m.toolCalls ? JSON.stringify(m.toolCalls) : ""}`;
}

export class ProtocolError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
    }
}

export interface SessionOptions {
    profile: ProfileDef;
    plugins?: ExtensionDef[];
    core?: ExtensionDef[];
    model: (request: ModelRequest) => Promise<ModelResponse> | ModelResponse;
    tools?: Record<string, (args: any, files: Map<string, string>) => ToolResult>;
    files?: Record<string, string>;
    settings?: Record<string, any>;
    readOnly?: boolean;
    /** 每条事件都存一份状态快照（缺省），或者只在叶子上保留状态，回退时从根重算。 */
    snapshots?: "all" | "none";
    /** 超过多少“重算的旧内容”给诊断。 */
    cacheWarnTokens?: number;
    /** 时钟；缺省 Date.now。 */
    clock?: () => number;
}

export class Session {
    readonly entries: Entry[] = [];
    readonly byId = new Map<string, Entry>();
    leaf: string | null = null;
    readonly requests: RecordedRequest[] = [];
    readonly diagnostics: string[] = [];
    readonly files: Map<string, string>;
    readonly exts: Loaded[] = [];
    running = false;

    private seq = 0;
    private readonly snaps = new Map<string, Snap>();
    private leafSnap: Snap;
    private sessionSnap: Snap;
    private readonly opts: SessionOptions;
    private readonly historyExt: Loaded;

    constructor(opts: SessionOptions) {
        this.opts = opts;
        this.files = new Map(Object.entries(opts.files ?? {}));
        const own = opts.profile.extensions ?? [];
        const replaced = new Set(own.map((e) => e.replaces).filter(Boolean) as string[]);
        for (const p of opts.plugins ?? []) {
            if (p.replaces) throw new Error(`插件 ${p.id} 不能替换内置扩展，只有 Profile 自带的扩展能用 replaces`);
        }
        const g = opts.profile.globalExtensions;
        const plugins = g === "none" ? [] : (opts.plugins ?? []).filter((p) => !(g?.exclude ?? []).some((t) => p.tags?.includes(t)));
        // 顺序：内置（没被替换的）→ 插件 → Profile 自带；反应追加的事件、contribute 的拼接、拦截链（外到里）都按这个顺序
        const ordered: [ExtensionDef, boolean][] = [
            ...(opts.core ?? []).filter((c) => !replaced.has(c.id)).map((c) => [c, false] as [ExtensionDef, boolean]),
            ...plugins.map((p) => [p, false] as [ExtensionDef, boolean]),
            ...own.map((o) => [o, true] as [ExtensionDef, boolean]),
        ];
        for (const [def, isOwn] of ordered) this.exts.push({def, parts: def.setup(), own: isOwn});
        const history = this.exts.find((e) => e.def.id === "core.history" || e.def.replaces === "core.history");
        if (!history) throw new Error("没有历史投影：core.history 或替换它的扩展");
        this.historyExt = history;
        this.leafSnap = this.initialSnap("path");
        this.sessionSnap = this.initialSnap("session");
    }

    // ---------- 状态 ----------

    private initialSnap(scope: Scope): Snap {
        const s: Snap = {};
        for (const x of this.exts) if (x.parts.state && (x.parts.state.scope ?? "path") === scope) s[x.def.id] = x.parts.state.initial;
        return s;
    }

    private reduceInto(snap: Snap, entry: Entry, scope: Scope): Snap {
        const next: Snap = {...snap};
        for (const x of this.exts) {
            const sl = x.parts.state;
            if (sl && (sl.scope ?? "path") === scope) next[x.def.id] = sl.reduce(snap[x.def.id], entry);
        }
        return next;
    }

    pathTo(id: string | null): Entry[] {
        const out: Entry[] = [];
        for (let e = id ? this.byId.get(id) : undefined; e; e = e.parent ? this.byId.get(e.parent) : undefined) out.push(e);
        return out.reverse();
    }

    /** 某条事件之后的 path 状态。有快照就直接用，没有就往上找最近的快照再归约下来。 */
    stateAt(id: string | null): Snap {
        if (id === null) return this.initialSnap("path");
        if (id === this.leaf) return this.leafSnap;
        const cached = this.snaps.get(id);
        if (cached) return cached;
        const chain: Entry[] = [];
        let base: Snap | undefined;
        for (let e = this.byId.get(id); e; e = e.parent ? this.byId.get(e.parent) : undefined) {
            const s = this.snaps.get(e.id);
            if (s) {
                base = s;
                break;
            }
            chain.push(e);
        }
        let snap = base ?? this.initialSnap("path");
        for (const e of chain.reverse()) snap = this.reduceInto(snap, e, "path");
        return snap;
    }

    private append(input: EventInput, source: string): Entry {
        const scope = input.scope ?? "path";
        const e: Entry = {
            id: `e${++this.seq}`,
            seq: this.seq,
            parent: scope === "path" ? this.leaf : null,
            scope,
            cls: input.cls,
            type: input.type,
            ...(input.v === undefined ? {} : {v: input.v}),
            source,
            data: input.data ?? {},
        };
        this.entries.push(e);
        this.byId.set(e.id, e);
        if (scope === "path") {
            this.leafSnap = this.reduceInto(this.leafSnap, e, "path");
            this.leaf = e.id;
            if (this.opts.snapshots !== "none") this.snaps.set(e.id, this.leafSnap);
        } else {
            this.sessionSnap = this.reduceInto(this.sessionSnap, e, "session");
            if (e.type === "settings_changed") this.settingsCache = {...this.settings, ...e.data.patch};
        }
        return e;
    }

    /** 打开已有会话：照日志归约出状态，不跑反应（反应的结果本来就在日志里）。最后的叶子取最后一条 path 事件。 */
    load(entries: Entry[]): void {
        for (const e of entries) {
            this.entries.push(e);
            this.byId.set(e.id, e);
            this.seq = Math.max(this.seq, e.seq);
            if (e.scope === "path") {
                this.leafSnap = this.reduceInto(e.parent === this.leaf ? this.leafSnap : this.stateAt(e.parent), e, "path");
                this.leaf = e.id;
                if (this.opts.snapshots !== "none") this.snaps.set(e.id, this.leafSnap);
            } else {
                this.sessionSnap = this.reduceInto(this.sessionSnap, e, "session");
                if (e.type === "settings_changed") this.settingsCache = {...this.settings, ...e.data.patch};
            }
        }
    }

    /** 回退或切分支：只换叶子；状态由 stateAt 重新得到。运行中不能改树（t07）。 */
    rewind(id: string | null): void {
        if (this.running) throw new Error("运行中不能回退");
        this.leafSnap = this.stateAt(id);
        this.leaf = id;
    }

    // 会话设置在树外：内核从 session 作用域的 settings_changed 归约（在 append 里增量更新）
    private settingsCache: Record<string, any> | undefined;
    get settings(): Record<string, any> {
        return (this.settingsCache ??= {...(this.opts.settings ?? {})});
    }

    get tools(): string[] {
        return [...this.opts.profile.tools.required, ...(this.opts.profile.tools.optional ?? [])].filter((t) => t in (this.opts.tools ?? {}) || this.opts.profile.tools.required.includes(t));
    }

    private now = 0;

    private ctxFor(x: Loaded, snap: Snap, preview = false): ReadCtx {
        const scope = x.parts.state?.scope ?? "path";
        return {
            mine: x.parts.state ? (scope === "session" ? this.sessionSnap : snap)[x.def.id] : undefined,
            read: (extId, selector) => this.select(snap, extId, selector),
            settings: this.settings,
            tools: this.tools,
            preview,
            now: this.now,
            file: (p) => this.files.get(p),
        };
    }

    private select(snap: Snap, extId: string, selector: string): unknown {
        const x = this.exts.find((e) => e.def.id === extId);
        const fn = x?.parts.state?.exports?.[selector];
        if (!x || !fn) throw new Error(`${extId} 没有导出 ${selector}`);
        const scope = x.parts.state!.scope ?? "path";
        return fn((scope === "session" ? this.sessionSnap : snap)[extId]);
    }

    /** Profile 的 prompt 读状态：自己扩展的片读原样，别人的只能经选择器。 */
    private viewState(snap: Snap) {
        return {
            read: (extId: string, selector?: string) => {
                if (selector) return this.select(snap, extId, selector);
                const x = this.exts.find((e) => e.def.id === extId);
                if (!x?.own) throw new Error(`${extId} 的状态是私有的，请用它导出的选择器`);
                const scope = x.parts.state?.scope ?? "path";
                return (scope === "session" ? this.sessionSnap : snap)[extId];
            },
        };
    }

    // ---------- 事件派发 ----------

    /**
     * 一批刚写入的事件：逐条拿“这条归约之后”的状态，交给全部扩展并发反应；
     * 全部完成后按扩展顺序写入，作为下一批。最多 REACT_DEPTH_LIMIT 层。
     */
    async dispatch(written: Entry[], transient = false): Promise<Entry[]> {
        const all: Entry[] = [];
        let batch = written;
        for (let depth = 0; batch.length > 0; depth++) {
            if (depth > REACT_DEPTH_LIMIT) {
                this.diagnostics.push(`反应链超过 ${REACT_DEPTH_LIMIT} 层，丢弃 ${batch.length} 条：${batch.map((b) => b.type).join(", ")}`);
                break;
            }
            const outputs: {x: Loaded; events: EventInput[]}[] = [];
            for (const e of batch) {
                const snap = transient || e.scope === "session" ? this.leafSnap : this.stateAt(e.id);
                const results = await Promise.all(this.exts.map(async (x) => ({x, events: (x.parts.react ? await x.parts.react(e, this.ctxFor(x, snap)) : undefined) ?? []})));
                outputs.push(...results);
            }
            const next: Entry[] = [];
            for (const {x, events} of outputs) for (const ev of events) next.push(this.append(ev, x.def.id));
            all.push(...next);
            batch = next;
        }
        return all;
    }

    /** 不进日志的运行时事件（会话已打开）。 */
    async open(): Promise<void> {
        const pseudo: Entry = {id: "runtime", seq: 0, parent: null, scope: "path", cls: "ctrl", type: "session_opened", source: "kernel", data: {}};
        const results = await Promise.all(this.exts.map(async (x) => ({x, events: (x.parts.react ? await x.parts.react(pseudo, this.ctxFor(x, this.leafSnap)) : undefined) ?? []})));
        const written: Entry[] = [];
        for (const {x, events} of results) for (const ev of events) written.push(this.append(ev, x.def.id));
        await this.dispatch(written);
    }

    async create(): Promise<void> {
        await this.dispatch([this.append({cls: "ctrl", type: "session_created"}, "kernel")]);
        await this.open();
    }

    /** 外部事实（宿主或插件发现的），例如文件被用户改了。 */
    async external(source: string, input: EventInput): Promise<void> {
        await this.dispatch([this.append(input, source)]);
    }

    async changeSettings(patch: Record<string, any>): Promise<void> {
        await this.dispatch([this.append({cls: "ctrl", type: "settings_changed", scope: "session", data: {patch}}, "user")]);
    }

    // ---------- 视图 ----------

    buildRequest(leaf: string | null = this.leaf, now = (this.opts.clock ?? Date.now)()): ModelRequest {
        this.now = now;
        const snap = this.stateAt(leaf);
        const h = this.historyExt;
        const sel = (name: string) => this.select(snap, h.def.id, name);
        const renders: Record<string, RenderFn> = {};
        for (const x of this.exts) Object.assign(renders, x.parts.render ?? {});
        Object.assign(renders, this.opts.profile.render ?? {});
        const slotDecl = new Map<string, {volatile: boolean; ext: string}>();
        const contributions = new Map<string, string[]>();
        for (const x of this.exts) {
            for (const [name, d] of Object.entries(x.def.slots ?? {})) slotDecl.set(name, {volatile: !!d.volatile, ext: x.def.id});
            if (!x.parts.contribute) continue;
            const out = x.parts.contribute(this.ctxFor(x, snap).mine, this.ctxFor(x, snap));
            for (const [name, text] of Object.entries(out)) {
                if (text == null || text === "") continue;
                if (!x.def.slots?.[name]) this.diagnostics.push(`${x.def.id} 往没有声明的槽 ${name} 交内容`);
                contributions.set(name, [...(contributions.get(name) ?? []), text]);
            }
        }
        const settings = this.settings;
        const view: ViewInput = {
            state: this.viewState(snap),
            settings,
            tools: this.tools,
            model: {id: settings.model ?? "main", capabilities: {vision: !!settings.vision}},
        };
        const tree = this.opts.profile.prompt ? this.opts.profile.prompt(view) : defaultLayout(this.opts.profile.system ?? "");
        const out = renderTemplate(tree, {
            before: sel("before") as Entry[],
            input: sel("input") as Entry | null,
            transcript: sel("transcript") as Entry[],
            renders,
            contributions,
            slotDecl,
            tools: this.tools,
        });
        for (const d of out.diagnostics) this.diagnostics.push(d);
        return {
            model: settings.model ?? "main",
            params: {maxTokens: 8192},
            headers: {},
            system: out.system,
            messages: mergeAdjacentUser(out.messages),
            tools: this.tools,
        };
    }

    /** 内核兜底：最终请求必须合乎协议，投影被替换过也一样。 */
    validate(r: ModelRequest): void {
        const open = new Map<string, number>();
        r.messages.forEach((m, i) => {
            if (m.role !== "tool" && open.size > 0) throw new ProtocolError("missing-tool-result", `第 ${i} 条消息（${m.origin}）之前有工具调用没有结果：${[...open.keys()].join(", ")}`);
            if (m.role === "assistant") for (const c of m.toolCalls ?? []) open.set(c.id, i);
            if (m.role === "tool") {
                if (!m.callId || !open.has(m.callId)) throw new ProtocolError("orphan-tool-result", `第 ${i} 条工具结果（${m.origin}）找不到对应的调用`);
                open.delete(m.callId);
            }
        });
        if (open.size > 0) throw new ProtocolError("missing-tool-result", `末尾有工具调用没有结果：${[...open.keys()].join(", ")}`);
        for (const t of r.tools) if (!TOOL_NAME.test(t.replaceAll(".", "__"))) throw new ProtocolError("bad-tool-name", `工具名 ${t} 不合乎服务商规则`);
    }

    private async modelChain(request: ModelRequest, terminal: (r: ModelRequest) => Promise<ModelResponse>, preview: boolean) {
        const layers = this.exts.filter((x) => x.parts.intercept?.model && !(preview && x.def.preview === "skip"));
        const modifiedBy: {ext: string; fields: string[]}[] = [];
        const run = (i: number, req: ModelRequest): Promise<ModelResponse> => {
            if (i === layers.length) return terminal(req);
            const x = layers[i]!;
            return x.parts.intercept!.model!(req, (changed) => {
                const fields = (["model", "params", "headers", "system", "messages"] as const).filter((f) => JSON.stringify(changed[f]) !== JSON.stringify(req[f]));
                if (fields.length) modifiedBy.push({ext: x.def.id, fields});
                return run(i + 1, changed);
            }, this.ctxFor(x, this.leafSnap, preview));
        };
        const response = await run(0, request);
        return {response, modifiedBy};
    }

    /** 预览：归约 + 视图 + 模型拦截链；最里层不发请求，把最终请求截下来。 */
    async preview(leaf: string | null = this.leaf): Promise<ModelRequest> {
        let captured: ModelRequest | undefined;
        const recorded = this.requests.find((r) => r.leaf === leaf);
        await this.modelChain(this.buildRequest(leaf, recorded?.now), async (r) => {
            this.validate(r);
            captured = r;
            return {text: ""};
        }, true);
        return captured!;
    }

    private record(leaf: string, request: ModelRequest, modifiedBy: {ext: string; fields: string[]}[]): void {
        const prev = this.requests.at(-1)?.request;
        const parts = (r: ModelRequest) => [{t: `system|${r.system}`, o: "system"}, ...r.messages.map((m) => ({t: messageText(m), o: m.origin}))];
        const cur = parts(request);
        const tokens = cur.reduce((a, p) => a + estimateTokens(p.t), 0);
        let prefix = 0, firstDiff: string | null = null, recomputed = 0;
        if (prev) {
            const old = parts(prev);
            let i = 0;
            for (; i < cur.length && i < old.length && cur[i]!.t === old[i]!.t; i++) prefix += estimateTokens(cur[i]!.t);
            firstDiff = i < cur.length ? cur[i]!.o : null;
            // 上一次的末尾那条会变的槽本来就该被换掉，不算浪费
            const oldTail = old.slice(i);
            recomputed = oldTail.filter((p) => !(p.o.startsWith("slot:") && p === old.at(-1))).reduce((a, p) => a + estimateTokens(p.t), 0);
            const warn = this.opts.cacheWarnTokens ?? 200;
            if (recomputed > warn) this.diagnostics.push(`缓存：这次请求要重算上一次的 ${recomputed} token，从 ${firstDiff} 开始变了`);
        }
        this.requests.push({leaf, now: this.now, request, modifiedBy, tokens, prefixTokens: prefix, recomputedTokens: recomputed, firstDiff});
    }

    // ---------- 一次运行 ----------

    async send(text: string | null): Promise<void> {
        if (this.running) throw new Error("正在运行：应按插话或排队处理（t07）");
        this.running = true;
        try {
            await this.dispatch([this.append({cls: "ctrl", type: "run_started"}, "kernel")]);
            if (text !== null) {
                let committed = false;
                const inputLayers = this.exts.filter((x) => x.parts.intercept?.input);
                const run = async (i: number, t: string): Promise<void> => {
                    if (i === inputLayers.length) {
                        committed = true;
                        await this.dispatch([this.append({cls: "conv", type: "user", data: {text: t, ...(t === text ? {} : {original: text})}}, "user")]);
                        return;
                    }
                    const x = inputLayers[i]!;
                    await x.parts.intercept!.input!(t, (n) => run(i + 1, n), this.ctxFor(x, this.leafSnap));
                };
                await run(0, text);
                if (!committed) {
                    await this.dispatch([this.append({cls: "ctrl", type: "run_ended", data: {reason: "input-rejected"}}, "kernel")]);
                    return;
                }
            }
            let continues = 0;
            for (let step = 0; step < 30; step++) {
                const leaf = this.leaf!;
                const {response, modifiedBy} = await this.modelChain(this.buildRequest(), async (r) => {
                    this.validate(r);
                    this.record(leaf, r, []);
                    return await this.opts.model(r);
                }, false);
                this.requests.at(-1)!.modifiedBy = modifiedBy;
                const before = this.entries.length;
                const a = this.append({cls: "conv", type: "assistant", data: {text: response.text, toolCalls: response.toolCalls ?? [], model: this.requests.at(-1)!.request.model}}, "model");
                await this.dispatch([a]);
                if (response.toolCalls?.length) {
                    for (const call of response.toolCalls) {
                        const result = await this.toolChain(call);
                        await this.dispatch([this.append({cls: "conv", type: "tool_result", data: {callId: call.id, tool: call.name, ...result}}, `tool:${call.name}`)]);
                    }
                    continues = 0;
                    continue;
                }
                const reacted = this.entries.slice(before + 1).some((e) => e.cls === "conv" && e.scope === "path");
                if (reacted && continues < CONTINUE_LIMIT) {
                    continues++;
                    continue;
                }
                if (reacted) this.diagnostics.push(`“接着做”连续超过 ${CONTINUE_LIMIT} 次，结束运行`);
                break;
            }
            await this.dispatch([this.append({cls: "ctrl", type: "run_ended", data: {reason: "completed"}}, "kernel")]);
        } finally {
            this.running = false;
        }
    }

    private async toolChain(call: ToolCall): Promise<ToolResult> {
        const layers = this.exts.filter((x) => x.parts.intercept?.tool);
        const terminal = async (c: ToolCall): Promise<ToolResult> => {
            // 审批永远在最里层：只读模式下写工具一律拒绝，扩展在外层放行也没用
            if (this.opts.readOnly && WRITE_TOOLS.has(c.name)) return {text: "只读模式：拒绝写入", isError: true};
            const impl = this.opts.tools?.[c.name];
            if (!impl) return {text: `工具 ${c.name} 不可用`, isError: true};
            return impl(c.args, this.files);
        };
        const run = (i: number, c: ToolCall): Promise<ToolResult> => i === layers.length ? terminal(c) : layers[i]!.parts.intercept!.tool!(c, (n) => run(i + 1, n), this.ctxFor(layers[i]!, this.leafSnap));
        return run(0, call);
    }
}

/** 相邻的 user 消息并成一条（master 的 mergeAdjacentUserMessages 同样的做法）。 */
function mergeAdjacentUser(messages: Message[]): Message[] {
    const out: Message[] = [];
    for (const m of messages) {
        const last = out.at(-1);
        if (last && last.role === "user" && m.role === "user") out[out.length - 1] = {...last, content: `${last.content}\n\n${m.content}`, origin: `${last.origin}+${m.origin}`};
        else out.push(m);
    }
    return out;
}
