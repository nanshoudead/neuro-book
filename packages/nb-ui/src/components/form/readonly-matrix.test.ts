/**
 * 表单控件的统一合同（docs/specs/ui/forms.md 输出 26、28）：每种控件在“停用”“只读”下的键盘、指针与能否聚焦，`invalid`
 * 属性不经 `Field` 也标出错，写死的读屏名称可以覆盖。只读的控件可以聚焦、写 `aria-readonly`，交互不改值。
 */

import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import SegmentedControl from "../controls/SegmentedControl.vue";
import Switch from "../controls/Switch.vue";
import Checkbox from "./Checkbox.vue";
import CheckboxGroup from "./CheckboxGroup.vue";
import Input from "./Input.vue";
import NumberInput from "./NumberInput.vue";
import RadioGroup from "./RadioGroup.vue";
import SearchSelect from "./SearchSelect.vue";
import Select from "../popup/Select.vue";
import Textarea from "./Textarea.vue";

const OPTIONS = [{value: "a", label: "甲"}, {value: "b", label: "乙"}, {value: "c", label: "丙"}];

afterEach(() => {
    document.body.innerHTML = "";
});

describe("只读与停用（输出 28）", () => {
    it("开关：只读时可聚焦、点击与空格不切换；停用时不可聚焦", async () => {
        const readonly = mount(Switch, {props: {modelValue: true, readonly: true, ariaLabel: "换行"}, attachTo: document.body});
        const button = readonly.get("button[role='switch']");
        expect(button.attributes("aria-readonly")).toBe("true");
        expect(button.attributes("disabled")).toBeUndefined();
        await button.trigger("click");
        await button.trigger("keydown", {key: " "});
        expect(readonly.emitted("update:modelValue")).toBeUndefined();
        expect(button.attributes("aria-checked")).toBe("true");
        const disabled = mount(Switch, {props: {modelValue: false, disabled: true, ariaLabel: "换行"}});
        expect(disabled.get("button").attributes("disabled")).toBeDefined();
    });

    it("开关：只读而没给值时显示缺省值，切换也不改", async () => {
        const wrapper = mount(Switch, {props: {defaultValue: true, readonly: true, ariaLabel: "换行"}});
        await wrapper.get("button").trigger("click");
        expect(wrapper.get("button").attributes("aria-checked")).toBe("true");
    });

    it("复选框与复选组：只读时点击不改勾选、不发出变化；停用时输入框停用", async () => {
        const box = mount(Checkbox, {props: {modelValue: false, readonly: true, label: "隐藏文件"}, attachTo: document.body});
        const input = box.get("input");
        expect(input.attributes("aria-readonly")).toBe("true");
        await input.trigger("click");
        expect((input.element as HTMLInputElement).checked).toBe(false);
        expect(box.emitted("update:modelValue")).toBeUndefined();

        const group = mount(CheckboxGroup, {props: {modelValue: ["a"], readonly: true, options: OPTIONS}, attachTo: document.body});
        // group 角色不支持 aria-readonly：只读写在每个复选框上。
        expect(group.get("[role='group']").attributes("aria-readonly")).toBeUndefined();
        const boxes = group.findAll("input[type='checkbox']");
        expect(boxes.every((item) => item.attributes("aria-readonly") === "true")).toBe(true);
        await boxes[1]!.trigger("click");
        await boxes[0]!.trigger("click");
        expect(group.emitted("update:modelValue")).toBeUndefined();
        expect(boxes.map((item) => (item.element as HTMLInputElement).checked)).toEqual([true, false, false]);

        const disabled = mount(CheckboxGroup, {props: {modelValue: [], disabled: true, options: OPTIONS}});
        expect(disabled.findAll("input").every((item) => item.attributes("disabled") !== undefined)).toBe(true);
    });

    it("单选组：只读时点击别的项、方向键都不改选中；停用时各项停用", async () => {
        const wrapper = mount(RadioGroup, {props: {modelValue: "a", readonly: true, options: OPTIONS}, attachTo: document.body});
        expect(wrapper.get("[role='radiogroup']").attributes("aria-readonly")).toBe("true");
        const radios = wrapper.findAll("[role='radio']");
        await radios[1]!.trigger("click");
        await radios[0]!.trigger("keydown", {key: "ArrowDown"});
        await nextTick();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(radios.map((item) => item.attributes("aria-checked"))).toEqual(["true", "false", "false"]);
        const disabled = mount(RadioGroup, {props: {modelValue: "a", disabled: true, options: OPTIONS}});
        expect(disabled.findAll("[role='radio']").every((item) => item.attributes("disabled") !== undefined || item.attributes("data-disabled") !== undefined)).toBe(true);
    });

    it("分段控件：只读时点击别的项、方向键都不改选中，方向键只移动焦点；停用时各项停用", async () => {
        const wrapper = mount(SegmentedControl, {props: {modelValue: "a", readonly: true, options: OPTIONS}, attachTo: document.body});
        const group = wrapper.get("[role='radiogroup']");
        expect(group.attributes("aria-readonly")).toBe("true");
        const radios = wrapper.findAll("[role='radio']");
        expect(radios.every((item) => item.attributes("disabled") === undefined)).toBe(true);
        await radios[1]!.trigger("click");
        (radios[0]!.element as HTMLElement).focus();
        await radios[0]!.trigger("keydown", {key: "ArrowRight"});
        await nextTick();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(radios.map((item) => item.attributes("aria-checked"))).toEqual(["true", "false", "false"]);
        expect(document.activeElement).toBe(radios[1]!.element);
        const disabled = mount(SegmentedControl, {props: {modelValue: "a", disabled: true, options: OPTIONS}});
        expect(disabled.findAll("[role='radio']").every((item) => item.attributes("disabled") !== undefined)).toBe(true);
        await disabled.findAll("[role='radio']")[1]!.trigger("click");
        expect(disabled.emitted("update:modelValue")).toBeUndefined();
    });

    it("分段控件：当前值对应停用项（表单里“已不存在”的值）时 Tab 停在第一个启用项；整组停用时没有停靠点", async () => {
        const options = [{value: "gone", label: "已不存在", disabled: true}, ...OPTIONS];
        const wrapper = mount(SegmentedControl, {props: {modelValue: "gone", options}, attachTo: document.body});
        expect(wrapper.findAll("[role='radio']").map((item) => item.attributes("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
        await wrapper.setProps({disabled: true});
        expect(wrapper.findAll("[role='radio']").every((item) => item.attributes("tabindex") === "-1")).toBe(true);
        await wrapper.setProps({disabled: false, modelValue: "b"});
        expect(wrapper.findAll("[role='radio']").map((item) => item.attributes("tabindex"))).toEqual(["-1", "-1", "0", "-1"]);
    });

    // 浮层一直关着，选项不挂载，也就没有逐字查找；Lab 的真实浏览器用例另验（neuro-book 的 e2e/lab-nb-ui.e2e.ts）。
    it("下拉：只读时触发器可聚焦、回车不打开浮层；停用时触发器停用", async () => {
        const wrapper = mount(Select, {props: {modelValue: "a", readonly: true, options: OPTIONS}, attachTo: document.body});
        const trigger = wrapper.get("[role='combobox']");
        expect(trigger.attributes("aria-readonly")).toBe("true");
        expect(trigger.attributes("disabled")).toBeUndefined();
        await trigger.trigger("keydown", {key: "Enter"});
        await nextTick();
        await nextTick();
        expect(document.querySelector("[role='listbox']")).toBeNull();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(trigger.text()).toContain("甲");
        const disabled = mount(Select, {props: {modelValue: "a", disabled: true, options: OPTIONS}});
        expect(disabled.get("[role='combobox']").attributes("disabled")).toBeDefined();
    });

    it("单行、多行、数字：只读是原生 readonly；数字的微调按钮在只读时停用", () => {
        expect(mount(Input, {props: {modelValue: "x", readonly: true}}).get("input").attributes("readonly")).toBeDefined();
        expect(mount(Textarea, {props: {modelValue: "x", readonly: true}}).get("textarea").attributes("readonly")).toBeDefined();
        const number = mount(NumberInput, {props: {modelValue: "3", readonly: true}});
        expect(number.get("input").attributes("readonly")).toBeDefined();
        expect(number.findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    });
});

describe("只读与可编辑之间切换、没给值时（输出 26、28）", () => {
    it("下拉：以只读挂载、再改成可编辑后能打开；变成只读时关掉已开的浮层", async () => {
        const wrapper = mount(Select, {props: {modelValue: "a", readonly: true, options: OPTIONS}, attachTo: document.body});
        await wrapper.setProps({readonly: false});
        await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
        await nextTick();
        await nextTick();
        expect(document.querySelectorAll("[role='listbox']")).toHaveLength(1);
        await wrapper.setProps({readonly: true});
        await nextTick();
        // 退场动画期间浮层还在 DOM 里，看触发器的状态。
        expect(wrapper.get("[role='combobox']").attributes("aria-expanded")).toBe("false");
    });

    it("开关与单选组没给值：只读时不改，改成可编辑后照常切换并显示", async () => {
        const toggle = mount(Switch, {props: {defaultValue: false, readonly: true, ariaLabel: "x"}});
        await toggle.get("button").trigger("click");
        expect(toggle.get("button").attributes("aria-checked")).toBe("false");
        await toggle.setProps({readonly: false});
        await toggle.get("button").trigger("click");
        expect(toggle.get("button").attributes("aria-checked")).toBe("true");
        expect(toggle.emitted("update:modelValue")).toEqual([[true]]);

        const radios = mount(RadioGroup, {props: {defaultValue: "a", readonly: true, options: OPTIONS}, attachTo: document.body});
        await radios.findAll("[role='radio']")[1]!.trigger("click");
        expect(radios.findAll("[role='radio']").map((item) => item.attributes("aria-checked"))).toEqual(["true", "false", "false"]);
        await radios.setProps({readonly: false});
        await radios.findAll("[role='radio']")[1]!.trigger("click");
        expect(radios.findAll("[role='radio']").map((item) => item.attributes("aria-checked"))).toEqual(["false", "true", "false"]);
        expect(radios.emitted("update:modelValue")).toEqual([["b"]]);
    });

    it("复选框与复选组没给值：勾选记在组件里，发出的值累计、与原生框一致", async () => {
        const group = mount(CheckboxGroup, {props: {options: OPTIONS}, attachTo: document.body});
        const boxes = group.findAll("input[type='checkbox']");
        await boxes[0]!.trigger("click");
        await boxes[1]!.trigger("click");
        expect(group.emitted("update:modelValue")).toEqual([[["a"]], [["a", "b"]]]);
        expect(boxes.map((item) => (item.element as HTMLInputElement).checked)).toEqual([true, true, false]);

        const box = mount(Checkbox, {props: {label: "x"}, attachTo: document.body});
        await box.get("input").trigger("click");
        await nextTick();
        expect(box.emitted("update:modelValue")).toEqual([[true]]);
        expect((box.get("input").element as HTMLInputElement).checked).toBe(true);
    });

    it("受控的复选框：调用方不采纳变化时原生框摆回当前值", async () => {
        const box = mount(Checkbox, {props: {modelValue: false, label: "x"}, attachTo: document.body});
        await box.get("input").trigger("click");
        await nextTick();
        expect(box.emitted("update:modelValue")).toEqual([[true]]);
        expect((box.get("input").element as HTMLInputElement).checked).toBe(false);
    });
});

describe("统一的属性（输出 26）", () => {
    it("invalid 不经 Field 也写 aria-invalid", () => {
        expect(mount(Input, {props: {modelValue: "", invalid: true}}).get("input").attributes("aria-invalid")).toBe("true");
        expect(mount(Textarea, {props: {modelValue: "", invalid: true}}).get("textarea").attributes("aria-invalid")).toBe("true");
        expect(mount(NumberInput, {props: {modelValue: "", invalid: true}}).get("input").attributes("aria-invalid")).toBe("true");
        expect(mount(Checkbox, {props: {modelValue: false, invalid: true}}).get("input").attributes("aria-invalid")).toBe("true");
        expect(mount(Switch, {props: {modelValue: false, invalid: true, ariaLabel: "x"}}).get("button").attributes("aria-invalid")).toBe("true");
        expect(mount(RadioGroup, {props: {options: OPTIONS, invalid: true}}).get("[role='radiogroup']").attributes("aria-invalid")).toBe("true");
        expect(mount(SegmentedControl, {props: {modelValue: "a", options: OPTIONS, invalid: true}}).get("[role='radiogroup']").attributes("aria-invalid")).toBe("true");
        expect(mount(CheckboxGroup, {props: {options: OPTIONS, invalid: true}}).get("[role='group']").attributes("aria-invalid")).toBe("true");
        expect(mount(Select, {props: {options: OPTIONS, invalid: true}, attachTo: document.body}).get("[role='combobox']").attributes("aria-invalid")).toBe("true");
        const search = mount(SearchSelect, {props: {options: OPTIONS, invalid: true}, attachTo: document.body});
        expect(search.get("input[role='combobox']").attributes("aria-invalid")).toBe("true");
        expect(search.get("[data-nb-search-select]").classes()).toContain("nb-ui-control-invalid");
    });

    it("出错有外观：单选圆钮、开关与分段控件的外框描红；复选组里每个框描红，aria-invalid 只在组上", () => {
        const danger = (classes: string) => classes.includes("--status-danger");
        const radio = mount(RadioGroup, {props: {options: OPTIONS, invalid: true}});
        expect(radio.findAll("[role='radio']").every((item) => danger(item.classes().join(" ")))).toBe(true);
        expect(danger(mount(RadioGroup, {props: {options: OPTIONS}}).get("[role='radio']").classes().join(" "))).toBe(false);
        expect(danger(mount(Switch, {props: {invalid: true, ariaLabel: "x"}}).get("button").classes().join(" "))).toBe(true);
        expect(danger(mount(SegmentedControl, {props: {modelValue: "a", options: OPTIONS, invalid: true}}).get("[role='radiogroup']").classes().join(" "))).toBe(true);
        expect(danger(mount(SegmentedControl, {props: {modelValue: "a", options: OPTIONS}}).get("[role='radiogroup']").classes().join(" "))).toBe(false);
        const group = mount(CheckboxGroup, {props: {options: OPTIONS, invalid: true}});
        const marks = group.findAll("input[type='checkbox'] + span");
        expect(marks).toHaveLength(3);
        expect(marks.every((mark) => danger(mark.classes().join(" ")))).toBe(true);
        // 勾选时选中色与描红同特指度：描红要用 important 才压得过（真实浏览器的颜色见截图取证）。
        const checked = mount(Checkbox, {props: {modelValue: true, invalid: true}});
        expect(checked.get("input + span").classes()).toContain("!border-[color:var(--status-danger)]");
        expect(group.findAll("input").some((input) => input.attributes("aria-invalid") !== undefined)).toBe(false);
    });

    it("modelValue 不给时有安全的显示：没有选中、没有勾选、空文字", () => {
        expect(mount(RadioGroup, {props: {options: OPTIONS}}).findAll("[role='radio']").map((item) => item.attributes("aria-checked"))).toEqual(["false", "false", "false"]);
        expect(mount(CheckboxGroup, {props: {options: OPTIONS}}).findAll("input").map((item) => (item.element as HTMLInputElement).checked)).toEqual([false, false, false]);
        expect(mount(Switch, {props: {ariaLabel: "x"}}).get("button").attributes("aria-checked")).toBe("false");
        expect((mount(Input, {props: {}}).get("input").element as HTMLInputElement).value).toBe("");
        expect(mount(Select, {props: {options: OPTIONS, placeholder: "选一个"}, attachTo: document.body}).get("[role='combobox']").text()).toContain("选一个");
    });

    it("写死的读屏名称可以按语言覆盖：清空输入、增加、减少", () => {
        const input = mount(Input, {props: {modelValue: "x", clearable: true, clearLabel: "Clear"}});
        expect(input.get("button").attributes("aria-label")).toBe("Clear");
        const number = mount(NumberInput, {props: {modelValue: "1", incrementLabel: "Increase", decrementLabel: "Decrease"}});
        expect(number.findAll("button").map((button) => button.attributes("aria-label"))).toEqual(["Increase", "Decrease"]);
    });
});
