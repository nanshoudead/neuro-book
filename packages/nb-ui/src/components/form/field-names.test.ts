/**
 * 字段的名字怎样到控件上（docs/specs/ui/forms.md 输出 27）：单个控件经 `<label for>`，组合控件经组形态的 `labelId` 与
 * `aria-labelledby`；组里的复选框看不到字段的上下文。读屏器按这些关联算可访问名称，这里核对关联指向的元素与文字。
 */

import {mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";
import {describe, expect, it} from "vitest";

import Switch from "../controls/Switch.vue";
import {Field, NB_FIELD_CONTEXT_KEY, useFieldContext} from "../index";
import CheckboxGroup from "./CheckboxGroup.vue";
import RadioGroup from "./RadioGroup.vue";

const OPTIONS = [{value: "a", label: "甲"}, {value: "b", label: "乙"}];

/** `aria-labelledby` 指向的元素的文字，按 id 的顺序连起来。 */
function labelledName(root: Element, control: Element): string {
    const ids = (control.getAttribute("aria-labelledby") ?? "").split(/\s+/u).filter(Boolean);
    return ids.map((id) => root.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? "").join(" ");
}

describe("字段的名字", () => {
    it("组形态：根不是 label；单选组的名字是字段标签，说明经 aria-describedby 关联", () => {
        const wrapper = mount(Field, {
            attachTo: document.body,
            props: {label: "状态", description: "新建时的状态", group: true},
            slots: {default: () => h(RadioGroup, {options: OPTIONS, modelValue: "a"})},
        });
        expect(wrapper.element.tagName).toBe("DIV");
        const group = wrapper.get("[role='radiogroup']");
        expect(labelledName(wrapper.element, group.element)).toBe("状态");
        const described = group.attributes("aria-describedby") ?? "";
        expect(wrapper.element.querySelector(`[id="${described}"]`)?.textContent).toBe("新建时的状态");
        wrapper.unmount();
    });

    it("复选组：名字与出错标在组上；组里的复选框不拿字段的 id，也不各自标红，id 互不相同", () => {
        const wrapper = mount(Field, {
            attachTo: document.body,
            props: {label: "题材", error: "至少选一项", group: true},
            slots: {default: () => h(CheckboxGroup, {options: OPTIONS, modelValue: []})},
        });
        const group = wrapper.get("[role='group']");
        expect(labelledName(wrapper.element, group.element)).toBe("题材");
        expect(group.attributes("aria-invalid")).toBe("true");
        const boxes = wrapper.findAll("input[type='checkbox']");
        expect(boxes).toHaveLength(2);
        expect(boxes.some((box) => box.attributes("aria-invalid") === "true")).toBe(false);
        const ids = boxes.map((box) => box.attributes("id"));
        expect(ids).not.toContain(group.attributes("id"));
        expect(new Set(ids.filter((id) => id !== undefined && id !== "")).size).toBe(ids.filter((id) => id !== undefined && id !== "").length);
        wrapper.unmount();
    });

    it("字段的必填、说明到组合控件与开关上", () => {
        const radios = mount(Field, {props: {label: "状态", required: true, group: true}, slots: {default: () => h(RadioGroup, {options: OPTIONS})}});
        expect(radios.get("[role='radiogroup']").attributes("aria-required")).toBe("true");
        const toggle = mount(Field, {attachTo: document.body, props: {label: "换行", description: "长行折到下一行"}, slots: {default: () => h(Switch, {modelValue: false})}});
        const described = toggle.get("button").attributes("aria-describedby") ?? "";
        expect(toggle.element.querySelector(`[id="${described}"]`)?.textContent).toBe("长行折到下一行");
        toggle.unmount();
    });

    it("开关没有缺省名称：在字段里经 label for 拿到字段标签；调用方给的名字照用", () => {
        const wrapper = mount(Field, {attachTo: document.body, props: {label: "自动换行"}, slots: {default: () => h(Switch, {modelValue: true})}});
        const button = wrapper.get("button[role='switch']");
        expect(button.attributes("aria-label")).toBeUndefined();
        expect(wrapper.element.tagName).toBe("LABEL");
        expect(button.attributes("id")).toBe(wrapper.attributes("for"));
        wrapper.unmount();
        const named = mount(Switch, {props: {modelValue: false, ariaLabel: "只看有差异的"}});
        expect(named.get("button").attributes("aria-label")).toBe("只看有差异的");
    });

    it("字段上下文从组件入口导出：别的包可以写自己的组合控件", () => {
        const Probe = defineComponent({
            setup: () => {
                const field = useFieldContext();
                return () => h("span", {"data-probe": field?.labelId.value ?? "none"});
            },
        });
        const wrapper = mount(Field, {props: {label: "书名", for: "title", group: true}, slots: {default: () => h(Probe)}});
        expect(wrapper.get("[data-probe]").attributes("data-probe")).toBe("title-label");
        expect(typeof NB_FIELD_CONTEXT_KEY).toBe("symbol");
    });
});
