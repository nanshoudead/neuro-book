/**
 * Schema 表单的渲染层（docs/specs/ui/forms.md）：控件选择落到 nb-ui 控件、受控提交与草稿、缺失与默认、选项与“已不存在”、
 * 问题的显示与汇总、展示态、条件显示。描述都用真实 TypeBox 生成。布局、指针与真实浏览器里的可访问名称在应用
 * Component Lab 的 Playwright。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {Type} from "typebox";
import {defineComponent, h, ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import type {OptionSource} from "../options";
import type {FormIssue} from "../validate";
import SchemaForm from "./SchemaForm.vue";
import type {DraftState} from "./scope";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Props = Record<string, unknown>;

/** 像调用方那样用 v-model：每次发出的根值写回 `modelValue`。 */
async function mountForm(schema: object, value: unknown, props: Props = {}) {
    const emitted: unknown[] = [];
    const drafts: DraftState[] = [];
    const wrapper = mount(SchemaForm, {
        attachTo: document.body,
        props: {
            schema,
            modelValue: value,
            locale: "zh-CN",
            ...props,
            "onUpdate:modelValue": (next: unknown) => {
                emitted.push(next);
                void wrapper.setProps({modelValue: next});
            },
            "onDraftState": (state: DraftState) => drafts.push(state),
        },
    });
    mounted.push(wrapper);
    await flushPromises();
    return {wrapper, emitted, drafts};
}

const field = (wrapper: VueWrapper, widget: string) => wrapper.get(`[data-nb-widget='${widget}']`);
const labelled = (id: string | undefined) => (id === undefined ? undefined : document.getElementById(id)?.textContent?.replace("*", "").trim());

async function typeInto(wrapper: VueWrapper, selector: string, text: string) {
    const input = wrapper.get(selector);
    await input.trigger("focusin");
    (input.element as HTMLInputElement).value = text;
    await input.trigger("input");
    await flushPromises();
    return input;
}

async function blur(wrapper: VueWrapper, selector: string) {
    await wrapper.get(selector).trigger("focusout");
    await flushPromises();
}

describe("控件选择（输出 2）", () => {
    it("按种类与项数选出 nb-ui 控件，标签就是控件的名字", async () => {
        const many = Array.from({length: 20}, (_, index) => Type.Literal(`m${String(index)}`));
        const schema = Type.Object({
            enabled: Type.Boolean({title: "启用"}),
            agreed: Type.Boolean({title: "同意", "x-form": {widget: "confirm"}}),
            format: Type.Union([Type.Literal("a"), Type.Literal("b")], {title: "格式"}),
            region: Type.Union([Type.Literal("cn"), Type.Literal("us"), Type.Literal("eu"), Type.Literal("jp")], {title: "地区"}),
            model: Type.Union(many, {title: "模型"}),
            tags: Type.Array(Type.Union([Type.Literal("x"), Type.Literal("y")]), {uniqueItems: true, title: "标签"}),
            timeout: Type.Integer({title: "超时"}),
            name: Type.String({title: "名称"}),
            notes: Type.String({title: "备注", "x-form": {widget: "multiline"}}),
        });
        const {wrapper} = await mountForm(schema, {});
        const widgets = wrapper.findAll("[data-nb-widget]").map((node) => node.attributes("data-nb-widget"));
        expect(widgets).toEqual(["switch", "confirm", "radio-row", "select", "search-select", "checkboxes", "number", "text", "multiline"]);

        // 单个控件靠 <label for> 命名，组合控件靠 aria-labelledby 指向标题。
        const name = field(wrapper, "text");
        expect(name.get("label").attributes("for")).toBe(name.get("input").attributes("id"));
        const sw = field(wrapper, "switch");
        expect(sw.get("label").attributes("for")).toBe(sw.get("[role='switch']").attributes("id"));
        for (const [widget, label] of [["radio-row", "格式"], ["confirm", "同意"], ["checkboxes", "标签"]] as const) {
            expect(labelled(field(wrapper, widget).get("[role='radiogroup'], [role='group']").attributes("aria-labelledby"))).toBe(label);
        }
    });

    it("固定选项的值可以是数与布尔，`1` 与 `\"1\"` 是两个选项，选中发出原来的字面量", async () => {
        const schema = Type.Object({level: Type.Union([Type.Literal(1), Type.Literal("1"), Type.Literal(true)])});
        const {wrapper, emitted} = await mountForm(schema, {});
        const radios = wrapper.findAll("[role='radio']");
        expect(radios).toHaveLength(3);
        await radios[0]!.trigger("click");
        await radios[1]!.trigger("click");
        expect(emitted).toEqual([{level: 1}, {level: "1"}]);
    });
});

describe("提交与草稿（输出 15、16）", () => {
    const schema = Type.Object({
        name: Type.String({title: "名称"}),
        nested: Type.Object({deep: Type.String()}),
        retries: Type.Optional(Type.Integer({title: "重试"})),
        timeout: Type.Number({title: "超时"}),
    });

    it("文字在失焦时提交一次，发出的根值只换了这一支，其余分支保留原引用；传入冻结的值也能用", async () => {
        const value = Object.freeze({name: "a", nested: Object.freeze({deep: "x"}), timeout: 1});
        const {wrapper, emitted} = await mountForm(schema, value);
        await typeInto(wrapper, "[data-nb-widget='text'] input", "ab");
        expect(emitted).toEqual([]);
        await blur(wrapper, "[data-nb-widget='text'] input");
        expect(emitted).toEqual([{name: "ab", nested: {deep: "x"}, timeout: 1}]);
        expect((emitted[0] as {nested: unknown}).nested).toBe(value.nested);
    });

    it("回车提交，之后的失焦不再发出", async () => {
        const {wrapper, emitted} = await mountForm(schema, {name: "a", nested: {deep: ""}, timeout: 1});
        const input = await typeInto(wrapper, "[data-nb-widget='text'] input", "b");
        await input.trigger("keydown", {key: "Enter"});
        await blur(wrapper, "[data-nb-widget='text'] input");
        expect(emitted).toEqual([{name: "b", nested: {deep: ""}, timeout: 1}]);
    });

    it("`commit: input` 时每次输入提交", async () => {
        const {wrapper, emitted} = await mountForm(schema, {name: "", nested: {deep: ""}, timeout: 1}, {commit: "input"});
        await typeInto(wrapper, "[data-nb-widget='text'] input", "a");
        await typeInto(wrapper, "[data-nb-widget='text'] input", "ab");
        expect(emitted.map((value) => (value as {name: string}).name)).toEqual(["a", "ab"]);
    });

    it("数字的草稿 `1.` 不提交，报 unparseable：字段标出错、汇总里列出；改成能解析的再提交", async () => {
        const {wrapper, emitted, drafts} = await mountForm(schema, {name: "", nested: {deep: ""}, timeout: 1});
        const timeout = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("超时"))!;
        const input = timeout.get("input");
        await input.trigger("focusin");
        (input.element as HTMLInputElement).value = "1.";
        await input.trigger("input");
        await input.trigger("focusout");
        await flushPromises();
        expect(emitted).toEqual([]);
        expect(drafts.at(-1)).toMatchObject({path: ["timeout"], state: "unparseable", issues: [{code: "unparseable"}]});
        expect(input.attributes("aria-invalid")).toBe("true");
        expect(wrapper.get("[data-nb-form-summary]").text()).toContain("1 个问题");
        await input.trigger("focusin");
        (input.element as HTMLInputElement).value = "1.5";
        await input.trigger("input");
        await input.trigger("focusout");
        await flushPromises();
        expect(emitted).toEqual([{name: "", nested: {deep: ""}, timeout: 1.5}]);
        expect(drafts.at(-1)).toMatchObject({state: "clean", issues: []});
    });

    it("字段随描述变化被拿掉时，它报过的“无法解析”从汇总里撤掉", async () => {
        const {wrapper} = await mountForm(schema, {name: "", nested: {deep: ""}, timeout: 1});
        const timeout = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("超时"))!.get("input");
        await timeout.trigger("focusin");
        (timeout.element as HTMLInputElement).value = "-";
        await timeout.trigger("input");
        await timeout.trigger("focusout");
        await flushPromises();
        expect(wrapper.get("[data-nb-form-summary]").attributes("data-nb-form-summary")).toBe("error");
        await wrapper.setProps({schema: Type.Object({name: Type.String(), nested: Type.Object({deep: Type.String()})})});
        await flushPromises();
        expect(wrapper.get("[data-nb-form-summary]").attributes("data-nb-form-summary")).toBe("none");
    });

    it("可选数字清空后离开是清除：删去这个键", async () => {
        const {wrapper, emitted} = await mountForm(schema, {name: "", nested: {deep: ""}, timeout: 1, retries: 3});
        const retries = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("重试"))!;
        const input = retries.get("input");
        await input.trigger("focusin");
        (input.element as HTMLInputElement).value = "";
        await input.trigger("input");
        await input.trigger("focusout");
        await flushPromises();
        expect(emitted).toEqual([{name: "", nested: {deep: ""}, timeout: 1}]);
    });

    it("`revision` 变化时没有焦点的字段丢掉草稿、回到实际值；有焦点的保留", async () => {
        const {wrapper} = await mountForm(schema, {name: "a", nested: {deep: ""}, timeout: 1});
        const input = await typeInto(wrapper, "[data-nb-widget='text'] input", "draft");
        await wrapper.setProps({revision: 1});
        expect((input.element as HTMLInputElement).value).toBe("draft");
        // 写坏了的数字失焦后留着草稿；调用方加一后回到实际值。
        const timeout = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("超时"))!.get("input");
        await timeout.trigger("focusin");
        (timeout.element as HTMLInputElement).value = "-";
        await timeout.trigger("input");
        await timeout.trigger("focusout");
        await wrapper.setProps({revision: 2});
        await flushPromises();
        expect((timeout.element as HTMLInputElement).value).toBe("1");
    });

    it("`commit()` 把几处草稿合成一个根值发出；有不可解析的草稿时返回 false", async () => {
        const {wrapper, emitted} = await mountForm(schema, {name: "a", nested: {deep: ""}, timeout: 1});
        await typeInto(wrapper, "[data-nb-widget='text'] input", "b");
        const timeout = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("超时"))!.get("input");
        (timeout.element as HTMLInputElement).value = "2";
        await timeout.trigger("input");
        const retries = wrapper.findAll("[data-nb-widget='number']").find((node) => node.text().includes("重试"))!.get("input");
        (retries.element as HTMLInputElement).value = "x";
        await retries.trigger("input");
        const exposed = wrapper.vm as unknown as {commit(): boolean};
        expect(exposed.commit()).toBe(false);
        await flushPromises();
        expect(emitted).toEqual([{name: "b", nested: {deep: ""}, timeout: 2}]);
    });
});

describe("缺失、默认与清除（输出 4、5）", () => {
    it("缺值不补默认：文字写“默认：X”占位，选择类不预选、标题旁写默认，开关显示默认状态并标“默认”", async () => {
        const schema = Type.Object({
            host: Type.Optional(Type.String({title: "地址", default: "localhost"})),
            mode: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("safe")], {title: "模式", default: "safe", "x-form": {choices: [{value: "fast", label: "快"}, {value: "safe", label: "稳"}]}})),
            beta: Type.Optional(Type.Boolean({title: "测试版", default: true})),
        });
        const {wrapper, emitted} = await mountForm(schema, {});
        expect(field(wrapper, "text").get("input").attributes("placeholder")).toBe("默认：localhost");
        expect(field(wrapper, "radio-row").text()).toContain("默认：稳");
        expect(field(wrapper, "radio-row").findAll("[role='radio'][data-state='checked']")).toHaveLength(0);
        expect(field(wrapper, "switch").get("[role='switch']").attributes("data-state")).toBe("checked");
        expect(field(wrapper, "switch").text()).toContain("默认");
        expect(emitted).toEqual([]);
    });

    it("可选字段有值时给“清除”，清除删去这个键；可为 null 的写 null；必填字段没有清除", async () => {
        const schema = Type.Object({
            name: Type.String({title: "名称"}),
            note: Type.Optional(Type.String({title: "备注"})),
            proxy: Type.Union([Type.String(), Type.Null()], {title: "代理"}),
        });
        const {wrapper, emitted} = await mountForm(schema, {name: "a", note: "n", proxy: "p"});
        const clears = wrapper.findAll("button").filter((button) => button.text() === "清除");
        expect(clears.map((button) => button.attributes("aria-label"))).toEqual(["清除：备注", "清除：代理"]);
        await clears[0]!.trigger("click");
        await clears[1]!.trigger("click");
        expect(emitted).toEqual([{name: "a", proxy: "p"}, {name: "a", proxy: null}]);
    });

    it("`readOnly` 的字段与表单的只读：控件只读、没有清除；停用时控件停用", async () => {
        const schema = Type.Object({id: Type.Optional(Type.String({title: "ID", readOnly: true})), name: Type.Optional(Type.String({title: "名称"}))});
        const {wrapper} = await mountForm(schema, {id: "x", name: "n"});
        const [id, name] = wrapper.findAll("input");
        expect(id!.attributes("readonly")).toBeDefined();
        expect(name!.attributes("readonly")).toBeUndefined();
        expect(wrapper.findAll("button").filter((button) => button.text() === "清除")).toHaveLength(1);
        await wrapper.setProps({readonly: true});
        expect(wrapper.findAll("input").every((input) => input.attributes("readonly") !== undefined)).toBe(true);
        await wrapper.setProps({readonly: false, disabled: true});
        expect(wrapper.findAll("input").every((input) => input.attributes("disabled") !== undefined)).toBe(true);
    });
});

describe("选项（输出 11、12）", () => {
    const schema = Type.Object({provider: Type.String({title: "服务商", "x-form": {options: "providers"}})});

    it("加载中：字段停用并写加载中；不可用：停用并显示原因", async () => {
        const source = ref<OptionSource>({status: "loading"});
        const {wrapper} = await mountForm(schema, {}, {options: {providers: source}});
        expect(field(wrapper, "select").get("button, [role='combobox']").attributes("disabled")).toBeDefined();
        expect(field(wrapper, "select").text()).toContain("加载中");
        source.value = {status: "unavailable", reason: "没有网络"};
        await flushPromises();
        expect(field(wrapper, "select").text()).toContain("没有网络");
    });

    it("`recommend` 只作标记：写在选项的说明里，不预选", async () => {
        const choice = Type.Object({speed: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("safe")], {"x-form": {recommend: ["safe"], choices: [{value: "fast", label: "快"}, {value: "safe", label: "稳", description: "少出错"}]}}))});
        const {wrapper} = await mountForm(choice, {});
        expect(wrapper.findAll("[role='radio'][data-state='checked']")).toHaveLength(0);
        expect(field(wrapper, "radio-row").text()).toContain("稳推荐 · 少出错");
    });

    it("当前值不在动态选项里：照常显示并标“已不存在”（警告，不标出错），值保留；选项变化不改值", async () => {
        const source = ref<OptionSource>({status: "ready", items: [{value: "a", label: "A"}]});
        const {wrapper, emitted} = await mountForm(schema, {provider: "gone"}, {options: {providers: source}});
        const select = field(wrapper, "select");
        expect(select.text()).toContain("gone（已不存在）");
        expect(select.find(".nb-form-field__warning").exists()).toBe(true);
        expect(select.get("[role='combobox']").attributes("aria-invalid")).toBeUndefined();
        source.value = {status: "ready", items: [{value: "b", label: "B"}]};
        await flushPromises();
        expect(emitted).toEqual([]);
    });
});

describe("问题的显示（输出 9、14）", () => {
    const schema = Type.Object({
        name: Type.String({title: "名称", minLength: 2}),
        email: Type.String({title: "邮箱"}),
        age: Type.Optional(Type.Integer({title: "年龄"})),
    });

    it("出错只标在控件上，第一条错误的文字经 aria-describedby 给读屏；字段下不插看得见的文字", async () => {
        const {wrapper} = await mountForm(schema, {name: "a", email: "x"});
        const input = wrapper.findAll("input")[0]!;
        expect(input.attributes("aria-invalid")).toBe("true");
        const described = input.attributes("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
        expect(described).toContain("至少 2 个字符");
        expect(document.getElementById(input.attributes("aria-describedby")!.split(" ")[0]!)?.className).toContain("sr-only");
    });

    it("必填缺失在字段碰过之后、或调用方要求聚焦第一条问题之后才显示", async () => {
        const {wrapper} = await mountForm(schema, {name: "ab"});
        const email = wrapper.findAll("input")[1]!;
        expect(email.attributes("aria-invalid")).toBeUndefined();
        expect(wrapper.get("[data-nb-form-summary]").attributes("data-nb-form-summary")).toBe("none");
        await email.trigger("focusin");
        await email.trigger("focusout");
        await flushPromises();
        expect(email.attributes("aria-invalid")).toBe("true");
    });

    it("调用方的问题与 schema 的一起显示；警告不标出错；汇总按字段顺序列出，点一条聚焦到字段并发出 focus-issue", async () => {
        const issues: FormIssue[] = [
            {path: ["age"], code: "too-young", params: {}, severity: "warning", source: "caller", message: {"zh-CN": "年纪偏小", "en-US": "Young"}},
            {path: ["email"], code: "taken", params: {}, severity: "error", source: "caller", message: "已被占用"},
        ];
        const focused: FormIssue[] = [];
        const {wrapper} = await mountForm(schema, {name: "a", email: "x", age: 3}, {issues, onFocusIssue: (issue: FormIssue) => focused.push(issue)});
        const [name, email, age] = wrapper.findAll("input");
        expect(age!.attributes("aria-invalid")).toBeUndefined();
        expect(wrapper.findAll(".nb-form-field__warning")).toHaveLength(1);
        const toggle = wrapper.get("[data-nb-form-summary] button");
        expect(toggle.text()).toBe("3 个问题");
        await toggle.trigger("click");
        const items = wrapper.findAll("[data-nb-form-summary] li button");
        expect(items.map((item) => item.text())).toEqual(["名称：至少 2 个字符", "邮箱：已被占用", "年龄：年纪偏小"]);
        await items[1]!.trigger("click");
        expect(document.activeElement).toBe(email!.element);
        expect(focused.map((issue) => issue.code)).toEqual(["taken"]);
        (wrapper.vm as unknown as {focusFirstIssue(): boolean}).focusFirstIssue();
        expect(document.activeElement).toBe(name!.element);
    });

    it("没有问题时汇总一行照样占位；关掉汇总时不画", async () => {
        const {wrapper} = await mountForm(schema, {name: "ab", email: "x"});
        expect(wrapper.find("[data-nb-form-summary]").exists()).toBe(true);
        await wrapper.setProps({summary: false});
        expect(wrapper.find("[data-nb-form-summary]").exists()).toBe(false);
    });
});

describe("展示态（输出 17）", () => {
    it("值画成静态文字，长文字折叠可展开，长的与多行的文字可复制（短值不给按钮）；Tab 只停在展开与复制按钮上；密钥只说有没有设置", async () => {
        const long = Array.from({length: 10}, (_, index) => `第 ${String(index + 1)} 行`).join("\n");
        const schema = Type.Object({
            path: Type.String({title: "路径"}),
            body: Type.String({title: "正文", "x-form": {widget: "multiline"}}),
            force: Type.Boolean({title: "强制"}),
            key: Type.Optional(Type.String({title: "密钥", writeOnly: true})),
            short: Type.String({title: "短文字"}),
        });
        const path = "/home/writer/novels/长夜行/第三卷/第二十七章 渡口的灯.md";
        const {wrapper} = await mountForm(schema, {path, body: long, force: true, key: "sk-secret", short: "短"}, {mode: "view"});
        expect(wrapper.findAll("input, textarea, [role='switch']")).toHaveLength(0);
        expect(wrapper.text()).toContain(path);
        expect(wrapper.text()).toContain("是");
        expect(wrapper.text()).toContain("已设置");
        expect(wrapper.text()).not.toContain("sk-secret");
        const buttons = wrapper.findAll(".nb-form-view button");
        expect(buttons.map((button) => button.text())).toEqual(["复制", "展开", "复制"]);
        const expand = buttons[1]!;
        expect(expand.attributes("aria-expanded")).toBe("false");
        await expand.trigger("click");
        expect(expand.attributes("aria-expanded")).toBe("true");
        const tabbable = [...(wrapper.element as HTMLElement).querySelectorAll<HTMLElement>("button, input, textarea, [tabindex]")].filter((element) => element.tabIndex >= 0);
        expect(tabbable.every((element) => element.tagName === "BUTTON" && element.closest(".nb-form-view, [data-nb-form-summary]") !== null)).toBe(true);
    });
});

describe("条件显示（输出 13）", () => {
    it("条件不满足时隐藏（inert，不卸载），值与草稿保留；满足时再显示", async () => {
        const schema = Type.Object({
            format: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")], {title: "格式"}),
            proxy: Type.Optional(Type.String({title: "代理", "x-form": {visibleWhen: {field: "format", schema: {const: "openai"}}}})),
        });
        const {wrapper} = await mountForm(schema, {format: "openai", proxy: "p"});
        const input = await typeInto(wrapper, "[data-nb-widget='text'] input", "draft");
        await input.trigger("focusout");
        // 失焦已提交草稿；再写一份留着，看隐藏后是否还在。
        await typeInto(wrapper, "[data-nb-widget='text'] input", "again");
        await wrapper.setProps({modelValue: {format: "anthropic", proxy: "draft"}});
        const node = wrapper.get("[data-nb-widget='text']").element.parentElement!;
        expect(node.style.display).toBe("none");
        expect(node.hasAttribute("inert")).toBe(true);
        await wrapper.setProps({modelValue: {format: "openai", proxy: "draft"}});
        expect(node.style.display).toBe("");
        expect((wrapper.get("[data-nb-widget='text'] input").element as HTMLInputElement).value).toBe("again");
    });
});

describe("表单根（输出 21）", () => {
    it("根是 role=group，不是 form；放在调用方的 form 里，回车不隐式提交", async () => {
        let submitted = 0;
        const schema = Type.Object({name: Type.String({title: "名称"})});
        const Host = defineComponent({
            setup: () => () => h("form", {onSubmit: (event: Event) => {
                event.preventDefault();
                submitted += 1;
            }}, [h(SchemaForm, {schema, modelValue: {name: ""}, locale: "zh-CN"})]),
        });
        const wrapper = mount(Host, {attachTo: document.body});
        mounted.push(wrapper);
        expect(wrapper.get("[role='group']").element.tagName).toBe("DIV");
        const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true});
        wrapper.get("input").element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(submitted).toBe(0);
    });
});

describe("文字（输出 24）", () => {
    it("按 locale 取内建文字与问题的写法", async () => {
        const schema = Type.Object({name: Type.String({minLength: 3, "x-form": {label: {"zh-CN": "名称", "en-US": "Name"}}})});
        const {wrapper} = await mountForm(schema, {name: "a"}, {locale: "en-US"});
        await wrapper.get("[data-nb-form-summary] button").trigger("click");
        expect(wrapper.get("[data-nb-form-summary]").text()).toContain("1 issue");
        expect(wrapper.get("[data-nb-form-summary] li").text()).toContain("At least 3 characters");
    });
});
