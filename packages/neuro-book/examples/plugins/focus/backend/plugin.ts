/**
 * `example.focus` 的服务端入口：计时的权威。读这个文件学三件事：
 *
 * 1. **状态放在私有存储里，不放在内存里**：进行中的一次与今天的汇总是 `nbook.storage` 的一条记录。服务端重启、同一状态根上
 *    跑着几个服务端（docs/specs/runtime/projects.md），读到的都是同一份。
 * 2. **结算**：“到点了没有”不靠计时器回答，靠 `settle`：每次读写之前先看进行中的那次过没过 `endsAt`，过了就记为完成。
 *    计时器只负责到点触发一次结算、推一次 `changed`。机器休眠推迟了计时器、服务端在到点前重启、到点时根本没有计时器在跑，
 *    结果都一样：下一次有人读写时先结算。
 * 3. **条件保存**：几个服务端都会激活本入口、各自排计时器，到点时都会去结算。写入只在记录还是刚读到的那个 revision 时
 *    成功，冲突了就重读：别的服务端已经结算过，重读之后没有要记的，这一次就不会被记两遍。
 *
 * `changed` 只推本服务端自己的写入（Storage 的订阅只看得到分区拥有者进程里的写入）；别的服务端写的，窗口在重连或下一次
 * 读写时才看到。
 *
 * 对应的场景：`scenarios/07-focus.test.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineEntry, defineRecord, hostClockKey, provideRemote, settingsKey, storageKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition, RecordHandle, RemoteSink, RuntimeClock} from "@notnotype/nb-plugin-sdk";

import {descriptor} from "../plugin";
import {minutesSetting, RunningSchema, sessionsContract} from "../shared/contracts";
import type {Today} from "../shared/contracts";

/**
 * 记录：用户层、不分客户端（`locality: "shared"`：缺省的 `local` 按客户端分开存，服务端没有客户端身份，打不开它）。
 * `day` 是汇总所属的日期（服务端本地时区），不是今天时汇总按零算。
 */
const FocusRecordSchema = Type.Object({
    running: Type.Union([RunningSchema, Type.Null()]),
    day: Type.String(),
    completed: Type.Integer({minimum: 0}),
    minutes: Type.Integer({minimum: 0}),
}, {additionalProperties: false});

type FocusRecord = Static<typeof FocusRecordSchema>;

const focusRecord = defineRecord({key: "focus", scope: "user", locality: "shared", version: 1, schema: FocusRecordSchema});

const MINUTE = 60_000;
/** 连续冲突到这个次数就放弃，交给调用方。 */
const SAVE_ATTEMPTS = 3;

/** 时刻所在的日期，按服务端本地时区：“今天”是用户坐在机器前的今天。 */
function dayOf(time: number): string {
    const date = new Date(time);
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 结算：进行中的那次过了 `endsAt` 就记为完成，算在 `endsAt` 那一天；记录的日期不是今天时汇总清零。纯函数，同一份记录在
 * 同一时刻结算几次结果都一样，所以几个服务端各自结算不会多记。
 */
function settle(record: FocusRecord, now: number): FocusRecord {
    let next = record;
    if (next.running !== null && next.running.endsAt <= now) {
        const {startedAt, endsAt} = next.running;
        const day = dayOf(endsAt);
        const base = next.day === day ? next : {completed: 0, minutes: 0};
        next = {running: null, day, completed: base.completed + 1, minutes: base.minutes + Math.round((endsAt - startedAt) / MINUTE)};
    }
    const today = dayOf(now);
    return next.day === today ? next : {...next, day: today, completed: 0, minutes: 0};
}

function todayOf(record: FocusRecord, now: number): Today {
    return {running: record.running, completed: record.completed, minutes: record.minutes, now};
}

type StorageFailure = {readonly ok: false; readonly code: "storage-failed"; readonly detail: {readonly code: string; readonly detail: string}};

function storageFailed(failure: {readonly code: string; readonly detail: string}): StorageFailure {
    return {ok: false, code: "storage-failed", detail: {code: failure.code, detail: failure.detail}};
}

type Refusal<Code extends string> = {readonly ok: false; readonly code: Code; readonly detail: Record<string, never>};

/** 一次读写要做的改动（在结算之后）：返回新记录，返回 null 表示只结算，或者一个业务失败（不写）。 */
type Change<Code extends string> = (record: FocusRecord, now: number) => FocusRecord | null | Refusal<Code>;

export const focusBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            // 启动即激活：服务端重启后，到点的那次要有人结算并推 `changed`。
            activationEvents: ["onStartup"],
            dependencies: [{key: storageKey}, {key: settingsKey}, {key: hostClockKey}],
            remoteProvides: [sessionsContract],
            activate: async (context) => {
                const storage = context.services.require(storageKey);
                const settings = context.services.require(settingsKey);
                const clock: RuntimeClock = context.services.require(hostClockKey);
                const opened = await storage.open(focusRecord);
                // 打不开记录（例如存储坏了）：激活失败，原因进诊断；插件页显示这个入口激活失败。
                if (!opened.ok) throw new Error(`打不开专注记录：${opened.code}`);
                const handle: RecordHandle<FocusRecord> = opened.handle;
                const sinks = new Set<RemoteSink<Today>>();
                // 计时器登记在入口作用域上，这一代收口时取消；不登记就得自己保证每条停止路径都走到取消。
                const timer: {cancel: (() => void) | null} = {cancel: null};
                context.scope.register({kind: "host-timer", label: `${descriptor.id} 的到点结算`, value: timer, release: (slot) => {
                    slot.cancel?.();
                    slot.cancel = null;
                }});

                /** 到点触发一次结算。只排一个：每次读写后按最新的记录重排；入口开始停止后不再排。 */
                const arm = (record: FocusRecord): void => {
                    timer.cancel?.();
                    timer.cancel = null;
                    if (record.running === null || context.signal.aborted) return;
                    timer.cancel = clock.schedule(() => void update(() => null), Math.max(0, record.running.endsAt - clock.now()));
                };

                /**
                 * 读、结算、改、条件保存，冲突时重读重来。`change` 返回 null 表示只结算。记录真的变了才写，写成功后推 `changed`。
                 */
                async function update<Code extends string>(change: Change<Code>) {
                    for (let attempt = 1; ; attempt += 1) {
                        const now = clock.now();
                        const snapshot = await handle.read();
                        if (snapshot.status === "error") return storageFailed(snapshot);
                        if (snapshot.status === "corrupt" || snapshot.status === "unsupported-version") return storageFailed({code: snapshot.status, detail: snapshot.detail});
                        const stored = snapshot.status === "ok" ? snapshot.value : null;
                        const settled = settle(stored ?? {running: null, day: dayOf(now), completed: 0, minutes: 0}, now);
                        const changed = change(settled, now);
                        if (changed !== null && "ok" in changed) return changed;
                        const next = changed ?? settled;
                        if (stored !== null && JSON.stringify(stored) === JSON.stringify(next)) {
                            arm(next);
                            return {ok: true, value: todayOf(next, now)} as const;
                        }
                        const saved = await handle.save(next, {expect: snapshot.revision});
                        if (saved.ok) {
                            arm(next);
                            const today = todayOf(next, now);
                            for (const sink of sinks) sink.next(today);
                            return {ok: true, value: today} as const;
                        }
                        if (saved.code !== "conflict" || attempt === SAVE_ATTEMPTS) return storageFailed(saved);
                    }
                }

                const start: Change<"already-running"> = (record, now) => {
                    if (record.running !== null) return {ok: false, code: "already-running", detail: {}};
                    // 时长在开始时读一次：设置改了只影响下一次。
                    return {...record, running: {startedAt: now, endsAt: now + settings.get(minutesSetting) * MINUTE}};
                };
                const cancel: Change<"not-running"> = (record) => (record.running === null ? {ok: false, code: "not-running", detail: {}} : {...record, running: null});

                // 激活时先结算一次：服务端停着的时候到点的那次，现在记上，并为进行中的那次排计时器。
                const first = await update(() => null);
                if (!first.ok) throw new Error(`读不了专注记录：${first.detail.code}`);

                return {
                    remote: [
                        // 计时只有一份，不按调用方分；工厂对每个调用方调用一次，返回同一套实现。
                        provideRemote(sessionsContract, () => ({
                            methods: {
                                today: () => update(() => null),
                                start: () => update(start),
                                cancel: () => update(cancel),
                            },
                            events: {
                                changed: {
                                    // 订阅建立时先推一次当前的（顺便结算），之后每次写入成功推一次。`signal` 在订阅结束时触发。
                                    subscribe: async (_filter, sink, {signal}) => {
                                        const current = await update(() => null);
                                        if (!current.ok) throw new Error(`读不了专注记录：${current.detail.code}`);
                                        if (signal.aborted) return;
                                        sink.next(current.value);
                                        sinks.add(sink);
                                        signal.addEventListener("abort", () => sinks.delete(sink), {once: true});
                                    },
                                },
                            },
                        })),
                    ],
                };
            },
        }),
    ],
};
