/**
 * `example.focus` 的服务端入口：计时的权威。读这个文件学四件事：
 *
 * 1. **状态放在私有存储里，不放在内存里**：进行中的一次与今天的汇总是 `nbook.storage` 的一条记录。服务端重启、同一状态根上
 *    跑着几个服务端（docs/specs/runtime/projects.md），读到的都是同一份。
 * 2. **结算**：“到点了没有”不靠计时器回答，靠 `settle`：每次读写之前先看进行中的那次过没过 `endsAt`，过了就记为完成。
 *    计时器只负责到点触发一次结算、推一次 `changed`。机器休眠推迟了计时器、服务端在到点前重启、到点时根本没有计时器在跑，
 *    结果都一样：下一次有人读写时先结算。`settle` 是纯函数，几个服务端从同一份记录各自结算，算出的是同一份，不会多记。
 * 3. **条件保存**：写入只在记录还是刚读到的那个 revision 时成功，冲突了就重读重来。它防的是丢更新：到点结算读到记录之后、
 *    写入之前，用户经另一个服务端开始了新的一次；不带条件直接写，结算写下的“空闲”会把新的那次盖掉。
 * 4. **坏记录**：记录读出 `corrupt`（不合 schema）或 `unsupported-version`（`version` 改过）时，用 `reset` 换成空记录，
 *    原件留在存储的原件区。这条记录只是今天的汇总，丢了代价很小；不重置的话入口每次读写都失败，用户没有办法自救。
 *    要保留旧数据的插件，在这里按旧形状迁移，而不是重置。
 *
 * `changed` 只推本服务端自己的写入（Storage 的订阅只看得到分区拥有者进程里的写入）；别的服务端写的，窗口在重连或下一次
 * 读写时才看到。
 *
 * 对应的场景：`scenarios/07-focus.test.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {hostClockKey, provideRemote} from "@notnotype/nb-plugin-sdk";
import type {RemoteSink, RuntimeClock} from "@notnotype/nb-plugin-sdk";
import {defineRecord, storageKey} from "@notnotype/nb-plugin-sdk/storage";
import type {RecordHandle} from "@notnotype/nb-plugin-sdk/storage";
import {settingsKey} from "@notnotype/nb-plugin-sdk/settings";

import {minutesSetting, plugin, RunningSchema, sessionsContract} from "../shared/contracts";
import type {Today} from "../shared/contracts";

/**
 * 记录：用户层、不分客户端（`locality: "shared"`：`local` 按客户端分开存，服务端没有客户端身份，打不开它）。
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

/**
 * 时刻所在的日期，按服务端本地时区。假设服务端与用户在同一时区（本机运行时成立）；服务端跑在别的时区时，汇总会在用户的
 * 傍晚或早上清零，要按用户时区算就得由窗口把时区交给服务端。
 */
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

/** 业务失败；按码分布，`Refusal<never>` 是 never（不拒绝的改动）。 */
type Refusal<Code extends string> = Code extends string ? {readonly ok: false; readonly code: Code; readonly detail: Record<string, never>} : never;

/** 一次读写要做的改动（在结算之后）：返回新记录，返回 null 表示只结算，或者一个业务失败（不写）。 */
type Change<Code extends string> = (record: FocusRecord, now: number) => FocusRecord | null | Refusal<Code>;

export const focusBackendPlugin = plugin.definition([
    plugin.entry({
        location: "server",
        // 启动即激活：远程服务随入口激活才提供，窗口一打开就要订阅。
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
            /** 订阅中的推送口；`pushed` 记它是否已经收到过写入的推送（见下面 `changed` 的首推）。 */
            const sinks = new Set<{readonly sink: RemoteSink<Today>; pushed: boolean}>();
            // 计时器用 `onStop` 登记，这一代收口时取消；不登记就得自己保证每条停止路径都走到取消。
            const timer: {cancel: (() => void) | null} = {cancel: null};
            context.onStop(() => {
                timer.cancel?.();
                timer.cancel = null;
            });

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
                    // 坏记录按没有记录算，下面用 `reset` 写（文件头第 4 条）；普通的 `save` 对坏记录是 `protected`。
                    const damaged = snapshot.status === "corrupt" || snapshot.status === "unsupported-version";
                    const stored = snapshot.status === "ok" ? snapshot.value : null;
                    const settled = settle(stored ?? {running: null, day: dayOf(now), completed: 0, minutes: 0}, now);
                    const changed = change(settled, now);
                    if (changed !== null && "ok" in changed) return changed;
                    const next = changed ?? settled;
                    if (stored !== null && JSON.stringify(stored) === JSON.stringify(next)) {
                        arm(next);
                        return {ok: true, value: todayOf(next, now)} as const;
                    }
                    const saved = damaged ? await handle.reset(next, {expect: snapshot.revision}) : await handle.save(next, {expect: snapshot.revision});
                    if (saved.ok) {
                        arm(next);
                        const today = todayOf(next, now);
                        for (const watcher of sinks) {
                            watcher.pushed = true;
                            watcher.sink.next(today);
                        }
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

            return {
                remote: [
                    // 计时只有一份，不按调用方分；工厂对每个调用方调用一次，返回同一套实现。
                    provideRemote(sessionsContract, () => ({
                        methods: {
                            // 只结算、不拒绝：写明 never，免得失败码从合同反推成 storage-failed。
                            today: () => update<never>(() => null),
                            start: () => update(start),
                            cancel: () => update(cancel),
                        },
                        events: {
                            changed: {
                                // 订阅建立时先推一次当前的（顺便结算），之后每次写入成功推一次。`signal` 在订阅结束时触发。
                                // 先登记再读：读的那次 await 期间别的调用写入并推送时，这条订阅也收得到；收到过就不再推
                                // 读到的那份，它可能比已推的旧。先读后登记的话，读到旧值又错过推送，窗口会一直停在旧状态。
                                subscribe: async (_filter, sink, {signal}) => {
                                    if (signal.aborted) return;
                                    const watcher = {sink, pushed: false};
                                    sinks.add(watcher);
                                    signal.addEventListener("abort", () => sinks.delete(watcher), {once: true});
                                    const current = await update(() => null);
                                    if (!current.ok) {
                                        sinks.delete(watcher);
                                        throw new Error(`读不了专注记录：${current.detail.code}：${current.detail.detail}`);
                                    }
                                    if (!watcher.pushed) sink.next(current.value);
                                },
                            },
                        },
                    })),
                ],
            };
        },
    }),
]);
