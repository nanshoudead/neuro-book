/**
 * 可搜索的下拉（docs/specs/ui/forms.md 输出 30、28）：输入的文字只是搜索词，只有选中选项才改值，Escape 与失焦恢复显示
 * 已选项；高亮经 `aria-activedescendant` 指向列表里真实的那一项。布局与真实浏览器里的指针在 Lab 的 e2e。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import SearchSelect from "./SearchSelect.vue";

const OPTIONS = [
    {value: "gpt", label: "GPT-5"},
    {value: "claude", label: "Claude Opus", description: "Anthropic"},
    {value: "old", label: "Claude Instant", disabled: true},
    {value: "deepseek", label: "DeepSeek"},
];

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function mountSelect(props: Record<string, unknown> = {}): Promise<VueWrapper> {
    const wrapper = mount(SearchSelect, {props: {modelValue: "gpt", options: OPTIONS, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const input = (wrapper: VueWrapper) => wrapper.get("input[role='combobox']");
const value = (wrapper: VueWrapper) => (input(wrapper).element as HTMLInputElement).value;
const optionTexts = () => [...document.querySelectorAll<HTMLElement>("[role='option']")].map((option) => option.textContent?.trim());
const highlighted = () => document.querySelector<HTMLElement>("[role='option'][data-highlighted]");

async function type(wrapper: VueWrapper, text: string): Promise<void> {
    (input(wrapper).element as HTMLInputElement).value = text;
    await input(wrapper).trigger("input");
    await flushPromises();
}

describe("SearchSelect", () => {
    it("打字只筛选、不改值；Enter 选中高亮项，输入框显示它的名字", async () => {
        const wrapper = await mountSelect();
        expect(value(wrapper)).toBe("GPT-5");
        await type(wrapper, "claude");
        expect(optionTexts()).toEqual(["Claude OpusAnthropic", "Claude Instant"]);
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(input(wrapper).attributes("aria-expanded")).toBe("true");
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["claude"]]);
        await wrapper.setProps({modelValue: "claude"});
        expect(value(wrapper)).toBe("Claude Opus");
        expect(input(wrapper).attributes("aria-expanded")).toBe("false");
    });

    it("Escape 与失焦都丢掉搜索词、恢复显示已选项，不发出变化；Escape 不冒泡", async () => {
        const wrapper = await mountSelect();
        await type(wrapper, "deep");
        let bubbled = false;
        document.body.addEventListener("keydown", () => {
            bubbled = true;
        }, {once: true});
        await input(wrapper).trigger("keydown", {key: "Escape"});
        expect(value(wrapper)).toBe("GPT-5");
        expect(bubbled).toBe(false);
        await type(wrapper, "deep");
        await input(wrapper).trigger("blur");
        expect(value(wrapper)).toBe("GPT-5");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("↓ 打开时高亮落在已选项；移动跳过停用项并循环；aria-activedescendant 指向高亮的那一项", async () => {
        const wrapper = await mountSelect({modelValue: "claude"});
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toContain("Claude Opus");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toBe("DeepSeek");
        expect(input(wrapper).attributes("aria-activedescendant")).toBe(highlighted()?.id);
        expect(document.getElementById(input(wrapper).attributes("aria-controls")!)?.getAttribute("role")).toBe("listbox");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toBe("GPT-5");
    });

    it("点击选项选中它；停用项点了不算", async () => {
        const wrapper = await mountSelect();
        await input(wrapper).trigger("click");
        await flushPromises();
        const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
        options.find((option) => option.textContent?.includes("Instant"))!.click();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        options.find((option) => option.textContent === "DeepSeek")!.click();
        expect(wrapper.emitted("update:modelValue")).toEqual([["deepseek"]]);
    });

    it("没有匹配时列表里只有一行提示", async () => {
        const wrapper = await mountSelect({emptyText: "No match"});
        await type(wrapper, "zzz");
        expect(optionTexts()).toEqual([]);
        expect(document.querySelector("[data-suggestion-menu-empty]")?.textContent).toBe("No match");
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("只读：可聚焦、写 aria-readonly，点击、打字与方向键都不打开列表；停用时输入框停用", async () => {
        const wrapper = await mountSelect({readonly: true});
        expect(input(wrapper).attributes("aria-readonly")).toBe("true");
        expect(input(wrapper).attributes("disabled")).toBeUndefined();
        await input(wrapper).trigger("click");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await type(wrapper, "deep");
        expect(document.querySelector("[role='listbox']")).toBeNull();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        const disabled = await mountSelect({disabled: true});
        expect(input(disabled).attributes("disabled")).toBeDefined();
    });
});
