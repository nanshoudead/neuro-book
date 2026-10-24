/**
 * 专注计时的视图组件：呈现 store 的状态与按键。组件测试跑在 Node 里，没有服务端（示例的场地要 Bun 的 SQLite），所以 store
 * 用真实实现（`focus-store.ts`），数据源是内存里的一份（`FocusSource`）。数据源的行为与场景 7 里真实远程服务的断言是同一组：
 * 开始得到 `{running: {startedAt, endsAt}, completed}`，放弃得到 `running: null`、个数不变，到点推送 `completed` 加一。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {ref} from "vue";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ViewLocation} from "@notnotype/nb-plugin-sdk";

import type {FocusSource, Today} from "../shared/contracts";
import FocusPanel from "./FocusPanel.vue";
import {createFocusStore} from "./focus-store";

const MINUTE = 60_000;
const mounted: Array<{unmount(): void}> = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/**
 * 内存里的数据源：与服务端同一套规则（已在计时再开始被拒、放弃不算完成）。`finish` 模拟服务端到点结算后的推送（时钟要先
 * 走过 `endsAt`）；`failSubscribe` 让下一次订阅失败，`end` 结束当前订阅（提供方停止等）。
 */
function memorySource(clock: ManualClock) {
    let today: Today = {running: null, completed: 0, minutes: 0, now: clock.now()};
    let push: ((next: Today) => void) | null = null;
    let onEnd: ((reason: string) => void) | undefined;
    let refuseNext = false;
    const update = (next: Omit<Today, "now">): Today => {
        today = {...next, now: clock.now()};
        push?.(today);
        return today;
    };
    const source: FocusSource = {
        today: async () => ({ok: true, value: {...today, now: clock.now()}}),
        start: async () => (today.running !== null ? {ok: false, code: "already-running"} : {ok: true, value: update({...today, running: {startedAt: clock.now(), endsAt: clock.now() + 25 * MINUTE}})}),
        cancel: async () => (today.running === null ? {ok: false, code: "not-running"} : {ok: true, value: update({...today, running: null})}),
        subscribe: async (listener, options) => {
            if (refuseNext) {
                refuseNext = false;
                return {ok: false, code: "unavailable"};
            }
            push = listener;
            onEnd = options.onEnd;
            listener({...today, now: clock.now()});
            return {ok: true, value: {release: () => void (push = null)}};
        },
    };
    return {
        source,
        /** 到点结算；`completed` 给出结算后的个数（跨零点时清零再加一），缺省为加一。 */
        finish: (completed = today.completed + 1) => update({running: null, completed, minutes: today.minutes + 25}),
        failSubscribe: () => void (refuseNext = true),
        end: (reason: string) => {
            push = null;
            onEnd?.(reason);
        },
    };
}

async function panel(prepare?: (memory: ReturnType<typeof memorySource>) => void) {
    const clock = new ManualClock();
    const memory = memorySource(clock);
    prepare?.(memory);
    const store = createFocusStore(memory.source, clock);
    const wrapper = mount(FocusPanel, {props: {context: {id: "example.focus.panel", generation: 1, visible: ref(true), location: ref<ViewLocation>("sidebar")}, store}, attachTo: document.body});
    mounted.push(wrapper);
    await store.connect();
    await flushPromises();
    return {wrapper, clock, memory};
}

const announcement = (wrapper: Awaited<ReturnType<typeof panel>>["wrapper"]) => wrapper.get("[data-focus-announcement]");

async function click(wrapper: Awaited<ReturnType<typeof panel>>["wrapper"], selector: string): Promise<void> {
    await wrapper.get(selector).trigger("click");
    await flushPromises();
}

describe("FocusPanel", () => {
    it("键盘按主按钮开始：焦点留在同一个按钮上，它变成“放弃”；剩余时间在 role=timer 里，空闲时读屏跳过 --:--", async () => {
        const {wrapper} = await panel();
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");
        expect(wrapper.find("[role=timer]").exists()).toBe(false);
        expect(wrapper.get("[data-focus-remaining]").attributes("aria-hidden")).toBe("true");
        const toggle = wrapper.get<HTMLButtonElement>("[data-focus-toggle]");
        toggle.element.focus();
        // 键盘按回车在按钮上触发的就是 click。
        await click(wrapper, "[data-focus-toggle]");
        expect(document.activeElement).toBe(toggle.element);
        expect(toggle.text()).toBe("放弃");
        expect(wrapper.get("[role=timer]").text()).toBe("25:00");
    });

    it("走表按 endsAt 算剩余；放弃与完成各播报一次，个数只在完成时加一", async () => {
        const {wrapper, clock, memory} = await panel();
        await click(wrapper, "[data-focus-toggle]");
        clock.advance(61_000);
        await flushPromises();
        expect(wrapper.get("[role=timer]").text()).toBe("23:59");

        await click(wrapper, "[data-focus-toggle]");
        expect(announcement(wrapper).text()).toBe("已放弃这次专注");
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");

        await click(wrapper, "[data-focus-toggle]");
        clock.advance(25 * MINUTE);
        memory.finish();
        await flushPromises();
        expect(announcement(wrapper).text()).toBe("完成了一次专注");
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 1 次，共 25 分钟");
        expect(wrapper.get("[data-focus-toggle]").text()).toBe("开始专注");
    });

    it("连着两次放弃，播报区两次都换上新的文字节点（文字相同也念）；跨零点完成、个数变少时仍播报“完成”", async () => {
        const {wrapper, clock, memory} = await panel();
        await click(wrapper, "[data-focus-toggle]");
        await click(wrapper, "[data-focus-toggle]");
        const first = announcement(wrapper).element.firstElementChild;
        expect(first?.textContent?.trim()).toBe("已放弃这次专注");
        await click(wrapper, "[data-focus-toggle]");
        await click(wrapper, "[data-focus-toggle]");
        const second = announcement(wrapper).element.firstElementChild;
        expect(second?.textContent?.trim()).toBe("已放弃这次专注");
        expect(second).not.toBe(first);

        // 之前的个数是 0 也看不出差别，所以先记上几次，再让跨零点的那次把个数清零再加一。
        for (let index = 0; index < 3; index += 1) {
            await click(wrapper, "[data-focus-toggle]");
            clock.advance(25 * MINUTE);
            memory.finish();
            await flushPromises();
        }
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 3 次，共 75 分钟");
        await click(wrapper, "[data-focus-toggle]");
        clock.advance(25 * MINUTE);
        memory.finish(1);
        await flushPromises();
        expect(announcement(wrapper).text()).toBe("完成了一次专注");
    });

    it("订阅失败：不停在“正在读取…”，给出原因与“重新同步”，点了之后显示今天的数据", async () => {
        const {wrapper} = await panel((memory) => memory.failSubscribe());
        expect(wrapper.text()).not.toContain("正在读取");
        expect(wrapper.get("[role=alert]").text()).toContain("unavailable");
        await click(wrapper, "[data-focus-resync]");
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");
        expect(wrapper.find("[role=alert]").exists()).toBe(false);
        expect(wrapper.find("[data-focus-resync]").exists()).toBe(false);
    });

    it("订阅结束：保留最后的数据，给出“重新同步”；重新订阅后拿到断开期间的变化", async () => {
        const {wrapper, memory} = await panel();
        memory.end("provider-stopped");
        await flushPromises();
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");
        expect(wrapper.get("[role=alert]").text()).toContain("provider-stopped");
        // 断开期间别处开始了一次。
        await memory.source.start();
        await click(wrapper, "[data-focus-resync]");
        expect(wrapper.get("[data-focus-toggle]").text()).toBe("放弃");
        expect(wrapper.find("[data-focus-resync]").exists()).toBe(false);
    });
});
