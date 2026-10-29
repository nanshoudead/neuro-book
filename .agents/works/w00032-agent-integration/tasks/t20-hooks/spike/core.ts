/**
 * 内置扩展 core.history 与 Profile 用的辅助函数。
 *
 * core.history 的状态用持久链表：reduce 必须返回新状态又不能改旧的（回退时旧叶子的状态还要用），
 * 用数组的话每条事件都要整份复制，打开长会话是 O(n²)。链表追加是 O(1)，取数组时再转。
 */

import type {Entry, EventInput, ExtensionDef, Parts, ReadCtx, Slice} from "./kernel.ts";

type List<T> = {head: T; tail: List<T>; size: number} | null;
const cons = <T>(head: T, tail: List<T>): List<T> => ({head, tail, size: (tail?.size ?? 0) + 1});
const arrays = new WeakMap<object, unknown[]>();
function toArray<T>(l: List<T>): T[] {
    if (!l) return [];
    const hit = arrays.get(l);
    if (hit) return hit as T[];
    const out: T[] = new Array(l.size);
    let i = l.size - 1;
    for (let n: List<T> = l; n; n = n.tail) out[i--] = n.head;
    arrays.set(l, out);
    return out;
}

export interface HistoryState {
    before: List<Entry>;
    input: Entry | null;
    transcript: List<Entry>;
    inRun: boolean;
}

/** 缺省的历史投影；替换它的扩展要导出同样三个选择器：before、input、transcript。 */
export function historySlice(opts: {keepRuns?: number} = {}): Slice<HistoryState> {
    return {
        initial: {before: null, input: null, transcript: null, inRun: false},
        reduce(s, e) {
            if (e.type === "run_started") {
                let before = s.before;
                if (s.input) before = cons(s.input, before);
                for (const t of toArray(s.transcript)) before = cons(t, before);
                if (opts.keepRuns !== undefined) before = keepLastRuns(before, opts.keepRuns);
                return {before, input: null, transcript: null, inRun: true};
            }
            if (e.type === "run_ended") return {...s, inRun: false};
            if (e.type === "compaction") return {...s, before: cons({...e, cls: "conv", type: "compaction_summary"}, null)};
            if (e.cls !== "conv" || e.scope !== "path") return s;
            if (s.inRun && e.type === "user" && !s.input) return {...s, input: e};
            if (s.inRun) return {...s, transcript: cons(e, s.transcript)};
            return {...s, before: cons(e, s.before)};
        },
        exports: {
            before: (s) => toArray(s.before),
            input: (s) => s.input,
            transcript: (s) => toArray(s.transcript),
        },
    };
}

function keepLastRuns(list: List<Entry>, n: number): List<Entry> {
    const all = toArray(list);
    let runs = 0, cut = 0;
    for (let i = all.length - 1; i >= 0; i--) {
        if (all[i]!.type === "user" && ++runs > n) {
            cut = i + 1;
            break;
        }
    }
    let out: List<Entry> = null;
    for (const e of all.slice(cut)) out = cons(e, out);
    return out;
}

export const coreHistory: ExtensionDef = {
    id: "core.history",
    setup: () => ({state: historySlice()}),
};

// ---------- 辅助函数 ----------

/** 存一个值、跟着路径走（或 scope: session 时在树外）；内核生成 reduce：取最后一次 set。 */
export function pathState<T>(opts: {id: string; initial: T; scope?: "path" | "session"; exports?: Record<string, (s: T) => unknown>}) {
    const type = `${opts.id}/set`;
    const slice: Slice<T> = {
        initial: opts.initial,
        scope: opts.scope ?? "path",
        reduce: (s, e) => (e.type === type ? (e.data.value as T) : s),
        ...(opts.exports ? {exports: opts.exports} : {}),
    };
    const set = (value: T): EventInput => ({cls: "ext", type, data: {value}, scope: opts.scope ?? "path"});
    /** 在指定事件上读一次外部数据；值没变就不写事件。返回一个 react。 */
    const load = (o: {on: (string | ((e: Entry, ctx: ReadCtx) => boolean))[]; load: (ctx: ReadCtx) => T | Promise<T>}) =>
        async (e: Entry, ctx: ReadCtx): Promise<EventInput[] | void> => {
            if (!o.on.some((m) => (typeof m === "string" ? m === e.type : m(e, ctx)))) return;
            const value = await o.load(ctx);
            if (JSON.stringify(value) === JSON.stringify(ctx.mine)) return;
            return [set(value)];
        };
    /** 以这片状态为核心的扩展：id 与 state 已填好，其余照扩展的写法。 */
    const extension = (rest: Omit<Parts, "state"> & Omit<ExtensionDef, "id" | "setup"> = {}): ExtensionDef => {
        const {tags, replaces, slots, preview, ...parts} = rest;
        return {id: opts.id, ...(tags ? {tags} : {}), ...(replaces ? {replaces} : {}), ...(slots ? {slots} : {}), ...(preview ? {preview} : {}), setup: () => ({...parts, state: slice})};
    };
    return {slice, set, load, extension, loader: (o: Parameters<typeof load>[0]) => extension({react: load(o)})};
}

export const sessionState = <T>(opts: {id: string; initial: T; exports?: Record<string, (s: T) => unknown>}) => pathState<T>({...opts, scope: "session"});

/** 种子：在会话创建、压缩完成等事件上写几条对话事件。 */
export function seed(o: {id: string; on: string[]; messages: (ctx: ReadCtx) => string[] | Promise<string[]>}): ExtensionDef {
    return {
        id: o.id,
        setup: () => ({
            async react(e, ctx) {
                if (!o.on.includes(e.type)) return;
                return (await o.messages(ctx)).map((text) => ({cls: "conv" as const, type: "seed", data: {text}}));
            },
            render: {seed: (e) => e.data.text},
        }),
    };
}

/**
 * 提醒：每 every 次用户发言一次，或 watch 的值变了的那次发言之后，写一条持久的提醒。
 * 计数与上次的值都由日志归约，回退后自动跟着回去。
 */
export function reminder(o: {
    id: string;
    tags?: string[];
    every?: number;
    watch?: (ctx: ReadCtx) => unknown;
    render: (change: {value: unknown; changed: boolean; first: boolean}) => string | null;
}): ExtensionDef {
    const type = `${o.id}/reminder`;
    type S = {turns: number; lastAt: number; lastValue: string | undefined; sent: boolean};
    return {
        id: o.id,
        ...(o.tags ? {tags: o.tags} : {}),
        setup: () => ({
            state: {
                initial: {turns: 0, lastAt: 0, lastValue: undefined, sent: false},
                reduce: (s: S, e: Entry): S => {
                    if (e.type === "user") return {...s, turns: s.turns + 1};
                    if (e.type === type) return {...s, lastAt: s.turns, lastValue: e.data.value, sent: true};
                    return s;
                },
            } satisfies Slice<S>,
            react(e, ctx) {
                if (e.type !== "user") return;
                const s = ctx.mine as S;
                const value = o.watch ? JSON.stringify(o.watch(ctx) ?? null) : undefined;
                const changed = o.watch !== undefined && value !== s.lastValue;
                const due = o.every !== undefined && s.turns - s.lastAt >= o.every;
                if (!changed && !due) return;
                const text = o.render({value: value === undefined ? undefined : JSON.parse(value), changed, first: !s.sent});
                if (text === null) return;
                return [{cls: "conv", type, data: {text, value}}];
            },
            render: {[type]: (e) => `<system-reminder>${e.data.text}</system-reminder>`},
        }),
    };
}
