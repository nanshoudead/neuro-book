/**
 * SettingsPageActions（同名 .md，settings-window.md 输出 3、13）与窗口通道（`page-chrome.ts`）：操作画在标题区的挂载点里，
 * 页面卸载时一起消失，这一层不能写时整体停用；没有通道时原位渲染。标题替换的登记与撤销。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, onBeforeUnmount, onMounted, ref} from "vue";
import type {PropType} from "vue";

import SettingsPageActions from "./SettingsPageActions.vue";
import {createPageChrome, SETTINGS_PAGE_CHROME} from "./page-chrome";
import type {SettingsPageChrome} from "./page-chrome";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const one = (selector: string): HTMLElement => {
    const found = document.body.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

/** 标题区：像真的标题区那样在挂载后登记自己的挂载点。 */
const TitleBar = defineComponent({
    name: "TitleBar",
    props: {chrome: {type: Object as PropType<SettingsPageChrome>, required: true}},
    setup(props) {
        const element = ref<HTMLElement | null>(null);
        let detach: (() => void) | null = null;
        onMounted(() => {
            if (element.value !== null) detach = props.chrome.attachActions(element.value);
        });
        onBeforeUnmount(() => detach?.());
        return () => h("header", {"data-title-bar": ""}, [h("div", {ref: element, "data-mount": ""})]);
    },
});

/** 一个窗口：标题区在页面前面或后面（标题区后挂载时页面先在原位渲染），页面里一个按钮。 */
function windowWith(options: {readonly writable?: boolean; readonly showPage?: boolean} = {}) {
    const writable = ref(options.writable ?? true);
    const showPage = ref(options.showPage ?? true);
    const chrome = createPageChrome(writable);
    const Page = defineComponent({
        name: "Page",
        setup: () => () => h("main", {"data-page": ""}, [
            h("p", "页面正文"),
            h(SettingsPageActions, {"data-actions-probe": ""}, {default: () => h("button", {type: "button", "data-action": ""}, "新增")}),
        ]),
    });
    const Root = defineComponent({
        name: "Root",
        setup: () => () => h("div", [h(TitleBar, {chrome}), showPage.value ? h(Page) : null]),
    });
    const wrapper = mount(Root, {global: {provide: {[SETTINGS_PAGE_CHROME as symbol]: chrome}}, attachTo: document.body});
    mounted.push(wrapper);
    return {chrome, writable, showPage};
}

describe("SettingsPageActions", () => {
    it("操作出现在标题区的挂载点里、不在页面正文里；页面卸载时一起消失", async () => {
        const {showPage} = windowWith();
        await flushPromises();
        expect(one("[data-mount] [data-action]").textContent).toBe("新增");
        expect(document.body.querySelector("[data-page] [data-action]")).toBeNull();
        // 透传的 attrs 落在内容上，不是 Teleport 上。
        expect(one("[data-mount] [data-actions-probe]").tagName).toBe("FIELDSET");
        showPage.value = false;
        await flushPromises();
        expect(document.body.querySelector("[data-action]")).toBeNull();
    });

    it("这一层不能写时整体停用，恢复后自动恢复", async () => {
        const {writable} = windowWith({writable: false});
        await flushPromises();
        // happy-dom 不算“fieldset 里的按钮是否停用”，这里看停用的作用域本身；按钮真的点不了由 settings.e2e.ts 在浏览器里验。
        const scope = one("[data-mount] [data-actions-probe]") as HTMLFieldSetElement;
        expect(scope.disabled).toBe(true);
        writable.value = true;
        await flushPromises();
        expect(scope.disabled).toBe(false);
        writable.value = false;
        await flushPromises();
        expect(scope.disabled).toBe(true);
    });

    it("没有通道（Lab 单独渲染）时原位渲染，不停用", async () => {
        const wrapper = mount(SettingsPageActions, {slots: {default: () => h("button", {type: "button", "data-action": ""}, "新增")}, attachTo: document.body});
        mounted.push(wrapper);
        await flushPromises();
        expect(wrapper.find("[data-action]").exists()).toBe(true);
        expect(wrapper.get("fieldset").element.disabled).toBe(false);
    });

    it("标题区换了一份：旧的卸载不会清掉新登记的挂载点，操作跟到新的里面", async () => {
        const writable = ref(true);
        const chrome = createPageChrome(writable);
        const first = document.createElement("div");
        const second = document.createElement("div");
        const detachFirst = chrome.attachActions(first);
        chrome.attachActions(second);
        detachFirst();
        expect(chrome.actionsTarget.value).toBe(second);
    });
});

describe("标题替换的登记与撤销", () => {
    it("后登记的盖过先登记的；先登记的撤销不动后来的，各自撤销后回到没有登记", () => {
        const chrome = createPageChrome(ref(true));
        const undoA = chrome.claim({title: "A", back: () => undefined});
        const undoB = chrome.claim({title: "B", back: () => undefined});
        expect(chrome.titleClaim.value?.title).toBe("B");
        undoA();
        expect(chrome.titleClaim.value?.title).toBe("B");
        undoB();
        expect(chrome.titleClaim.value).toBeNull();
        // 撤销后再调用没有任何效果，不会清掉新的登记。
        const undoC = chrome.claim({title: "C", back: () => undefined});
        undoB();
        expect(chrome.titleClaim.value?.title).toBe("C");
        undoC();
        undoC();
        expect(chrome.titleClaim.value).toBeNull();
    });

    it("同样内容的两次登记互不混：旧的撤销不会清掉内容相同的新登记", () => {
        const chrome = createPageChrome(ref(true));
        const back = () => undefined;
        const first = chrome.claim({title: "A", back});
        chrome.claim({title: "A", back});
        first();
        expect(chrome.titleClaim.value?.title).toBe("A");
    });
});

describe("标题区右侧提示的登记与撤销", () => {
    it("后登记的盖过先登记的；旧登记的撤销不动新的，文字相同的两次登记也不混", () => {
        const chrome = createPageChrome(ref(true));
        expect(chrome.note.value).toBeNull();
        const first = chrome.claimNote("未保存：第 3 行第 3 列：缺逗号");
        const second = chrome.claimNote("未保存：第 3 行第 3 列：缺逗号");
        first();
        expect(chrome.note.value).toBe("未保存：第 3 行第 3 列：缺逗号");
        second();
        second();
        expect(chrome.note.value).toBeNull();
    });
});
