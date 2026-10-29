/**
 * 一次性 spike：按提案 docs/proposals/agent-harness-event-model.md 写的最小内核（第二版），只用来检验架构与
 * API 形状，不是产品代码。模型与工具是假的；日志在内存里；不做流式与插话（见提案的待定项）。
 *
 * 读法：Session 是内核。append 只追加事件并算出新状态；dispatch 按“全部归约 → 同一份状态上全部反应 →
 * 按扩展顺序写入”的规则推进；send 是一次运行；view 是视图（sample → core.history 投影 + contribute + 模板）。
 *
 * 各入口读到的是哪一刻的状态（提案“扩展的形状与生命周期”一节的表）：
 * - reduce：这条事件之前的自己那片（以及同一作用域的兄弟片）；
 * - react：这条事件归约之后的 path 与 session 状态（每条事件写入时就记下这一对，批量写入也一样）；
 * - sample、contribute、prompt、模型拦截：这次请求所在的叶子（预览时就是被预览的叶子）；
 * - 工具拦截：发出这个调用的助手回复所在的叶子。
 */

import {is, K, type AnyExtension as Extension, type Block, type CompactionJob, type CompactionResult, type Entry, type EventOut, type KernelType, type Message, type ModelRequest, type ModelResponse, type ProfileDef, type Reaction, type ToolCall, type ToolResult, type UserInput, type ViewInput} from "./api.ts";
import {renderTemplate, defaultLayout} from "./template.ts";

export interface Diagnostic {
    level: "error" | "warn" | "info";
    code: string;
    ext?: string;
    entry?: string;
    request?: number;
    message: string;
}

export interface RecordedRequest {
    leaf: string;
    now: number;
    samples: Record<string, Record<string, unknown>>;
    request: ModelRequest;
    modifiedBy: {ext: string; fields: string[]}[];
    tokens: number;
    prefixTokens: number;
    /** 上一次请求里不在这次前缀里、要重新计算的 token（上一次末尾那段会变的槽不算）。 */
    recomputedTokens: number;
    firstDiff: string | null;
}

interface Loaded {
    def: Extension;
    own: boolean;
}

/** 扩展 id → 片名 → 值。 */
type Snap = Record<string, Record<string, unknown>>;
/** 一条事件写入之后的状态：path 与 session 各一份。 */
interface Pair {
    path: Snap;
    session: Snap;
}

type ToolFn = (args: any, files: Map<string, string>, signal: AbortSignal) => ToolResult | Promise<ToolResult>;
type ToolImpl = ToolFn | {run: ToolFn; concurrency: "shared" | "exclusive"};

/** 运行中到达的写入：在下一个边界（下一次请求之前）按到达顺序写进日志，不插进正在算的请求。 */
type Inbox = {kind: "external"; ext: string; out: EventOut} | {kind: "settings"; patch: Record<string, unknown>} | {kind: "steer"; text: string};

const WRITE_TOOLS = new Set(["write", "edit"]);
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
const KERNEL_TYPES = new Set<string>(Object.values(K));
/** 反应最多引出几层事件：根事件是第 0 层，反应写的是第 1 层，最多写到第 3 层。 */
export const REACT_DEPTH_LIMIT = 3;
export const CONTINUE_LIMIT = 3;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 2);
}

/** 运行被中止：模型、工具、反应在等的 Promise 都以它拒绝；迟到的结果不再写日志。 */
export class AbortedError extends Error {}

function raceAbort<T>(p: Promise<T> | T, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new AbortedError("已中止"));
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new AbortedError("已中止"));
        signal.addEventListener("abort", onAbort, {once: true});
        Promise.resolve(p).then(
            (v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
            (e) => (signal.removeEventListener("abort", onAbort), reject(e)),
        );
    });
}

const NEVER = new AbortController().signal;

export class ProtocolError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
    }
}

/**
 * 插件按依赖排序：先依赖、后被依赖；同一层按 id，所以结果与插件的激活顺序无关（重放确定）。
 * 依赖缺失或成环直接拒绝。Profile 自带的扩展保持列出的顺序，排在全部插件之后。
 */
function sortByDependencies(plugins: Extension[]): Extension[] {
    const byId = new Map(plugins.map((p) => [p.id, p]));
    for (const p of plugins) for (const d of p.dependsOn ?? []) if (!byId.has(d) && d !== "core.history") throw new Error(`${p.id} 依赖的 ${d} 没有装上`);
    const out: Extension[] = [];
    const done = new Set<string>();
    let rest = [...plugins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    while (rest.length) {
        const ready = rest.filter((p) => (p.dependsOn ?? []).every((d) => done.has(d) || d === "core.history"));
        if (!ready.length) throw new Error(`扩展依赖成环：${rest.map((p) => p.id).join("、")}`);
        for (const p of ready) {
            out.push(p);
            done.add(p.id);
        }
        rest = rest.filter((p) => !done.has(p.id));
    }
    return out;
}

/** 冻结新产生的状态：遇到已冻结的对象就停（持久链表的尾巴早已冻结），所以每次只冻结新的部分。 */
function freezeNew(v: unknown): void {
    const stack = [v];
    while (stack.length) {
        const x = stack.pop();
        if (x === null || typeof x !== "object" || Object.isFrozen(x)) continue;
        Object.freeze(x);
        for (const k of Object.keys(x)) stack.push((x as Record<string, unknown>)[k]);
    }
}

export interface SessionOptions {
    profile: ProfileDef;
    plugins?: Extension[];
    core?: Extension[];
    model: (request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse> | ModelResponse;
    tools?: Record<string, ToolImpl>;
    files?: Record<string, string>;
    settings?: Record<string, any>;
    /** 调用方给这个会话的初始数据（agent.startTask 的 initial），写在 session_created 里。 */
    initial?: unknown;
    readOnly?: boolean;
    snapshots?: "all" | "none";
    cacheWarnTokens?: number;
    clock?: () => number;
    reactTimeoutMs?: number;
    /** 压缩方法的最里层（spike 里是假的摘要模型）。 */
    compactor?: (job: CompactionJob) => CompactionResult | Promise<CompactionResult>;
    /** 冻结状态，抓原地修改（开发模式）。 */
    freeze?: boolean;
}

export class Session {
    readonly entries: Entry[] = [];
    readonly byId = new Map<string, Entry>();
    leaf: string | null = null;
    readonly requests: RecordedRequest[] = [];
    readonly diagnostics: Diagnostic[] = [];
    readonly files: Map<string, string>;
    exts: Loaded[] = [];
    running = false;

    private seq = 0;
    private snaps = new Map<string, Snap>();
    private readonly pairs = new WeakMap<Entry, Pair>();
    private leafSnap: Snap = {};
    private sessionSnap: Snap = {};
    private settingsCache: Record<string, any>;
    private opts: SessionOptions;
    private history!: Loaded;
    private volatileSlots = new Set<string>();
    private inbox: Inbox[] = [];
    private controller: AbortController | null = null;
    private readonly seenDiag = new Set<string>();

    constructor(opts: SessionOptions) {
        this.opts = opts;
        this.files = new Map(Object.entries(opts.files ?? {}));
        this.settingsCache = {...(opts.settings ?? {})};
        this.install(opts.profile, opts.plugins ?? [], opts.core ?? []);
        this.leafSnap = this.initialSnap("path");
        this.sessionSnap = this.initialSnap("session");
    }

    /** 装配扩展：顺序是内置（没被替换的）→ 插件 → Profile 自带；追加事件、拼接槽、拦截链（外到里）都按这个顺序。 */
    private install(profile: ProfileDef, pluginList: Extension[], core: Extension[]): void {
        const own = profile.extensions ?? [];
        for (const p of pluginList) if (p.replaces) throw new Error(`插件 ${p.id} 不能替换内置扩展，只有 Profile 自带的扩展能用 replaces`);
        const replaced = new Set(own.map((e) => e.replaces).filter(Boolean) as string[]);
        const g = profile.globalExtensions;
        const plugins = g === "none" ? [] : pluginList.filter((p) => !(g?.exclude ?? []).some((t) => p.tags?.includes(t)));
        const exts: Loaded[] = [];
        for (const c of core) if (!replaced.has(c.id)) exts.push({def: c, own: false});
        for (const p of sortByDependencies(plugins)) exts.push({def: p, own: false});
        for (const o of own) exts.push({def: o, own: true});
        const ids = new Map<string, string>();
        for (const x of exts) {
            const where = x.own ? `Profile ${profile.id}` : "插件或内置";
            if (ids.has(x.def.id)) throw new Error(`扩展 id 重复：${x.def.id}（${ids.get(x.def.id)} 与 ${where}）`);
            ids.set(x.def.id, where);
        }
        const history = exts.find((e) => e.def.id === "core.history" || e.def.replaces === "core.history");
        if (!history) throw new Error("没有历史投影：core.history 或替换它的扩展");
        this.exts = exts;
        this.history = history;
        this.opts = {...this.opts, profile, plugins: pluginList, core};
        this.volatileSlots = new Set(exts.flatMap((x) => Object.entries(x.def.contribute ?? {}).filter(([, c]) => c.volatile).map(([n]) => n)));
    }

    get settings(): Record<string, any> {
        return this.settingsCache;
    }

    get tools(): string[] {
        const p = this.opts.profile.tools;
        return [...p.required, ...(p.optional ?? []).filter((t) => t in (this.opts.tools ?? {}))];
    }

    /** 诊断按“码、扩展、内容”去重：长会话里同一个问题只记一次。 */
    diag(d: Diagnostic): void {
        const key = `${d.code}|${d.ext ?? ""}|${d.message}`;
        if (this.seenDiag.has(key)) return;
        this.seenDiag.add(key);
        this.diagnostics.push(d);
    }

    // ---------- 状态 ----------

    private initialSnap(scope: "path" | "session"): Snap {
        const s: Snap = {};
        for (const x of this.exts) {
            const slices: Record<string, unknown> = {};
            for (const [name, spec] of Object.entries(x.def.state ?? {}) as [string, {scope: string; initial: unknown}][]) if (spec.scope === scope) slices[name] = spec.initial;
            s[x.def.id] = slices;
        }
        if (this.opts.freeze !== false) freezeNew(s);
        return s;
    }

    private reduceInto(snap: Snap, e: Entry, scope: "path" | "session"): Snap {
        let next: Snap | undefined;
        for (const x of this.exts) {
            const cur = snap[x.def.id]!;
            let changed: Record<string, unknown> | undefined;
            for (const [name, spec] of Object.entries(x.def.state ?? {}) as [string, {scope: string}][]) {
                if (spec.scope !== scope) continue;
                let value: unknown;
                // ctx.set 写的事件由内核处理，作者不必写
                if (e.type === `${x.def.id}/$set` && (e.data as any).slice === name) value = (e.data as any).value;
                else value = (x.def.reduce as any)?.[name]?.(cur[name], e, x.def.ev, cur);
                if (value !== undefined && value !== cur[name]) (changed ??= {...cur})[name] = value;
            }
            if (changed) (next ??= {...snap})[x.def.id] = changed;
        }
        if (next && this.opts.freeze !== false) freezeNew(next);
        // 没有任何一片变化时返回同一个对象：快照共享，内存与比较都省
        return next ?? snap;
    }

    pathTo(id: string | null): Entry[] {
        const out: Entry[] = [];
        for (let e = id ? this.byId.get(id) : undefined; e; e = e.parent ? this.byId.get(e.parent) : undefined) out.push(e);
        return out.reverse();
    }

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

    /** 写进日志。来源是扩展时，类型必须以 `<扩展 id>/` 开头：扩展写不出内核事件，也撞不了别人的名字。 */
    private readonly keys = new Map<string, Entry>();

    private check(out: EventOut, source: string): void {
        const ext = this.exts.find((x) => x.def.id === source);
        if (ext && !out.type.startsWith(`${source}/`)) throw new Error(`${source} 写的事件类型 ${out.type} 不以 ${source}/ 开头`);
        if (!ext && !KERNEL_TYPES.has(out.type)) throw new Error(`内核不认识的事件类型 ${out.type}`);
    }

    /** 写进日志；带幂等键的，同一来源同一个键已经写过就返回已有的那条、不再写。 */
    private append(out: EventOut, source: string, cause?: {cause: string; depth: number}): Entry {
        this.check(out, source);
        if (out.key !== undefined) {
            const hit = this.keys.get(`${source}|${out.key}`);
            if (hit) return hit;
        }
        const e: Entry = {
            id: `e${++this.seq}`,
            seq: this.seq,
            at: (this.opts.clock ?? Date.now)(),
            parent: out.scope === "path" ? this.leaf : null,
            scope: out.scope,
            cls: out.cls,
            type: out.type,
            ...(out.v === undefined ? {} : {v: out.v}),
            source,
            ...(cause ?? {}),
            ...(out.key === undefined ? {} : {key: out.key}),
            data: out.data ?? {},
        };
        if (this.opts.freeze !== false) freezeNew(e);
        this.entries.push(e);
        this.byId.set(e.id, e);
        if (e.key !== undefined) this.keys.set(`${source}|${e.key}`, e);
        this.apply(e);
        return e;
    }

    private apply(e: Entry): void {
        if (e.scope === "path") {
            this.leafSnap = this.reduceInto(e.parent === this.leaf ? this.leafSnap : this.stateAt(e.parent), e, "path");
            this.leaf = e.id;
            if (this.opts.snapshots !== "none") this.snaps.set(e.id, this.leafSnap);
        } else {
            this.sessionSnap = this.reduceInto(this.sessionSnap, e, "session");
            if (is(e, K.settingsChanged)) this.settingsCache = {...this.settingsCache, ...e.data.patch};
            if (is(e, K.leafChanged)) {
                // 先算新叶子的状态再换叶子：stateAt 对当前叶子直接返回 leafSnap
                const snap = this.stateAt(e.data.leaf);
                this.leaf = e.data.leaf;
                this.leafSnap = snap;
            }
        }
        this.pairs.set(e, {path: this.leafSnap, session: this.sessionSnap});
    }

    private kernel<T extends KernelType>(type: T, data: unknown, source = "kernel", cls: "conv" | "ctrl" = "ctrl", scope: "path" | "session" = "path"): Entry {
        return this.append({cls, type, scope, data}, source);
    }

    /**
     * 打开已有会话：先校验日志（id 唯一、seq 递增、父节点在前），再照日志归约，不跑反应。
     * 当前叶子取最后一个“path 事件或 leaf_changed”指向的节点，不取数组末尾（t03）。
     */
    load(entries: Entry[]): void {
        const seen = new Set<string>();
        let lastSeq = 0;
        for (const e of entries) {
            if (seen.has(e.id)) throw new Error(`日志损坏：id ${e.id} 重复`);
            if (e.seq <= lastSeq) throw new Error(`日志损坏：${e.id} 的 seq ${e.seq} 不大于前一条 ${lastSeq}`);
            if (e.scope === "path" && e.parent !== null && !seen.has(e.parent)) throw new Error(`日志损坏：${e.id} 的父节点 ${e.parent} 不在它之前`);
            seen.add(e.id);
            lastSeq = e.seq;
        }
        for (const e of entries) {
            this.entries.push(e);
            this.byId.set(e.id, e);
            this.seq = Math.max(this.seq, e.seq);
            if (e.key !== undefined) this.keys.set(`${e.source}|${e.key}`, e);
            this.apply(e);
        }
    }

    /** 回退或切分支：写 leaf_changed（session 作用域），重启后照它恢复。运行中不能改树（t07）。 */
    async rewind(id: string | null): Promise<void> {
        if (this.running) throw new Error("运行中不能回退");
        if (id !== null && !this.byId.has(id)) throw new Error(`没有 ${id}`);
        await this.dispatch([this.kernel(K.leafChanged, {leaf: id}, "user", "ctrl", "session")]);
    }

    /**
     * Profile 或插件清单变了（t04 方案 D）：换上新的扩展，照日志从头重新归约（新扩展的片也从日志得到，
     * 旧扩展写的事件留在日志里，没有扩展认它们就不起作用），再写 profile_changed 并派发。
     */
    async reconfigure(profile: ProfileDef, plugins: Extension[] = this.opts.plugins ?? []): Promise<void> {
        if (this.running) throw new Error("运行中不能换 Profile：等这次运行收口");
        this.install(profile, plugins, this.opts.core ?? []);
        this.snaps = new Map();
        this.sessionSnap = this.initialSnap("session");
        const leaf = this.leaf;
        this.leaf = null;
        this.leafSnap = this.initialSnap("path");
        for (const e of this.entries) this.apply(e);
        this.leaf = leaf;
        this.leafSnap = this.stateAt(leaf);
        const ids = this.exts.map((x) => x.def.id);
        await this.dispatch([this.kernel(K.profileChanged, {profile: profile.id, extensions: ids, hash: Bun.hash(JSON.stringify([profile.id, ids])).toString(16)}, "kernel", "ctrl", "session")]);
    }

    /**
     * 崩溃后打开会话：当前路径上最后一次运行没有收口时，按 t07 结算——开始执行但没有结果的工具调用写成
     * “结果未知”，发出但没有回复的模型请求写 model_failed，最后写 run_ended（interrupted）。
     */
    async recover(): Promise<string[]> {
        const path = this.pathTo(this.leaf);
        const start = path.findLastIndex((e) => is(e, K.runStarted));
        if (start < 0 || path.slice(start).some((e) => is(e, K.runEnded))) return [];
        const run = path.slice(start);
        const done = new Set(run.filter((e) => is(e, K.toolResult)).map((e) => (e.data as any).callId));
        const settled: string[] = [];
        const written: Entry[] = [];
        for (const e of run) {
            if (is(e, K.toolStarted) && !done.has(e.data.callId)) {
                written.push(this.kernel(K.toolResult, {callId: e.data.callId, tool: e.data.tool, text: "结果未知：进程中断，工具可能执行了也可能没有", isError: true}, "kernel", "conv"));
                settled.push(e.data.callId);
            }
        }
        const lastModel = run.findLastIndex((e) => is(e, K.modelStarted));
        if (lastModel >= 0 && !run.slice(lastModel).some((e) => is(e, K.assistant) || is(e, K.modelFailed)))
            written.push(this.kernel(K.modelFailed, {request: (run[lastModel]!.data as any).request, message: "进程中断"}));
        written.push(this.kernel(K.runEnded, {reason: "interrupted"}));
        await this.dispatch(written);
        return settled;
    }

    // ---------- 上下文 ----------

    private mine(x: Loaded, p: Pair): Record<string, unknown> {
        return {...p.session[x.def.id], ...p.path[x.def.id]};
    }

    private read(p: Pair, extId: string, selector: string): unknown {
        const x = this.exts.find((e) => e.def.id === extId);
        const fn = (x?.def.exports as any)?.[selector];
        if (!x || !fn) throw new Error(`${extId} 没有导出 ${selector}`);
        const v = fn(this.mine(x, p));
        if (this.opts.freeze !== false) freezeNew(v);
        return v;
    }

    private pairAt(leaf: string | null): Pair {
        return {path: this.stateAt(leaf), session: this.sessionSnap};
    }

    private ctxFor(x: Loaded, p: Pair, preview = false): any {
        return {
            mine: this.mine(x, p),
            ev: x.def.ev,
            set: (slice: string, value: unknown) => {
                const spec = (x.def.state as any)?.[slice];
                if (!spec) throw new Error(`${x.def.id} 没有片 ${slice}`);
                return {cls: "ext", type: `${x.def.id}/$set`, scope: spec.scope, data: {slice, value}} satisfies EventOut;
            },
            message: (text: string) => ({cls: "conv", type: `${x.def.id}/message`, scope: "path", data: {text}}) satisfies EventOut,
            read: (extId: string, selector: string) => this.read(p, extId, selector),
            own: (extId: string) => {
                const y = this.exts.find((e) => e.def.id === extId);
                if (!x.own || !y?.own) throw new Error(`${extId} 的状态是私有的：只有同一个 Profile 自带的扩展之间能读原样`);
                return this.mine(y, p);
            },
            settings: this.settings,
            tools: this.tools,
            run: {running: this.running},
            preview,
            signal: this.controller?.signal ?? NEVER,
            file: (f: string) => this.files.get(f),
        };
    }

    // ---------- 事件派发 ----------

    private async runReact(x: Loaded, e: Entry, p: Pair): Promise<{events: EventOut[]; continue: boolean}> {
        if (!x.def.react) return {events: [], continue: false};
        try {
            const timeout = x.def.timeoutMs ?? this.opts.reactTimeoutMs ?? 30_000;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const r: Reaction = await Promise.race([
                Promise.resolve(x.def.react(e, this.ctxFor(x, p))),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`超过 ${timeout} ms`)), timeout);
                }),
            ]).finally(() => clearTimeout(timer));
            if (!r) return {events: [], continue: false};
            if (Array.isArray(r)) return {events: r, continue: false};
            return {events: r.events ?? [], continue: !!r.continue};
        } catch (err) {
            this.diag({level: "error", code: "react-failed", ext: x.def.id, entry: e.id, message: `${x.def.id} 对 ${e.id}（${e.type}）的反应失败：${(err as Error).message}；这次反应的结果丢弃`});
            return {events: [], continue: false};
        }
    }

    /**
     * 一批刚写入的事件：逐条拿“这条写入之后”的 path 与 session 状态，交给全部扩展并发反应；全部完成后按扩展
     * 顺序写入，作为下一批。第 REACT_DEPTH_LIMIT 层事件的反应若还要写事件，不写，记一条 reaction_limit。
     */
    async dispatch(written: Entry[], root?: string): Promise<{continueBy: string[]}> {
        const continueBy: string[] = [];
        let batch = written;
        for (let depth = 0; batch.length > 0; depth++) {
            const outputs: {x: Loaded; events: EventOut[]; continue: boolean; cause: Entry}[] = [];
            for (const e of batch) {
                const p = this.pairs.get(e) ?? {path: this.leafSnap, session: this.sessionSnap};
                outputs.push(...(await Promise.all(this.exts.map(async (x) => ({x, ...await this.runReact(x, e, p)})))).map((o) => ({...o, cause: e})));
            }
            for (const o of outputs) if (o.continue) continueBy.push(o.x.def.id);
            // 一个扩展对一条事件的输出是一个整体：有一条不合规矩，这次的全部不写
            for (const o of outputs) {
                try {
                    for (const ev of o.events) this.check(ev, o.x.def.id);
                } catch (err) {
                    this.diag({level: "error", code: "bad-event", ext: o.x.def.id, entry: o.cause.id, message: `${(err as Error).message}；这次反应的 ${o.events.length} 条都不写`});
                    o.events = [];
                }
            }
            const pending = outputs.flatMap((o) => o.events.map((ev) => ({x: o.x, ev, cause: o.cause})));
            if (depth >= REACT_DEPTH_LIMIT && pending.length) {
                const r = root ?? written[0]?.id ?? "?";
                this.diag({level: "warn", code: "react-depth", ext: pending[0]!.x.def.id, entry: r, message: `反应链到了第 ${REACT_DEPTH_LIMIT} 层，${pending.map((p) => p.x.def.id).join("、")} 还要写 ${pending.length} 条，不写`});
                this.kernel(K.reactionLimit, {root: r, dropped: pending.map((p) => p.ev.type)});
                break;
            }
            const next: Entry[] = [];
            for (const {x, ev, cause} of pending) {
                const e = this.append(ev, x.def.id, {cause: cause.id, depth: depth + 1});
                if (e.cause === cause.id) next.push(e);   // 幂等键命中已有的条目时不再派发
            }
            batch = next;
        }
        return {continueBy};
    }

    async create(): Promise<void> {
        await this.dispatch([this.kernel(K.sessionCreated, {initial: this.opts.initial ?? null})]);
        await this.open();
    }

    /** “会话已打开”不进日志：反应照常跑。 */
    async open(): Promise<void> {
        const pseudo: Entry = {id: "runtime", seq: 0, at: (this.opts.clock ?? Date.now)(), parent: null, scope: "path", cls: "ctrl", type: K.sessionOpened, source: "kernel", data: {}};
        this.pairs.set(pseudo, {path: this.leafSnap, session: this.sessionSnap});
        const results = await Promise.all(this.exts.map(async (x) => ({x, ...await this.runReact(x, pseudo, this.pairs.get(pseudo)!)})));
        const written: Entry[] = [];
        for (const r of results) for (const ev of r.events) written.push(this.append(ev, r.x.def.id));
        await this.dispatch(written);
    }

    /** 外部事实（宿主或插件发现的），例如文件被用户改了：以扩展的身份写一条它自己的事件。运行中先排队。 */
    async external(extId: string, out: EventOut): Promise<void> {
        if (this.running) return void this.inbox.push({kind: "external", ext: extId, out});
        await this.dispatch([this.append(out, extId)]);
    }

    async changeSettings(patch: Record<string, unknown>): Promise<void> {
        if (this.running) return void this.inbox.push({kind: "settings", patch});
        await this.dispatch([this.kernel(K.settingsChanged, {patch}, "user", "ctrl", "session")]);
    }

    /** 插话（t07）：只在运行中有效，在下一次模型请求之前送达。 */
    steer(text: string): void {
        if (!this.running) throw new Error("没有在运行：请直接发送");
        this.inbox.push({kind: "steer", text});
    }

    abort(): void {
        this.controller?.abort();
    }

    /** 把运行中排队的写入按到达顺序写进日志。 */
    private async drain(): Promise<void> {
        while (this.inbox.length) {
            const item = this.inbox.shift()!;
            if (item.kind === "external") await this.dispatch([this.append(item.out, item.ext)]);
            else if (item.kind === "settings") await this.dispatch([this.kernel(K.settingsChanged, {patch: item.patch}, "user", "ctrl", "session")]);
            else await this.dispatch([this.kernel(K.steer, {text: item.text}, "user", "conv")]);
        }
    }

    // ---------- 视图 ----------

    /** 算一次请求：先并发取 sample，再投影、contribute、模板。预览过去的请求时传入记下的 now 与 samples。 */
    async view(leaf: string | null, recorded?: {now: number; samples: Record<string, Record<string, unknown>>}, preview = false) {
        const p = this.pairAt(leaf);
        const now = recorded?.now ?? (this.opts.clock ?? Date.now)();
        const samples: Record<string, Record<string, unknown>> = recorded?.samples ?? {};
        if (!recorded) {
            await Promise.all(this.exts.filter((x) => x.def.sample).map(async (x) => {
                const ctx = this.ctxFor(x, p, preview);
                const vals: Record<string, unknown> = {};
                await Promise.all(Object.entries(x.def.sample!).map(async ([k, fn]) => {
                    try {
                        vals[k] = await (fn as (c: unknown) => unknown)(ctx);
                    } catch (err) {
                        this.diag({level: "error", code: "sample-failed", ext: x.def.id, message: `${x.def.id} 的 sample ${k} 失败：${(err as Error).message}`});
                    }
                }));
                samples[x.def.id] = vals;
            }));
        }
        const settings = this.settings;
        const reader = {read: (extId: string, selector: string) => this.read(p, extId, selector)};
        const viewFor = (x?: Loaded): ViewInput => ({
            ...reader,
            now,
            sample: (x ? samples[x.def.id] : {}) ?? {},
            settings,
            tools: this.tools,
            model: {id: settings.model ?? "main", capabilities: {vision: !!settings.vision}},
        } as ViewInput);

        const renders: Record<string, (e: Entry) => string | null> = {};
        for (const x of this.exts) Object.assign(renders, Object.fromEntries(Object.entries(x.def.render ?? {}).map(([k, f]) => [`${x.def.id}/${k}`, f as (e: Entry) => string | null])));
        for (const x of this.exts) renders[`${x.def.id}/message`] ??= (e) => (e.data as any).text;
        Object.assign(renders, this.opts.profile.render ?? {});

        const slots = new Map<string, {volatile: boolean; ext: string; texts: string[]}>();
        for (const x of this.exts) {
            for (const [name, c] of Object.entries(x.def.contribute ?? {})) {
                const text = c.value(this.mine(x, p) as any, viewFor(x) as any);
                const cur = slots.get(name);
                if (cur && cur.volatile !== !!c.volatile) this.diag({level: "warn", code: "slot-volatility", ext: x.def.id, message: `槽 ${name} 在 ${cur.ext} 与 ${x.def.id} 里一个稳定一个会变`});
                const slot = cur ?? {volatile: !!c.volatile, ext: x.def.id, texts: []};
                if (text) slot.texts.push(text);
                slots.set(name, slot);
            }
        }

        const own = (extId: string) => {
            const y = this.exts.find((e) => e.def.id === extId);
            if (!y?.own) throw new Error(`${extId} 不是这个 Profile 自带的扩展，请用它导出的选择器`);
            return this.mine(y, p);
        };
        const tree = this.opts.profile.prompt ? this.opts.profile.prompt({...viewFor(), state: {...reader, own}} as any) : defaultLayout(this.opts.profile.system ?? "");
        const hid = this.history.def.id;
        const out = renderTemplate(tree as Parameters<typeof renderTemplate>[0], {
            before: this.read(p, hid, "before") as Entry[],
            input: this.read(p, hid, "input") as Entry | null,
            transcript: this.read(p, hid, "transcript") as Entry[],
            renders,
            slots,
            tools: this.tools,
        });
        for (const d of out.diagnostics) this.diag(d);
        const request: ModelRequest = {
            model: settings.model ?? "main",
            params: {maxTokens: 8192},
            headers: {},
            system: out.system,
            messages: out.messages,
            tools: this.tools,
        };
        return {request, now, samples, pair: p};
    }

    validate(r: ModelRequest): void {
        const open = new Map<string, number>();
        r.messages.forEach((m, i) => {
            const where = m.content.map((b) => b.origin).join("+") || m.role;
            if (m.role !== "tool" && open.size > 0) throw new ProtocolError("missing-tool-result", `第 ${i} 条消息（${where}）之前有工具调用没有结果：${[...open.keys()].join(", ")}`);
            if (m.role === "assistant") for (const c of m.toolCalls ?? []) open.set(c.id, i);
            if (m.role === "tool") {
                if (!m.callId || !open.has(m.callId)) throw new ProtocolError("orphan-tool-result", `第 ${i} 条工具结果（${where}）找不到对应的调用`);
                open.delete(m.callId);
            }
        });
        if (open.size > 0) throw new ProtocolError("missing-tool-result", `末尾有工具调用没有结果：${[...open.keys()].join(", ")}`);
        for (const t of r.tools) if (!TOOL_NAME.test(t.replaceAll(".", "__"))) throw new ProtocolError("bad-tool-name", `工具名 ${t} 不合乎服务商规则`);
    }

    private async modelChain(request: ModelRequest, p: Pair, terminal: (r: ModelRequest, modifiedBy: {ext: string; fields: string[]}[]) => Promise<ModelResponse>, preview: boolean) {
        const layers = this.exts.filter((x) => x.def.intercept?.model && !(preview && x.def.preview === "skip"));
        const modifiedBy: {ext: string; fields: string[]}[] = [];
        const run = (i: number, req: ModelRequest): Promise<ModelResponse> => {
            if (i === layers.length) return terminal(req, modifiedBy);
            const x = layers[i]!;
            return x.def.intercept!.model!(req, (changed: ModelRequest) => {
                const fields = (["model", "params", "headers", "system", "messages"] as const).filter((f) => JSON.stringify(changed[f]) !== JSON.stringify(req[f]));
                if (fields.length) modifiedBy.push({ext: x.def.id, fields});
                return run(i + 1, changed);
            }, this.ctxFor(x, p, preview));
        };
        return {response: await run(0, request), modifiedBy};
    }

    /** 预览：sample + 视图 + 模型拦截链；最里层不发请求。预览过去的请求时用记下的 now 与 samples。 */
    async preview(leaf: string | null = this.leaf): Promise<ModelRequest> {
        // 这个叶子上发过请求：用日志里 model_started 记下的 now 与 samples（重启后也在）
        const started = this.entries.find((e) => is(e, K.modelStarted) && e.parent === leaf) as Entry<"model_started", {now: number; samples: Record<string, Record<string, unknown>>}> | undefined;
        const recorded = started ? {now: started.data.now, samples: started.data.samples} : undefined;
        const {request, pair} = await this.view(leaf, recorded, true);
        let captured: ModelRequest | undefined;
        await this.modelChain(request, pair, async (r) => {
            this.validate(r);
            captured = r;
            return {text: ""};
        }, true);
        return captured!;
    }

    /** 缓存比对：把请求压平成块序列，按块找第一处不同。 */
    private record(leaf: string, now: number, samples: RecordedRequest["samples"], request: ModelRequest): RecordedRequest {
        const flat = (r: ModelRequest) => [
            // 模型、参数、header、工具也是前缀的一部分：换了任何一样，服务商的缓存就从头失效
            {t: `F|${r.model}|${JSON.stringify(r.params)}|${JSON.stringify(r.headers)}|${r.tools.join(",")}`, o: "model/params/tools"},
            ...r.system.map((b) => ({t: `S|${b.text}`, o: b.origin})),
            ...r.messages.flatMap((m) => [{t: `M|${m.role}|${m.callId ?? ""}|${m.toolCalls ? JSON.stringify(m.toolCalls) : ""}`, o: m.role}, ...m.content.map((b) => ({t: `B|${b.text}`, o: b.origin}))]),
        ];
        const cur = flat(request);
        const tokens = cur.reduce((a, x) => a + estimateTokens(x.t), 0);
        // 只与同一条路径上最近的那次请求比：回退到别的分支后，另一分支的请求不是前缀
        const onPath = new Set(this.pathTo(leaf).map((e) => e.id));
        const prev = this.requests.findLast((r) => onPath.has(r.leaf));
        let prefix = 0, recomputed = 0, firstDiff: string | null = null;
        if (prev) {
            const old = flat(prev.request);
            let i = 0;
            for (; i < cur.length && i < old.length && cur[i]!.t === old[i]!.t; i++) prefix += estimateTokens(cur[i]!.t);
            firstDiff = i < cur.length ? cur[i]!.o : null;
            // 上一次末尾那段会变的槽本来就该换掉，不算浪费
            let end = old.length;
            while (end > i && this.isVolatileOrigin(old[end - 1]!.o)) end--;
            // 那条消息只装着会变的槽时，消息头也算会变的部分（块的来源不会是 "user"，这里的 "user" 只可能是消息头）
            if (end < old.length && end > i && old[end - 1]!.o === "user") end--;
            recomputed = old.slice(i, end).reduce((a, x) => a + estimateTokens(x.t), 0);
            const warn = this.opts.cacheWarnTokens ?? 200;
            if (recomputed > warn) this.diag({level: "warn", code: "cache-miss", request: this.requests.length, message: `这次请求要重算上一次的 ${recomputed} token，从 ${firstDiff} 开始变了`});
        }
        const rec: RecordedRequest = {leaf, now, samples, request, modifiedBy: [], tokens, prefixTokens: prefix, recomputedTokens: recomputed, firstDiff};
        this.requests.push(rec);
        return rec;
    }

    private isVolatileOrigin(o: string): boolean {
        return o.startsWith("slot:") && o.slice(5).split(",").every((n) => this.volatileSlots.has(n));
    }

    // ---------- 压缩 ----------

    /** 压缩（t11）：经压缩拦截链，最里层是压缩方法；结果写成一条压缩事件，历史投影据此替换前面的内容。 */
    async compact(method = "summary", instructions: string[] = []): Promise<void> {
        if (this.running) throw new Error("运行中的压缩由循环触发；spike 只在两次运行之间压缩");
        const p = this.pairAt(this.leaf);
        const before = this.read(p, this.history.def.id, "before") as Entry[];
        const layers = this.exts.filter((x) => x.def.intercept?.compaction);
        const terminal = async (j: CompactionJob) => {
            if (!this.opts.compactor) throw new Error("没有压缩方法");
            return this.opts.compactor(j);
        };
        const run = (i: number, j: CompactionJob): Promise<CompactionResult> => (i === layers.length ? terminal(j) : layers[i]!.def.intercept!.compaction!(j, (n: CompactionJob) => run(i + 1, n), this.ctxFor(layers[i]!, p)));
        const result = await run(0, {method, entries: before, instructions});
        const tokensBefore = before.reduce((a, e) => a + estimateTokens(JSON.stringify(e.data)), 0);
        await this.dispatch([this.kernel(K.compaction, {method, ...result, tokensBefore, tokensAfter: estimateTokens(result.summary)})]);
    }

    // ---------- 一次运行 ----------

    async send(input: UserInput | string | null): Promise<void> {
        if (this.running) throw new Error("正在运行：应按插话或排队处理（t07）");
        this.running = true;
        this.controller = new AbortController();
        const signal = this.controller.signal;
        let ended = false;
        const end = async (reason: "completed" | "input-rejected" | "error" | "aborted", detail?: string) => {
            ended = true;
            await this.dispatch([this.kernel(K.runEnded, {reason, ...(detail ? {detail} : {})})]);
        };
        try {
            await this.dispatch([this.kernel(K.runStarted, {})]);
            if (input !== null) {
                const original: UserInput = typeof input === "string" ? {text: input} : input;
                let committed = false;
                const layers = this.exts.filter((x) => x.def.intercept?.input);
                const run = async (i: number, u: UserInput): Promise<void | {reject: string}> => {
                    if (i === layers.length) {
                        committed = true;
                        await this.dispatch([this.kernel(K.user, {...u, ...(u.text === original.text ? {} : {original: original.text})}, "user", "conv")]);
                        return;
                    }
                    const x = layers[i]!;
                    return x.def.intercept!.input!(u, async (n: UserInput) => void await run(i + 1, n), this.ctxFor(x, this.pairAt(this.leaf)));
                };
                const r = await run(0, original);
                if (!committed) return await end("input-rejected", (r && "reject" in r ? r.reject : undefined) ?? "被输入拦截拦下");
            }
            let continues = 0;
            for (let step = 0; step < 30; step++) {
                await this.drain();   // 边界：运行中到达的外部事实、设置变化、插话在这里写进日志
                const leaf = this.leaf!;
                const {request, now, samples, pair} = await this.view(leaf);
                let rec: RecordedRequest | undefined;
                let response: ModelResponse;
                try {
                    const out = await this.modelChain(request, pair, async (r, modifiedBy) => {
                        this.validate(r);
                        rec = this.record(leaf, now, samples, r);
                        // 发出之前落一条：崩溃后知道“请求已发出、结果未知”；视图的输入与修改记录一起记下
                        this.kernel(K.modelStarted, {request: this.requests.length - 1, hash: Bun.hash(JSON.stringify(r)).toString(16), now, samples, modifiedBy});
                        return await raceAbort(this.opts.model(r, signal), signal);
                    }, false);
                    response = out.response;
                    rec!.modifiedBy = out.modifiedBy;
                } catch (err) {
                    if (rec) this.kernel(K.modelFailed, {request: this.requests.length - 1, message: err instanceof AbortedError ? "已中止" : (err as Error).message});
                    throw err;
                }
                const a = this.kernel(K.assistant, {text: response.text, toolCalls: response.toolCalls ?? [], model: rec!.request.model}, "model", "conv");
                const {continueBy} = await this.dispatch([a]);
                if (response.toolCalls?.length) {
                    await this.toolBatch(response.toolCalls, this.pairs.get(a)!, signal);
                    continues = 0;
                    continue;
                }
                // 最终回复之后还有没送达的插话：送达后再请求一次（t07）
                if (this.inbox.some((i) => i.kind === "steer")) continue;
                if (continueBy.length === 0) break;
                if (continues >= CONTINUE_LIMIT) {
                    this.diag({level: "warn", code: "continue-limit", ext: continueBy[0], message: `${continueBy.join("、")} 要求接着做，已连续 ${CONTINUE_LIMIT} 次，结束运行`});
                    break;
                }
                continues++;
                this.diag({level: "info", code: "continue", ext: continueBy[0], message: `${continueBy.join("、")} 要求接着做（第 ${continues}/${CONTINUE_LIMIT} 次）`});
            }
            await end("completed");
        } catch (err) {
            if (err instanceof AbortedError) {
                if (!ended) await end("aborted");
                return;
            }
            if (!ended) await end("error", (err as Error).message);
            throw err;
        } finally {
            this.running = false;
            this.controller = null;
            // 运行结束后还在排队的外部事实与设置照常写入；插话没送达的，写成普通的排队（这里简化成丢弃并诊断）
            const steers = this.inbox.filter((i) => i.kind === "steer");
            this.inbox = this.inbox.filter((i) => i.kind !== "steer");
            if (steers.length) this.diag({level: "warn", code: "steer-dropped", message: `运行已结束，${steers.length} 条插话没有送达`});
            await this.drain();
        }
    }

    /**
     * 一个助手回复里的工具调用是一批：先按调用顺序写 tool_started，再按工具声明的并发执行（shared 并行，
     * exclusive 等前面的都完成再单独跑），全部完成后按调用顺序写结果，最后对这一批结果一起派发反应。
     * 工具拦截看的都是发出这批调用的那条回复之后的状态，所以同一批调用看到的世界相同。
     */
    private async toolBatch(calls: ToolCall[], p: Pair, signal: AbortSignal): Promise<void> {
        for (const c of calls) this.kernel(K.toolStarted, {callId: c.id, tool: c.name});
        const results: (ToolResult & {args?: unknown; raw?: string})[] = new Array(calls.length);
        const settle = () => calls.map((c, i) => this.kernel(K.toolResult, {callId: c.id, tool: c.name, ...(results[i] ?? {text: "已中止：结果未知，工具可能执行了也可能没有", isError: true})}, `tool:${c.name}`, "conv"));
        try {
            await raceAbort(this.runBatch(calls, p, signal, results), signal);
        } catch (err) {
            // 中止：已完成的写真实结果，没完成的写“结果未知”；之后迟到的结果不再写
            if (err instanceof AbortedError) settle();
            throw err;
        }
        await this.dispatch(settle());
    }

    private async runBatch(calls: ToolCall[], p: Pair, signal: AbortSignal, results: (ToolResult & {args?: unknown; raw?: string})[]): Promise<void> {
        let shared: Promise<void>[] = [];
        for (const [i, c] of calls.entries()) {
            const impl = this.opts.tools?.[c.name];
            const exclusive = typeof impl === "object" && impl.concurrency === "exclusive";
            const job = async () => {
                results[i] = await this.toolChain(c, p, signal);
            };
            if (exclusive) {
                await Promise.all(shared);
                shared = [];
                await job();
            } else shared.push(job());
        }
        await Promise.all(shared);
    }

    /** 工具拦截链；拦截改过参数或结果时，实际执行的参数与工具原本的结果也带回去写进日志。 */
    private async toolChain(call: ToolCall, p: Pair, signal: AbortSignal): Promise<ToolResult & {args?: unknown; raw?: string}> {
        const layers = this.exts.filter((x) => x.def.intercept?.tool);
        let executed: {args: unknown; result: ToolResult} | undefined;
        const terminal = async (c: ToolCall): Promise<ToolResult> => {
            const r = await this.execute(c, signal);
            executed = {args: c.args, result: r};
            return r;
        };
        const run = async (i: number, c: ToolCall): Promise<ToolResult> => {
            if (i === layers.length) return terminal(c);
            const x = layers[i]!;
            try {
                return await x.def.intercept!.tool!(c, (n: ToolCall) => run(i + 1, n), this.ctxFor(x, p));
            } catch (err) {
                this.diag({level: "error", code: "intercept-failed", ext: x.def.id, message: `${x.def.id} 的工具拦截失败：${(err as Error).message}`});
                if ((x.def.onFailure?.tool ?? "deny") === "deny") return {text: `扩展 ${x.def.id} 出错，这次调用被拒绝`, isError: true};
                return run(i + 1, c);
            }
        };
        const final = await run(0, call);
        const ex = executed as {args: unknown; result: ToolResult} | undefined;
        return {
            ...final,
            ...(ex && JSON.stringify(ex.args) !== JSON.stringify(call.args) ? {args: ex.args} : {}),
            ...(ex && ex.result.text !== final.text ? {raw: ex.result.text} : {}),
        };
    }

    private async execute(c: ToolCall, signal: AbortSignal): Promise<ToolResult> {
        // 审批永远在最里层：只读模式下写工具一律拒绝，扩展在外层放行也没用
        if (this.opts.readOnly && WRITE_TOOLS.has(c.name)) return {text: "只读模式：拒绝写入", isError: true};
        const impl = this.opts.tools?.[c.name];
        if (!impl) return {text: `工具 ${c.name} 不可用`, isError: true};
        try {
            return await (typeof impl === "function" ? impl : impl.run)(c.args, this.files, signal);
        } catch (err) {
            return {text: `工具出错：${(err as Error).message}`, isError: true};
        }
    }

}

export type {Block, Message, ModelRequest, ModelResponse};
