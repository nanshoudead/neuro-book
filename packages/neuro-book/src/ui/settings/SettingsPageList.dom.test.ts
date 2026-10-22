/**
 * SettingsPageList（同名 .md，settings-window.md 输出 19）：受控的“列表加下一级页面”。没打开项时是一张列表；点一行发 id，
 * 打开后画这一项的内容并经窗口通道换标题区；点返回发 `null`、值由调用方改，返回后焦点回到这一行；切项、返回、卸载时撤销
 * 标题替换；没有窗口通道时详情上方自己画返回。通道用产品里同一份 `createPageChrome`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, provide, ref} from "vue";
import type {PropType} from "vue";

import {createPageChrome, SETTINGS_PAGE_CHROME} from "./page-chrome";
import SettingsPageList from "./SettingsPageList.vue";
import type {SettingsPageListItem} from "./SettingsPageList.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const ITEMS: SettingsPageListItem[] = [
    {id: "deepseek", title: "DeepSeek", description: "api.deepseek.com", icon: "i-lucide-server", status: "已连接", tone: "success", modified: true},
    {id: "ollama", title: "本地 Ollama", status: "未连接"},
    {id: "custom", title: "自建服务", status: "连接失败", tone: "error"},
];

/**
 * 受控的宿主：值放在宿主里，列表只发事件。`chrome` 给了就提供窗口通道；`refuseBack` 时宿主不理会返回。
 * `items` 是个 ref，测试里可以改它（例如删掉打开的那一项）。
 */
function host(options: {chrome?: ReturnType<typeof createPageChrome>; open?: string | null; refuseBack?: boolean; items?: SettingsPageListItem[]} = {}) {
    const value = ref<string | null>(options.open ?? null);
    const items = ref<SettingsPageListItem[]>(options.items ?? ITEMS);
    const Host = defineComponent({
        name: "ListHost",
        props: {chrome: {type: Object as PropType<ReturnType<typeof createPageChrome>>, default: undefined}},
        setup(props) {
            if (props.chrome !== undefined) provide(SETTINGS_PAGE_CHROME, props.chrome);
            return () => h(SettingsPageList, {
                items: items.value,
                modelValue: value.value,
                label: "服务商",
                "onUpdate:modelValue": (next: string | null) => {
                    if (next === null && options.refuseBack === true) return;
                    value.value = next;
                },
            }, {default: ({item}: {item: SettingsPageListItem}) => h("p", {"data-detail": item.id}, `${item.title} 的详情`)});
        },
    });
    const wrapper = mount(Host, {props: {chrome: options.chrome}, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, value, items};
}

const row = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-settings-page-list-item="${id}"]`);
const detail = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[data-detail]");
const inlineBack = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[data-settings-page-list-back]");

describe("列表", () => {
    it("首屏是列表、不画详情：每行有标题、说明、状态文字（带色调）与改动圆点，没有的不画", () => {
        host();
        expect(document.body.querySelector("[data-state]")?.getAttribute("data-state")).toBe("list");
        expect(document.body.querySelector("ul")?.getAttribute("aria-label")).toBe("服务商");
        expect([...document.body.querySelectorAll("[data-settings-page-list-item]")].map((element) => (element as HTMLElement).dataset.settingsPageListItem)).toEqual(["deepseek", "ollama", "custom"]);
        expect(detail()).toBeNull();
        expect(row("deepseek")!.textContent).toContain("DeepSeek");
        expect(row("deepseek")!.textContent).toContain("api.deepseek.com");
        const tones = [...document.body.querySelectorAll<HTMLElement>("[data-settings-page-list-status]")].map((element) => [element.textContent, element.dataset.tone]);
        expect(tones).toEqual([["已连接", "success"], ["未连接", "muted"], ["连接失败", "error"]]);
        expect([...document.body.querySelectorAll("[data-settings-page-list-modified]")].map((dot) => dot.closest("[data-settings-page-list-item]")?.getAttribute("data-settings-page-list-item"))).toEqual(["deepseek"]);
        expect(row("deepseek")!.querySelector("[data-settings-page-list-modified]")?.getAttribute("aria-label")).toBe("有改动");
    });

    it("每一行键盘可达：是可聚焦的按钮，不被移出 Tab 顺序", () => {
        host();
        for (const id of ["deepseek", "ollama", "custom"]) {
            const element = row(id)!;
            element.focus();
            expect(document.activeElement).toBe(element);
            expect(element.tagName).toBe("BUTTON");
            expect(element.tabIndex).toBeGreaterThanOrEqual(0);
        }
    });

    it("点一行发出这一项的 id；值由调用方改，调用方没改时仍是列表", async () => {
        const wrapper = mount(SettingsPageList, {props: {items: ITEMS, modelValue: null, label: "服务商"}, attachTo: document.body});
        mounted.push(wrapper);
        await wrapper.get("[data-settings-page-list-item='ollama']").trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([["ollama"]]);
        expect(wrapper.attributes("data-state")).toBe("list");
    });

    it("没有项时不画任何一行", () => {
        host({items: []});
        expect(document.body.querySelector("[data-settings-page-list-item]")).toBeNull();
    });
});

describe("受控的列表、详情、列表（没有窗口通道）", () => {
    it("点一行打开它：列表换成详情，插槽拿到这一项；详情上方自己画“‹ 返回”，点它发 null、回到列表", async () => {
        const {value} = host();
        row("ollama")!.click();
        await flushPromises();
        expect(value.value).toBe("ollama");
        expect(document.body.querySelector("[data-state]")?.getAttribute("data-state")).toBe("detail");
        expect(detail()?.textContent).toBe("本地 Ollama 的详情");
        expect(row("deepseek")).toBeNull();
        expect(inlineBack()?.textContent?.trim()).toBe("返回");
        inlineBack()!.click();
        await flushPromises();
        expect(value.value).toBeNull();
        expect(detail()).toBeNull();
        expect(inlineBack()).toBeNull();
        expect(row("deepseek")).not.toBeNull();
    });

    it("返回之后焦点回到刚才那一行", async () => {
        host({open: "custom"});
        await flushPromises();
        inlineBack()!.click();
        await flushPromises();
        expect(document.activeElement).toBe(row("custom"));
    });

    it("调用方不让返回（值没变）时仍是详情，焦点不被抢走", async () => {
        const {value} = host({open: "custom", refuseBack: true});
        await flushPromises();
        const back = inlineBack()!;
        back.focus();
        back.click();
        await flushPromises();
        expect(value.value).toBe("custom");
        expect(detail()).not.toBeNull();
        expect(document.activeElement).toBe(back);
    });

    it("值指向列表里没有的项（刚被删掉）时画列表", async () => {
        const {items} = host({open: "custom"});
        await flushPromises();
        expect(detail()).not.toBeNull();
        items.value = ITEMS.filter((item) => item.id !== "custom");
        await flushPromises();
        expect(detail()).toBeNull();
        expect(row("deepseek")).not.toBeNull();
    });
});

describe("在窗口通道里打开一项", () => {
    it("打开时标题区换成这一项的标题、返回走页面登记的动作；返回后恢复，焦点回到这一行", async () => {
        const chrome = createPageChrome(ref(true));
        const {value} = host({chrome});
        expect(chrome.titleClaim.value).toBeNull();
        row("ollama")!.click();
        await flushPromises();
        expect(chrome.titleClaim.value?.title).toBe("本地 Ollama");
        // 窗口里返回在标题区，详情上方不再自画。
        expect(inlineBack()).toBeNull();
        chrome.titleClaim.value!.back();
        await flushPromises();
        expect(value.value).toBeNull();
        expect(chrome.titleClaim.value).toBeNull();
        expect(document.activeElement).toBe(row("ollama"));
    });

    it("直接换成另一项时标题随之换；这一项的标题变了（页面里在改名字）时标题区跟着变", async () => {
        const chrome = createPageChrome(ref(true));
        const {value, items} = host({chrome, open: "ollama"});
        await flushPromises();
        expect(chrome.titleClaim.value?.title).toBe("本地 Ollama");
        value.value = "custom";
        await flushPromises();
        expect(chrome.titleClaim.value?.title).toBe("自建服务");
        items.value = items.value.map((item) => (item.id === "custom" ? {...item, title: "自建服务 2"} : item));
        await flushPromises();
        expect(chrome.titleClaim.value?.title).toBe("自建服务 2");
    });

    it("页面卸载时撤销登记；别处后登记的标题不被误撤", async () => {
        const chrome = createPageChrome(ref(true));
        const {wrapper} = host({chrome, open: "deepseek"});
        await flushPromises();
        expect(chrome.titleClaim.value?.title).toBe("DeepSeek");
        wrapper.unmount();
        expect(chrome.titleClaim.value).toBeNull();

        const again = createPageChrome(ref(true));
        const second = host({chrome: again, open: "deepseek"});
        await flushPromises();
        const other = again.claim({title: "别处登记的", back: () => undefined});
        second.wrapper.unmount();
        expect(again.titleClaim.value?.title).toBe("别处登记的");
        other();
        expect(again.titleClaim.value).toBeNull();
    });

    it("值指向不存在的项时不登记标题替换", async () => {
        const chrome = createPageChrome(ref(true));
        host({chrome, open: "missing"});
        await flushPromises();
        expect(chrome.titleClaim.value).toBeNull();
    });
});
