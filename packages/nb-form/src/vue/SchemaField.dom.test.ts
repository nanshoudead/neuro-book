/**
 * 单个字段（docs/specs/ui/forms.md 接口 `SchemaField`、`widgetLayout`）：值就是字段的值；`bare` 时只画控件，名字由
 * 调用方的标签给。设置窗口的一行这样用它。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {Type} from "typebox";
import {defineComponent, h, ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import SchemaField from "./SchemaField.vue";
import {widgetLayout} from "./layout";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

describe("SchemaField", () => {
    it("bare：只有控件，id 来自调用方，调用方的 <label for> 给它名字；提交发出字段的值", async () => {
        const value = ref<unknown>(10);
        const Host = defineComponent({
            setup: () => () => h("div", [
                h("label", {for: "font-size"}, "字号"),
                h(SchemaField, {
                    "schema": Type.Integer({minimum: 8, "x-form": {unit: "px"}}),
                    "modelValue": value.value,
                    "locale": "zh-CN",
                    "id": "font-size",
                    "bare": true,
                    "onUpdate:modelValue": (next: unknown) => {
                        value.value = next;
                    },
                }),
            ]),
        });
        const wrapper = mount(Host, {attachTo: document.body});
        mounted.push(wrapper);
        const input = wrapper.get("input");
        expect(input.attributes("id")).toBe("font-size");
        expect(wrapper.findAll("label")).toHaveLength(1);
        expect(wrapper.text()).toContain("px");
        await input.trigger("focusin");
        (input.element as HTMLInputElement).value = "12";
        await input.trigger("input");
        await input.trigger("focusout");
        await flushPromises();
        expect(value.value).toBe(12);
        // 出错照样经 aria-describedby 给读屏。
        (input.element as HTMLInputElement).value = "4";
        await input.trigger("input");
        await input.trigger("focusout");
        await flushPromises();
        expect(value.value).toBe(4);
        expect(input.attributes("aria-invalid")).toBe("true");
        const described = input.attributes("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
        // 错误在前；单位也给读屏。
        expect(described).toEqual(["不能小于 8", "单位：px"]);
    });

    it("bare 的开关同样画出来，id 来自调用方", async () => {
        const wrapper = mount(SchemaField, {attachTo: document.body, props: {schema: Type.Boolean(), modelValue: true, locale: "zh-CN", bare: true, id: "autosave"}});
        mounted.push(wrapper);
        await wrapper.get("#autosave").trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
    });

    it("bare 的组合控件经 labelledby 取调用方标签的名字；hints 盖过 schema 的提示", async () => {
        const schema = Type.Union([Type.Literal("light"), Type.Literal("dark")], {"x-form": {widget: "select"}});
        const wrapper = mount(SchemaField, {
            attachTo: document.body,
            props: {schema, hints: {widget: "radio"}, modelValue: "light", locale: "zh-CN", bare: true, labelledby: "theme-label"},
        });
        mounted.push(wrapper);
        expect(wrapper.get("[data-nb-widget]").attributes("data-nb-widget")).toBe("radio");
        expect(wrapper.get("[role='radiogroup']").attributes("aria-labelledby")).toBe("theme-label");
        await wrapper.findAll("[role='radio']")[1]!.trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([["dark"]]);
    });
});

describe("SchemaField 的提交与问题", () => {
    it("根是对象时 commit() 提交成员的草稿（合成一个值），reset() 丢掉成员的草稿；commit() 显示全部问题", async () => {
        const schema = Type.Object({a: Type.String({title: "甲"}), b: Type.Optional(Type.Integer({title: "乙"})), c: Type.String({title: "丙"})});
        const wrapper = mount(SchemaField, {attachTo: document.body, props: {schema, modelValue: {a: "x"}, locale: "zh-CN"}});
        mounted.push(wrapper);
        const [a, b, c] = wrapper.findAll("input");
        await a!.trigger("focusin");
        (a!.element as HTMLInputElement).value = "new";
        await a!.trigger("input");
        await b!.trigger("focusin");
        (b!.element as HTMLInputElement).value = "3";
        await b!.trigger("input");
        const exposed = wrapper.vm as unknown as {commit(): boolean; reset(): void};
        expect(exposed.commit()).toBe(true);
        await flushPromises();
        expect(wrapper.emitted("update:modelValue")).toEqual([[{a: "new", b: 3}]]);
        // 必填缺失的“丙”在 commit() 之后标出来。
        expect(c!.attributes("aria-invalid")).toBe("true");
        await a!.trigger("focusin");
        (a!.element as HTMLInputElement).value = "draft";
        await a!.trigger("input");
        exposed.reset();
        await flushPromises();
        expect((a!.element as HTMLInputElement).value).toBe("x");
    });

    it("bare 时不引用外壳不画的说明，调用方的说明经 describedby 接在错误后面", async () => {
        const wrapper = mount(SchemaField, {
            attachTo: document.body,
            props: {schema: Type.String({minLength: 3, description: "至少三个字"}), modelValue: "a", locale: "zh-CN", bare: true, id: "f", describedby: "caller-help"},
        });
        mounted.push(wrapper);
        await wrapper.get("input").trigger("focusout");
        expect(wrapper.get("input").attributes("aria-describedby")).toBe("f-error caller-help");
    });

    it("写了没登记的自定义控件名：按这个种类的内建控件画，控件内部也照这个画法", async () => {
        const wrapper = mount(SchemaField, {
            attachTo: document.body,
            props: {schema: Type.Union([Type.Literal("a"), Type.Literal("b")], {"x-form": {widget: "unknown"}}), modelValue: "a", locale: "zh-CN"},
        });
        mounted.push(wrapper);
        expect(wrapper.get("[data-nb-widget]").attributes("data-nb-widget")).toBe("radio-row");
        expect(wrapper.find("[role='radiogroup']").exists()).toBe(true);
        expect(wrapper.find("[role='combobox']").exists()).toBe(false);
    });
});

describe("约束与选项名取自描述", () => {
    it("数字框按 schema 的范围与步长步进；输入框的长度取 schema", async () => {
        const stepped = async (schema: object, modelValue: number, button: "增加" | "减少") => {
            const wrapper = mount(SchemaField, {attachTo: document.body, props: {schema, modelValue, locale: "zh-CN", bare: true, id: "f"}});
            mounted.push(wrapper);
            const input = wrapper.get("#f");
            await input.trigger("focusin");
            await wrapper.get(`button[aria-label='${button}']`).trigger("click");
            await input.trigger("focusout");
            await flushPromises();
            return wrapper.emitted("update:modelValue")?.at(-1)?.[0] ?? modelValue;
        };
        const interval = Type.Integer({minimum: 5, maximum: 600});
        expect(await stepped(interval, 600, "增加")).toBe(600);
        expect(await stepped(interval, 5, "减少")).toBe(5);
        expect(await stepped(interval, 30, "增加")).toBe(31);
        expect(await stepped(Type.Number({multipleOf: 0.05}), 1, "增加")).toBe(1.05);
        const signature = mount(SchemaField, {attachTo: document.body, props: {schema: Type.String({minLength: 1, maxLength: 40}), modelValue: "x", locale: "zh-CN", bare: true, id: "s"}});
        mounted.push(signature);
        expect([signature.get("#s").attributes("minlength"), signature.get("#s").attributes("maxlength")]).toEqual(["1", "40"]);
    });

    it("选项名按显示语言取 choices 的名字；没写名字的数与布尔字面量显示它本身", () => {
        const appearance = Type.Union([Type.Literal("light"), Type.Literal("dark")]);
        const hints = {choices: [{value: "light", label: {"zh-CN": "浅色", "en-US": "Light"}}, {value: "dark", label: {"zh-CN": "深色", "en-US": "Dark"}}]};
        const english = mount(SchemaField, {attachTo: document.body, props: {schema: appearance, hints, modelValue: "light", locale: "en-US", bare: true, labelledby: "x"}});
        mounted.push(english);
        expect(english.findAll("[role='radiogroup'] label").map((label) => label.text())).toEqual(["Light", "Dark"]);
        const sizes = mount(SchemaField, {attachTo: document.body, props: {schema: Type.Union([Type.Literal(12), Type.Literal(14), Type.Literal(true)]), modelValue: 12, locale: "zh-CN", bare: true, labelledby: "x"}});
        mounted.push(sizes);
        expect(sizes.findAll("[role='radiogroup'] label").map((label) => label.text())).toEqual(["12", "14", "true"]);
    });
});

describe("widgetLayout", () => {
    it("按选出的控件给排法与宽度档位", () => {
        expect(widgetLayout(Type.Boolean())).toEqual({block: false, width: "content"});
        expect(widgetLayout(Type.Integer())).toEqual({block: false, width: "narrow"});
        expect(widgetLayout(Type.String())).toEqual({block: false, width: "wide"});
        expect(widgetLayout(Type.String(), {widget: "multiline"})).toEqual({block: true, width: "wide"});
        expect(widgetLayout(Type.Union([Type.Literal("a"), Type.Literal("b"), Type.Literal("c"), Type.Literal("d")]))).toEqual({block: false, width: "medium"});
        expect(widgetLayout(Type.Array(Type.String()))).toEqual({block: true, width: "wide"});
        expect(widgetLayout(Type.String(), {widget: "color-wheel"})).toEqual({block: true, width: "wide"});
    });
});
