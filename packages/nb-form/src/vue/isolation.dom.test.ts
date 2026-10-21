/**
 * 渲染层能脱离应用独立运行（docs/specs/ui/forms.md“边界与兼容”的依赖）：以后要打进生成式视图的沙箱，那里只有一个
 * 空文档，没有应用的插件、`provide` 与样式。这里用裸的 `createApp` 把每种内建控件、自定义控件、分组、条件显示都挂出来，
 * 编辑与展示态各一遍，再做几步会用到弹层与列表的操作；Vue 的警告与错误、未捕获的异常都算失败。
 *
 * 依赖只来自 `vue`、nb-ui 与核心，由 `boundary.test.ts` 机检；这里证明的是运行时也不需要宿主给任何东西。
 */

import {flushPromises} from "@vue/test-utils";
import {Type} from "typebox";
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {BUILTIN_WIDGETS} from "../model";
import type {FormLayout} from "../model";
import SchemaField from "./SchemaField.vue";
import SchemaForm from "./SchemaForm.vue";
import {defineFormWidgets} from "./widgets";

const many = (count: number) => Type.Union(Array.from({length: count}, (_, index) => Type.Literal(`o${String(index)}`)));

const Stars = defineComponent({
    props: {modelValue: {type: Number, default: 0}, id: {type: String, required: true}},
    emits: ["update:modelValue", "commit"],
    // 发出的值是草稿，`commit` 才提交（输出 22）。
    setup: (props, {emit}) => () => h("button", {
        id: props.id,
        type: "button",
        onClick: () => {
            emit("update:modelValue", props.modelValue + 1);
            emit("commit");
        },
    }, `${String(props.modelValue)} 星`),
});
const widgets = defineFormWidgets([{name: "stars", component: Stars}]);

/** 每种字段各一个；`writeOnly` 在密钥输入做好前按文字画（输出 2），这里不单列。 */
const SCHEMA = Type.Object({
    enabled: Type.Boolean({title: "开关"}),
    agreed: Type.Boolean({title: "确认", "x-form": {widget: "confirm"}}),
    size: Type.Union([Type.Literal("s"), Type.Literal("m")], {title: "横排单选"}),
    tone: Type.Union([Type.Literal("a"), Type.Literal("b")], {title: "竖排单选", "x-form": {widget: "radio"}}),
    level: many(6),
    city: many(20),
    tags: Type.Array(Type.Union([Type.Literal("x"), Type.Literal("y")]), {title: "多选", uniqueItems: true}),
    count: Type.Integer({title: "数字", minimum: 0, "x-form": {unit: "个"}}),
    name: Type.String({title: "文字", minLength: 1}),
    notes: Type.String({title: "多行", "x-form": {widget: "multiline"}}),
    alias: Type.Union([Type.String(), Type.Null()], {title: "可为 null"}),
    keywords: Type.Array(Type.String(), {title: "字符串列表"}),
    address: Type.Object({street: Type.String({title: "街道"})}, {title: "对象"}),
    people: Type.Array(Type.Object({name: Type.String({title: "名字"})}), {title: "对象列表"}),
    chapters: Type.Array(Type.Object({title: Type.String({title: "标题"})}), {title: "左列表右详情", "x-form": {widget: "master-detail", itemLabel: "title"}}),
    extra: Type.Record(Type.String(), Type.String(), {title: "JSON"}),
    rating: Type.Integer({title: "自定义", "x-form": {widget: "stars"}}),
    reason: Type.Optional(Type.String({title: "条件显示", "x-form": {visibleWhen: {field: "enabled", schema: {const: true}}}})),
});

const VALUE = {
    enabled: true, agreed: false, size: "s", tone: "a", level: "o0", city: "o0", tags: ["x"], count: 1, name: "林照", notes: "", alias: null,
    keywords: ["甲"], address: {street: ""}, people: [{name: "林照"}], chapters: [{title: "第一章"}], extra: {k: "v"}, rating: 2,
};

const field = (path: string): FormLayout => ({type: "field", path});
const LAYOUT: FormLayout = {
    type: "column",
    items: [
        ...Object.keys(SCHEMA.properties).filter((key) => key !== "notes" && key !== "extra").map((key) => field(`/${key}`)),
        {type: "group", label: {"zh-CN": "折叠的分组"}, collapsed: true, items: [field("/notes"), field("/extra")]},
    ],
};

interface Isolated {
    /** 卸载并撤掉窗口上的监听；重复调用无副作用。 */
    readonly unmount: () => void;
    readonly root: HTMLElement;
    readonly value: () => unknown;
    /** Vue 的警告与错误、未捕获的异常。 */
    readonly problems: string[];
}

const mounted: Isolated[] = [];
afterEach(() => {
    for (const {unmount} of mounted.splice(0)) unmount();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
});

/** 在空文档里用裸的 `createApp` 挂一个组件：不装插件、不 `provide`、不加样式。 */
function isolate(render: (value: () => unknown, update: (next: unknown) => void) => ReturnType<typeof h>, initial: unknown): Isolated {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    const root = document.createElement("div");
    document.body.append(root);
    const problems: string[] = [];
    const value = ref<unknown>(initial);
    const app = createApp({setup: () => () => render(() => value.value, (next) => (value.value = next))});
    app.config.warnHandler = (message) => problems.push(`warn: ${message}`);
    app.config.errorHandler = (error) => problems.push(`error: ${String(error)}`);
    const onError = (event: ErrorEvent) => problems.push(`uncaught: ${event.message}`);
    const onRejection = (event: PromiseRejectionEvent) => problems.push(`unhandled: ${String(event.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    app.mount(root);
    let unmounted = false;
    const isolated: Isolated = {
        unmount: () => {
            if (unmounted) return;
            unmounted = true;
            app.unmount();
            window.removeEventListener("error", onError);
            window.removeEventListener("unhandledrejection", onRejection);
        },
        root,
        value: () => value.value,
        problems,
    };
    mounted.push(isolated);
    return isolated;
}

/** 等渲染与 Promise 回调跑完（聚焦、弹层定位都在 `nextTick` 之后）。 */
const settle = async () => {
    await flushPromises();
    await nextTick();
};

const widgetsIn = (root: ParentNode) => new Set([...root.querySelectorAll("[data-nb-widget]")].map((node) => node.getAttribute("data-nb-widget")));

describe("空文档里独立运行", () => {
    it("编辑态：每种控件都画出来，增删、弹层、展开分组、提交都不需要宿主", async () => {
        const form = isolate((value, update) => h(SchemaForm, {"schema": SCHEMA, "layout": LAYOUT, "modelValue": value(), "locale": "zh-CN", widgets, "onUpdate:modelValue": update}), VALUE);
        await settle();
        const builtin = BUILTIN_WIDGETS.filter((widget) => widget !== "secret");
        // 折叠分组里的两种控件先不挂载。
        expect([...widgetsIn(form.root)].sort()).toEqual([...builtin.filter((widget) => widget !== "multiline" && widget !== "json"), "stars"].sort());

        [...form.root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("折叠的分组"))!.click();
        await settle();
        expect([...widgetsIn(form.root)].sort()).toEqual([...builtin, "stars"].sort());

        // 可搜索的下拉打开弹层（挂到 body）、选一项。
        form.root.querySelector<HTMLElement>("[data-nb-widget='search-select'] [role='combobox']")!.click();
        await settle();
        const option = [...document.querySelectorAll<HTMLElement>("[role='option']")].find((node) => node.textContent?.includes("o3"));
        expect(option).toBeDefined();
        option!.click();
        await settle();

        // 列表添加一项，自定义控件与开关改值。
        form.root.querySelector<HTMLButtonElement>("[data-nb-widget='object-list'] [data-nb-list-add]")!.click();
        await settle();
        form.root.querySelector<HTMLButtonElement>("[data-nb-widget='stars'] button")!.click();
        await settle();
        form.root.querySelector<HTMLElement>("[data-nb-widget='switch'] [role='switch']")!.click();
        await settle();

        expect(form.value()).toMatchObject({city: "o3", people: [{name: "林照"}, {}], rating: 3, enabled: false});
        expect(form.problems).toEqual([]);
    });

    it("展示态、只读与停用：同一份描述照样画出来", async () => {
        for (const props of [{mode: "view"}, {readonly: true}, {disabled: true}] as const) {
            const form = isolate((value) => h(SchemaForm, {schema: SCHEMA, layout: LAYOUT, modelValue: value(), locale: "en-US", widgets, ...props}), VALUE);
            await settle();
            expect(form.root.textContent).toContain("第一章");
            expect(form.problems).toEqual([]);
            form.unmount();
        }
    });

    it("没有成员的对象（命令的无参数）画成空表单，不退回 JSON", async () => {
        const form = isolate(() => h(SchemaForm, {schema: Type.Object({}, {additionalProperties: false}), modelValue: {}, locale: "zh-CN"}), {});
        await settle();
        expect(form.root.querySelector("textarea, input")).toBeNull();
        expect(form.problems).toEqual([]);
    });

    it("单个字段同样不需要宿主", async () => {
        const form = isolate((value, update) => h(SchemaField, {"schema": Type.Integer({minimum: 0}), "modelValue": value(), "locale": "zh-CN", "bare": true, "id": "solo", "onUpdate:modelValue": update}), 1);
        await settle();
        const input = form.root.querySelector<HTMLInputElement>("#solo")!;
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = "7";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await settle();
        expect(form.value()).toBe(7);
        expect(form.problems).toEqual([]);
    });
});
