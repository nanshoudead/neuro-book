import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import SuggestionMenu from "./SuggestionMenu.vue";
import {suggestionMenuOptions, suggestionOptionId, type SuggestionMenuGroup} from "./suggestion-menu";

/**
 * 宿主按 `suggestionMenuOptions` 的扁平顺序移动当前项，用 `suggestionOptionId` 写 `aria-activedescendant`；这里验两边对得上：
 * 多组、同名组标题、禁用项、过滤后下标变化时，宿主算出的 id 指向的就是挂高亮的那一项。布局与指针在 e2e/suggestion-menu.spec.ts。
 */

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const GROUPS: SuggestionMenuGroup[] = [
    {id: "a", label: "文件", items: [{id: "a1", label: "甲"}, {id: "a2", label: "乙", disabled: true}, {id: "a3", label: "丙"}]},
    {id: "b", label: "文件", items: [{id: "b1", label: "丁"}]},
    {id: "c", items: [{id: "c1", label: "戊"}]},
];

async function mountMenu(groups: readonly SuggestionMenuGroup[], activeId: string | null): Promise<VueWrapper> {
    const anchor = document.createElement("div");
    document.body.append(anchor);
    const wrapper = mount(SuggestionMenu, {props: {id: "menu", groups, activeId, anchor}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

/** 宿主的做法：当前项在扁平顺序里的下标，换成选项 id。 */
function hostDescendant(groups: readonly SuggestionMenuGroup[], activeId: string): string {
    return suggestionOptionId("menu", suggestionMenuOptions(groups).findIndex((item) => item.id === activeId));
}

describe("SuggestionMenu 的选项 id", () => {
    it("跨组累计、跳过禁用项：每个可选项的 id 与宿主按扁平顺序算出的一致", async () => {
        await mountMenu(GROUPS, "b1");
        const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
        expect(options.map((option) => [option.textContent?.trim(), option.id || null])).toEqual([
            ["甲", "menu-option-0"],
            ["乙", null],
            ["丙", "menu-option-1"],
            ["丁", "menu-option-2"],
            ["戊", "menu-option-3"],
        ]);
        const highlighted = document.querySelectorAll("[data-highlighted]");
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]!.id).toBe(hostDescendant(GROUPS, "b1"));
        expect(highlighted[0]!.getAttribute("aria-selected")).toBe("true");
    });

    it("同名的两个组标题各自关联到自己的组；没有标题的组不画标题行", async () => {
        await mountMenu(GROUPS, null);
        const groups = [...document.querySelectorAll<HTMLElement>("[role='group']")];
        expect(groups).toHaveLength(2);
        const labels = groups.map((group) => document.getElementById(group.getAttribute("aria-labelledby")!));
        expect(labels.map((label) => label?.textContent)).toEqual(["文件", "文件"]);
        expect(labels[0]).not.toBe(labels[1]);
        expect(groups.every((group, index) => group.contains(labels[index]!))).toBe(true);
    });

    it("过滤后下标变化，id 跟着扁平顺序重排；当前项是禁用项或不在列表里时不挂高亮", async () => {
        const wrapper = await mountMenu(GROUPS, "c1");
        const filtered: SuggestionMenuGroup[] = [GROUPS[1]!, GROUPS[2]!];
        await wrapper.setProps({groups: filtered});
        await flushPromises();
        expect(document.querySelector("[data-highlighted]")?.id).toBe(hostDescendant(filtered, "c1"));
        expect(hostDescendant(filtered, "c1")).toBe("menu-option-1");

        await wrapper.setProps({activeId: "a2"});
        await flushPromises();
        expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
        await wrapper.setProps({groups: GROUPS, activeId: "a2"});
        await flushPromises();
        expect(document.querySelectorAll("[data-highlighted]"), "禁用项不挂高亮").toHaveLength(0);
    });

    it("外框不是对话框：没有 role、悬空的 aria-labelledby 与 tabindex，组改了也不写回；可访问的结构是里面的 listbox", async () => {
        const wrapper = await mountMenu(GROUPS, "a1");
        const surface = (): HTMLElement => document.querySelector<HTMLElement>("[data-suggestion-menu]")!;
        const leftover = (): (string | null)[] => ["role", "aria-labelledby", "tabindex"].map((name) => surface().getAttribute(name));
        expect(leftover()).toEqual([null, null, null]);
        await wrapper.setProps({groups: GROUPS.slice(0, 1), activeId: "a3"});
        await flushPromises();
        expect(leftover()).toEqual([null, null, null]);
        expect(surface().querySelector("[role='listbox']")?.id).toBe("menu");
    });

    it("点禁用项不发 select；点可用项发它的 id", async () => {
        const wrapper = await mountMenu(GROUPS, null);
        const byText = (text: string): HTMLElement => [...document.querySelectorAll<HTMLElement>("[role='option']")].find((option) => option.textContent?.trim() === text)!;
        byText("乙").click();
        byText("丙").click();
        expect(wrapper.emitted("select")).toEqual([["a3"]]);
    });
});
