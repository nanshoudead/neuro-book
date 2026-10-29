/**
 * 内置扩展 core.history 与辅助函数（第二版：都用 defineExtension 写，和插件同一个形状）。
 *
 * core.history 的状态用持久链表：reduce 必须返回新状态又不能改旧的（回退时旧叶子的状态还要用），
 * 用数组的话每条事件都要整份复制，打开长会话是 O(n²)。链表追加是 O(1)，取数组时再转，转好的按链表节点记住。
 */

import {conv, defineExtension, is, K, path, type BaseCtx, type Entry, type ExportsOf, type KernelType} from "./api.ts";

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
    // 冻结后再记住：别人拿到的是只读的；内核在开发模式下冻结选择器结果时，遇到已冻结的就停，不会逐项再走一遍
    Object.freeze(out);
    arrays.set(l, out);
    return out;
}

export interface HistoryState {
    before: List<Entry>;
    input: Entry | null;
    transcript: List<Entry>;
    inRun: boolean;
}

function keepLastRuns(list: List<Entry>, n: number): List<Entry> {
    const all = toArray(list);
    let runs = 0, cut = 0;
    for (let i = all.length - 1; i >= 0; i--) {
        if (all[i]!.type === K.user && ++runs > n) {
            cut = i + 1;
            break;
        }
    }
    let out: List<Entry> = null;
    for (const e of all.slice(cut)) out = cons(e, out);
    return out;
}

/** 历史投影；替换它的扩展要导出同样三个选择器：before、input、transcript。 */
export function historyExtension<const Id extends string>(o: {id: Id; replaces?: "core.history"; keepRuns?: number}) {
    return defineExtension({
        id: o.id,
        ...(o.replaces ? {replaces: o.replaces} : {}),
        state: {h: path<HistoryState>({before: null, input: null, transcript: null, inRun: false})},
        events: {summary: conv()},
        reduce: {
            h(s, e) {
                // 本轮的输入与记录在运行结束时并进历史；开始时再并一次，兜住没有收口的运行
                const flush = (x: HistoryState): List<Entry> => {
                    let before = x.before;
                    if (x.input) before = cons(x.input, before);
                    for (const t of toArray(x.transcript)) before = cons(t, before);
                    return o.keepRuns === undefined ? before : keepLastRuns(before, o.keepRuns);
                };
                if (is(e, K.runStarted)) return {before: flush(s), input: null, transcript: null, inRun: true};
                if (is(e, K.runEnded)) return {before: flush(s), input: null, transcript: null, inRun: false};
                if (is(e, K.compaction)) {
                    // firstKeptEntryId 之前的换成摘要；之后的原样保留
                    const all = toArray(flush(s));
                    const idx = e.data.firstKeptEntryId === null ? all.length : all.findIndex((x) => x.id === e.data.firstKeptEntryId);
                    let before: List<Entry> = cons({...e, cls: "conv", type: `${o.id}/summary`, data: {text: e.data.replacement}} as Entry, null);
                    for (const x of all.slice(idx < 0 ? all.length : idx)) before = cons(x, before);
                    return {before, input: null, transcript: null, inRun: s.inRun};
                }
                if (e.cls !== "conv" || e.scope !== "path") return undefined;
                if (s.inRun && is(e, K.user) && !s.input) return {...s, input: e};
                if (s.inRun) return {...s, transcript: cons(e, s.transcript)};
                return {...s, before: cons(e, s.before)};
            },
        },
        exports: {
            before: (m) => toArray(m.h.before),
            input: (m) => m.h.input as Entry<"user", {text: string; payload?: unknown}> | null,
            transcript: (m) => toArray(m.h.transcript),
        },
        render: {summary: (e) => `<conversation_summary>${e.data.text}</conversation_summary>`},
    });
}

export const coreHistory = historyExtension({id: "core.history"});

// core.history 的选择器登记在这里：用到 core 的地方都能得到 read("core.history", "input") 的类型
declare module "./api.ts" {
    interface ExtensionExports {
        "core.history": ExportsOf<typeof coreHistory>;
    }
}

// ---------- 辅助函数 ----------

type Trigger = KernelType | `${string}/${string}`;

/** 种子：在会话创建、压缩完成等事件上写几条对话事件；messages 拿到触发它的事件（会话创建时可以读 initial）。 */
export function seed<const Id extends string>(o: {id: Id; on: Trigger[]; messages: (e: Entry, ctx: BaseCtx<{}, {seed: ReturnType<typeof conv>}, Id>) => (string | null | undefined)[] | Promise<(string | null | undefined)[]>}) {
    return defineExtension({
        id: o.id,
        events: {seed: conv()},
        async react(e, ctx) {
            if (!o.on.includes(e.type as Trigger)) return;
            return (await o.messages(e, ctx)).filter((t): t is string => !!t).map((text) => ctx.ev.seed({text}));
        },
        render: {seed: (e) => e.data.text},
    });
}

/**
 * 提醒：每 every 次用户发言一次，或 watch 的值变了的那次发言之后，写一条持久的提醒。
 * 计数与上次的值都由日志归约，回退后自动跟着回去。覆盖措辞时用返回值的 ev.reminder.type。
 */
export function reminder<const Id extends string>(o: {
    id: Id;
    tags?: string[];
    every?: number;
    watch?: (ctx: BaseCtx<any, any, Id>) => unknown;
    render: (change: {value: unknown; changed: boolean; first: boolean}) => string | null;
}) {
    return defineExtension({
        id: o.id,
        ...(o.tags ? {tags: o.tags} : {}),
        state: {
            turns: path(0),
            lastAt: path(0),
            lastValue: path<string | null>(null),
            sent: path(false),
        },
        events: {reminder: conv<{text: string; value: string | null}>()},
        reduce: {
            turns: (n, e) => (is(e, K.user) ? n + 1 : undefined),
            lastAt: (_, e, ev, sib) => (ev.reminder.is(e) ? sib.turns : undefined),
            lastValue: (_, e, ev) => (ev.reminder.is(e) ? e.data.value : undefined),
            sent: (_, e, ev) => (ev.reminder.is(e) ? true : undefined),
        },
        react(e, ctx) {
            if (!is(e, K.user)) return;
            const m = ctx.mine;
            const value = o.watch ? JSON.stringify(o.watch(ctx) ?? null) : null;
            const changed = o.watch !== undefined && value !== m.lastValue;
            const due = o.every !== undefined && m.turns - m.lastAt >= o.every;
            if (!changed && !due) return;
            const text = o.render({value: value === null ? null : JSON.parse(value), changed, first: !m.sent});
            if (text === null) return;
            return [ctx.ev.reminder({text, value})];
        },
        render: {reminder: (e) => `<system-reminder>${e.data.text}</system-reminder>`},
    });
}
