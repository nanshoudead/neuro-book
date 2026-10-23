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

/** 内存里的数据源：与服务端同一套规则（已在计时再开始被拒、放弃不算完成），`finish` 模拟服务端到点结算后的推送。 */
function memorySource(clock: ManualClock) {
    let today: Today = {running: null, completed: 0, minutes: 0, now: clock.now()};
    let push: ((next: Today) => void) | null = null;
    const update = (next: Omit<Today, "now">): Today => {
        today = {...next, now: clock.now()};
        push?.(today);
        return today;
    };
    const source: FocusSource = {
        today: async () => ({ok: true, value: {...today, now: clock.now()}}),
        start: async () => (today.running !== null ? {ok: false, code: "already-running"} : {ok: true, value: update({...today, running: {startedAt: clock.now(), endsAt: clock.now() + 25 * MINUTE}})}),
        cancel: async () => (today.running === null ? {ok: false, code: "not-running"} : {ok: true, value: update({...today, running: null})}),
        subscribe: async (listener) => {
            push = listener;
            listener(today);
            return {ok: true, value: {release: () => void (push = null)}};
        },
    };
    return {source, finish: () => update({running: null, completed: today.completed + 1, minutes: today.minutes + 25})};
}

async function panel() {
    const clock = new ManualClock();
    const memory = memorySource(clock);
    const store = createFocusStore(memory.source, clock);
    const wrapper = mount(FocusPanel, {props: {context: {id: "example.focus.panel", generation: 1, visible: ref(true), location: ref<ViewLocation>("sidebar")}, store}, attachTo: document.body});
    mounted.push(wrapper);
    await store.connect();
    await flushPromises();
    return {wrapper, clock, memory};
}

describe("FocusPanel", () => {
    it("键盘按主按钮开始：焦点留在同一个按钮上，它变成“放弃”；剩余时间在 role=timer 里", async () => {
        const {wrapper} = await panel();
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");
        const toggle = wrapper.get<HTMLButtonElement>("[data-focus-toggle]");
        toggle.element.focus();
        // 键盘按回车在按钮上触发的就是 click。
        await toggle.trigger("click");
        await flushPromises();
        expect(document.activeElement).toBe(toggle.element);
        expect(toggle.text()).toBe("放弃");
        expect(wrapper.get("[role=timer]").text()).toBe("25:00");
    });

    it("走表按 endsAt 算剩余；放弃与完成各播报一次，个数只在完成时加一", async () => {
        const {wrapper, clock, memory} = await panel();
        await wrapper.get("[data-focus-toggle]").trigger("click");
        await flushPromises();
        clock.advance(61_000);
        await flushPromises();
        expect(wrapper.get("[role=timer]").text()).toBe("23:59");

        await wrapper.get("[data-focus-toggle]").trigger("click");
        await flushPromises();
        expect(wrapper.get("[data-focus-announcement]").text()).toBe("已放弃这次专注");
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 0 次，共 0 分钟");

        await wrapper.get("[data-focus-toggle]").trigger("click");
        await flushPromises();
        memory.finish();
        await flushPromises();
        expect(wrapper.get("[data-focus-announcement]").text()).toBe("完成了一次专注");
        expect(wrapper.get("[data-focus-today]").text()).toBe("今天完成 1 次，共 25 分钟");
        expect(wrapper.get("[data-focus-toggle]").text()).toBe("开始专注");
    });
});
