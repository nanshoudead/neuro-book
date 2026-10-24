/**
 * 窗口里的专注状态：视图与状态栏条目读它，命令与按钮经它开始、放弃。纯 TS（只用 Vue 的响应式），不依赖组件，所以场景测试
 * 在 Bun 里用真实的远程服务驱动它，组件测试在 Node 里给它一个内存里的数据源。
 *
 * 几条做法：
 * - **一条路径更新**：订阅建立时服务端先推一次当前的、之后每次变化推一次；重连（`onResync`）、操作的返回值、倒计时走到零，
 *   都把服务端给的“今天”交给同一个 `apply`。不在窗口里自己改计数：服务端是权威，自己改了会和推送打架。
 * - **剩余时间按 `endsAt` 算**：`endsAt - 现在`，“现在”用服务端给的时间对齐本地时钟（只记偏差）。不每秒减一：后台标签页的
 *   计时器会被浏览器放慢到每分钟一次，减出来的数会越差越远。
 * - **只在有进行中的一次时走表**：空闲时不排计时器；入口停止时 `dispose` 取消计时器与订阅。
 * - **同步断了要能接上**：订阅失败或结束后 `synced` 为假，视图给出“重新同步”，调 `connect` 再订阅一次。
 * - **完成还是放弃，看服务端的时间**：进行中的一次变成没有时，服务端此刻已过 `endsAt` 就是到点完成，否则是放弃。不比较
 *   个数：跨零点的那次完成后个数清零再加一，会比之前少。
 */

import {computed, shallowRef} from "vue";
import type {ComputedRef} from "vue";

import type {RemoteSubscription, RuntimeClock} from "@notnotype/nb-plugin-sdk";

import type {FocusSource, Today} from "../shared/contracts";

export interface FocusView {
    /** 拿到第一份“今天”之前为假：视图与状态栏这时不显示数字，免得先显示一个错的 0。 */
    readonly ready: boolean;
    readonly running: boolean;
    /** 进行中那次的剩余毫秒；没有进行中的为 0。 */
    readonly remainingMs: number;
    readonly completed: number;
    readonly minutes: number;
    /** 最近一次同步或操作失败的原因；下一次成功后清空。 */
    readonly problem: string | null;
    /** 订阅还在：服务端的变化会推过来。为假时数据可能是旧的。 */
    readonly synced: boolean;
    /** 最近结束的一次是怎么结束的；`seq` 每结束一次加一，同样的结束连着发生两次也看得出来。 */
    readonly ended: {readonly kind: "completed" | "cancelled"; readonly seq: number} | null;
}

export interface FocusStore {
    readonly view: ComputedRef<FocusView>;
    /** 订阅服务端；拿到第一份“今天”后完成。重复调用共用同一次；订阅失败或结束后再调用就重新订阅。 */
    connect(): Promise<void>;
    start(): Promise<void>;
    cancel(): Promise<void>;
    /** 空闲时开始，进行中时放弃：状态栏条目点一下就是它。 */
    toggle(): Promise<void>;
    dispose(): void;
}

const SECOND = 1000;

/** 剩余时间写成 `分:秒`，秒向上取整：还剩 0.4 秒时显示 0:01，走到零才显示 0:00。 */
export function formatRemaining(ms: number): string {
    const seconds = Math.ceil(Math.max(0, ms) / SECOND);
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

export function createFocusStore(source: FocusSource, clock: RuntimeClock): FocusStore {
    const today = shallowRef<Today | null>(null);
    /** 服务端时间减本地时间；用它把本地时钟换算成服务端的“现在”。 */
    let offset = 0;
    const now = shallowRef(clock.now());
    const problem = shallowRef<string | null>(null);
    let cancelTick: (() => void) | null = null;
    let subscription: RemoteSubscription | null = null;
    const synced = shallowRef(false);
    const ended = shallowRef<FocusView["ended"]>(null);
    let connecting: Promise<void> | null = null;
    let disposed = false;

    const remaining = (): number => {
        const running = today.value?.running ?? null;
        return running === null ? 0 : Math.max(0, running.endsAt - (now.value + offset));
    };

    /** 走表：在下一个整秒（按剩余时间）更新“现在”；走到零就向服务端要一次结算后的“今天”。 */
    const tick = (): void => {
        cancelTick?.();
        cancelTick = null;
        if (disposed || today.value?.running == null) return;
        const left = remaining();
        if (left <= 0) {
            void refresh();
            return;
        }
        cancelTick = clock.schedule(() => {
            now.value = clock.now();
            tick();
        }, left % SECOND || SECOND);
    };

    const apply = (next: Today): void => {
        if (disposed) return;
        const before = today.value?.running ?? null;
        if (before !== null && next.running === null) {
            ended.value = {kind: next.now >= before.endsAt ? "completed" : "cancelled", seq: (ended.value?.seq ?? 0) + 1};
        }
        offset = next.now - clock.now();
        now.value = clock.now();
        today.value = next;
        problem.value = null;
        tick();
    };

    const fail = (detail: string): void => {
        problem.value = detail;
    };

    async function refresh(): Promise<void> {
        const result = await source.today();
        if (result.ok) apply(result.value);
        else fail(`读不到今天的专注：${result.code}`);
    }

    const connect = (): Promise<void> => (connecting ??= (async () => {
        const first = Promise.withResolvers<void>();
        const subscribed = await source.subscribe((next) => {
            apply(next);
            first.resolve();
        }, {
            // 重连之后订阅已重建：断开期间的变化服务端不会补推，重取一次。
            onResync: () => void refresh(),
            onEnd: (reason) => {
                subscription = null;
                synced.value = false;
                connecting = null;
                fail(`与服务端的同步结束了：${reason}`);
                first.resolve();
            },
        });
        if (!subscribed.ok) {
            connecting = null;
            fail(`订阅不了专注状态：${subscribed.code}`);
            return;
        }
        if (disposed) {
            subscribed.value.release();
            return;
        }
        subscription = subscribed.value;
        synced.value = true;
        await first.promise;
    })());

    async function start(): Promise<void> {
        const result = await source.start();
        if (result.ok) apply(result.value);
        // 别的窗口刚开始了一次：按服务端的状态显示，不算出错。
        else if (result.code === "already-running") await refresh();
        else fail(`开始不了：${result.code}`);
    }

    async function cancel(): Promise<void> {
        const result = await source.cancel();
        if (result.ok) apply(result.value);
        else if (result.code === "not-running") await refresh();
        else fail(`放弃不了：${result.code}`);
    }

    return {
        view: computed(() => ({
            ready: today.value !== null,
            running: today.value?.running != null,
            remainingMs: remaining(),
            completed: today.value?.completed ?? 0,
            minutes: today.value?.minutes ?? 0,
            problem: problem.value,
            synced: synced.value,
            ended: ended.value,
        })),
        connect,
        start,
        cancel,
        toggle: () => (today.value?.running == null ? start() : cancel()),
        dispose: () => {
            disposed = true;
            cancelTick?.();
            cancelTick = null;
            subscription?.release();
            subscription = null;
            synced.value = false;
        },
    };
}
