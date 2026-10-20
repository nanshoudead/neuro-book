/**
 * 结构控件（docs/specs/ui/forms.md 输出 1、2、19、20、21、22 与“时序与寿命”）：对象、字符串列表、对象列表、左列表右
 * 详情、JSON、自定义控件与分组折叠。焦点落点用 `document.activeElement` 判定；真实浏览器里的键盘与可访问名称在应用
 * Lab 的 Playwright。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {Type} from "typebox";
import {defineComponent, h} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import SchemaField from "./SchemaField.vue";
import SchemaForm from "./SchemaForm.vue";
import type {DraftState} from "./scope";
import {defineFormWidgets, FormWidgetError} from "./widgets";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function mountForm(schema: object, value: unknown, props: Record<string, unknown> = {}) {
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

const buttonByLabel = (wrapper: VueWrapper, label: string) => wrapper.findAll("button").find((button) => button.attributes("aria-label") === label || button.text() === label);
const inputValues = (wrapper: VueWrapper, selector = "input") => wrapper.findAll(selector).map((input) => (input.element as HTMLInputElement).value);

async function edit(input: ReturnType<VueWrapper["get"]>, text: string, blur = true) {
    await input.trigger("focusin");
    (input.element as HTMLInputElement).value = text;
    await input.trigger("input");
    if (blur) await input.trigger("focusout");
    await flushPromises();
}

describe("对象", () => {
    const schema = Type.Object({
        server: Type.Object({host: Type.String({title: "主机"}), port: Type.Integer({title: "端口"})}, {title: "服务器"}),
        extra: Type.Optional(Type.Object({note: Type.String({title: "备注"})}, {title: "附加"})),
    });

    it("成员画成一组，组名是对象的标题；改一个成员只换这一支", async () => {
        const value = {server: {host: "a", port: 1}};
        const {wrapper, emitted} = await mountForm(schema, value);
        const group = wrapper.get("[data-nb-widget='object'] [role='group']");
        expect(document.getElementById(group.attributes("aria-labelledby")!)?.textContent?.replace("*", "").trim()).toBe("服务器（必填）");
        await edit(wrapper.findAll("input")[0]!, "b");
        expect(emitted).toEqual([{server: {host: "b", port: 1}}]);
    });

    it("缺值的可选对象：填一个成员就建出对象；有值时“清除”删去整个键", async () => {
        const {wrapper, emitted} = await mountForm(schema, {server: {host: "a", port: 1}});
        await edit(wrapper.findAll("input")[2]!, "n");
        expect(emitted.at(-1)).toEqual({server: {host: "a", port: 1}, extra: {note: "n"}});
        await buttonByLabel(wrapper, "清除：附加")!.trigger("click");
        expect(emitted.at(-1)).toEqual({server: {host: "a", port: 1}});
    });
});

describe("字符串列表（输出 19）", () => {
    const schema = Type.Object({tags: Type.Array(Type.String(), {title: "标签", minItems: 1, maxItems: 4})});

    it("添加后焦点进新项；删除中间项焦点到下一项的删除，删最后一项到上一项", async () => {
        const {wrapper, emitted} = await mountForm(schema, {tags: ["a", "b", "c"]});
        await wrapper.get("[data-nb-list-add]").trigger("click");
        await flushPromises();
        expect(emitted.at(-1)).toEqual({tags: ["a", "b", "c", ""]});
        expect(document.activeElement).toBe(wrapper.findAll("input")[3]!.element);
        expect(wrapper.get("[aria-live='polite']").text()).toBe("已添加第 4 项");
        // 到了 maxItems，添加停用。
        expect(wrapper.get("[data-nb-list-add]").attributes("disabled")).toBeDefined();

        await buttonByLabel(wrapper, "删除：第 2 项")!.trigger("click");
        await flushPromises();
        expect(emitted.at(-1)).toEqual({tags: ["a", "c", ""]});
        expect(document.activeElement?.getAttribute("aria-label")).toBe("删除：第 2 项");
        expect(inputValues(wrapper)).toEqual(["a", "c", ""]);

        await buttonByLabel(wrapper, "删除：第 3 项")!.trigger("click");
        await flushPromises();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("删除：第 2 项");
    });

    it("调用方晚些才把新值传回来（例如经过一次 RPC）：焦点等新项渲染出来才落；不采纳时什么也不动", async () => {
        const held: unknown[] = [];
        const wrapper = mount(SchemaForm, {
            attachTo: document.body,
            props: {schema, modelValue: {tags: ["a"]}, locale: "zh-CN", "onUpdate:modelValue": (next: unknown) => held.push(next)},
        });
        mounted.push(wrapper);
        await wrapper.get("[data-nb-list-add]").trigger("click");
        await flushPromises();
        expect(wrapper.findAll("input")).toHaveLength(1);
        // 传回来的是经过 JSON 的副本，不是发出的那个对象。
        await wrapper.setProps({modelValue: JSON.parse(JSON.stringify(held.pop())) as unknown});
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.findAll("input")[1]!.element);
        // 这次不采纳：值不变，焦点与项都不动。
        (wrapper.findAll("input")[0]!.element as HTMLInputElement).focus();
        await buttonByLabel(wrapper, "删除：第 2 项")!.trigger("click");
        await flushPromises();
        expect(wrapper.findAll("input")).toHaveLength(2);
        expect(document.activeElement).toBe(wrapper.findAll("input")[0]!.element);
    });

    it("删到 minItems 时删除停用；空列表显示“还没有项”", async () => {
        const {wrapper} = await mountForm(schema, {tags: ["a"]});
        expect(buttonByLabel(wrapper, "删除：第 1 项")!.attributes("disabled")).toBeDefined();
        const empty = await mountForm(Type.Object({tags: Type.Array(Type.String(), {title: "标签"})}), {tags: []});
        expect(empty.wrapper.text()).toContain("还没有项");
    });

    it("上移、Alt+↓ 排序：焦点跟着被移动的项，读屏播报移动结果", async () => {
        const {wrapper, emitted} = await mountForm(schema, {tags: ["a", "b", "c"]});
        await buttonByLabel(wrapper, "上移：第 2 项")!.trigger("click");
        await flushPromises();
        expect(emitted.at(-1)).toEqual({tags: ["b", "a", "c"]});
        // 移到了第一位，上移停用，焦点落到同一项的下移。
        expect(document.activeElement?.getAttribute("aria-label")).toBe("下移：第 1 项");
        expect(wrapper.get("[aria-live='polite']").text()).toBe("第 2 项移到第 1 位");
        const first = wrapper.findAll("input")[0]!;
        (first.element as HTMLInputElement).focus();
        await first.trigger("keydown", {key: "ArrowDown", altKey: true});
        await flushPromises();
        expect(emitted.at(-1)).toEqual({tags: ["a", "b", "c"]});
    });

    it("每个输入框的名字是“第 N 项”，组的名字是列表标题，组上带说明与出错", async () => {
        const schema = Type.Object({tags: Type.Array(Type.String(), {title: "标签", description: "每行一个", minItems: 3})});
        const {wrapper} = await mountForm(schema, {tags: ["a", "b"]});
        const inputs = wrapper.findAll("input");
        expect(inputs.map((input) => document.querySelector(`label[for="${input.attributes("id")!}"]`)?.textContent)).toEqual(["第 1 项", "第 2 项"]);
        const group = wrapper.get("[data-nb-widget='string-list'] [role='group']");
        expect(group.attributes("aria-invalid")).toBe("true");
        expect(group.attributes("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent)).toEqual(["至少 3 项", "每行一个"]);
    });

    it("连着两次同样的操作，读屏都念：播报的节点换新", async () => {
        const {wrapper} = await mountForm(schema, {tags: ["a", "b", "c"]});
        const live = () => wrapper.get("[aria-live='polite']").element.firstElementChild;
        await buttonByLabel(wrapper, "删除：第 1 项")!.trigger("click");
        await flushPromises();
        const first = live();
        await buttonByLabel(wrapper, "删除：第 1 项")!.trigger("click");
        await flushPromises();
        expect(live()?.textContent).toBe("已删除第 1 项");
        expect(live()).not.toBe(first);
    });

    it("项里的多行文字框上按 Alt+↑ 不排序，交给文字框自己", async () => {
        const items = Type.Object({notes: Type.Array(Type.Object({body: Type.String({title: "正文", "x-form": {widget: "multiline"}})}))});
        const {wrapper, emitted} = await mountForm(items, {notes: [{body: "a"}, {body: "b"}]});
        const textarea = wrapper.findAll("textarea")[1]!;
        const event = new KeyboardEvent("keydown", {key: "ArrowUp", altKey: true, bubbles: true, cancelable: true});
        textarea.element.dispatchEvent(event);
        await flushPromises();
        expect(event.defaultPrevented).toBe(false);
        expect(emitted).toEqual([]);
    });

    it("只读时没有结构操作", async () => {
        const {wrapper} = await mountForm(schema, {tags: ["a"]}, {readonly: true});
        expect(wrapper.find("[data-nb-list-add]").exists()).toBe(false);
        expect(wrapper.find("[data-nb-list-action]").exists()).toBe(false);
    });

    it("对象只差属性的先后也算重复，与核心的校验一致", async () => {
        const items = Type.Object({rows: Type.Array(Type.Object({a: Type.String(), b: Type.String()}), {uniqueItems: true})});
        const {wrapper} = await mountForm(items, {rows: [{a: "x", b: "y"}, {b: "y", a: "x"}]});
        expect(wrapper.findAll("[data-nb-list-item]").map((item) => item.find(".nb-form-list__duplicate").exists())).toEqual([false, true]);
    });

    it("uniqueItems 下的重复项标出来", async () => {
        const {wrapper} = await mountForm(Type.Object({tags: Type.Array(Type.String(), {uniqueItems: true})}), {tags: ["a", "b", "a"]});
        const items = wrapper.findAll("[data-nb-list-item]");
        expect(items.map((item) => item.text().includes("重复"))).toEqual([false, false, true]);
    });

    it("超过 50 项先折叠成“N 项”，展开后分页", async () => {
        const many = Array.from({length: 51}, (_, index) => `t${String(index)}`);
        const {wrapper} = await mountForm(Type.Object({tags: Type.Array(Type.String())}), {tags: many});
        expect(wrapper.findAll("[data-nb-list-item]")).toHaveLength(0);
        expect(wrapper.text()).toContain("51 项");
        await buttonByLabel(wrapper, "展开")!.trigger("click");
        expect(wrapper.findAll("[data-nb-list-item]")).toHaveLength(50);
        expect(wrapper.text()).toContain("第 1 / 2 页");
        await buttonByLabel(wrapper, "下一页")!.trigger("click");
        expect(inputValues(wrapper)).toEqual(["t50"]);
        // 删掉最后一页唯一的一项：页码收回到最后一页，内容与页码一致，“上一页”一次就到第 1 页。
        await buttonByLabel(wrapper, "删除：第 51 项")!.trigger("click");
        await flushPromises();
        expect(wrapper.text()).not.toContain("第 2 / 1 页");
        expect(inputValues(wrapper)[0]).toBe("t0");
    });
});

describe("对象列表（输出 19、验收 4）", () => {
    const schema = Type.Object({
        people: Type.Array(Type.Object({name: Type.String({title: "姓名"}), age: Type.Optional(Type.Integer({title: "年龄"}))}), {title: "人物", "x-form": {itemLabel: "name"}}),
    });

    it("项标题取 itemLabel 的字段，空时写“第 N 项”", async () => {
        const {wrapper} = await mountForm(schema, {people: [{name: "林"}, {name: ""}]});
        expect(wrapper.findAll(".nb-form-list__title").map((title) => title.text())).toEqual(["林", "第 2 项"]);
    });

    it("删掉前面的项后，后面那项的草稿跟着它走，不串到别的项上", async () => {
        const {wrapper, drafts} = await mountForm(schema, {people: [{name: "甲"}, {name: "乙"}, {name: "丙"}]});
        const ageOfThird = wrapper.findAll("[data-nb-list-item]")[2]!.findAll("input")[1]!;
        await edit(ageOfThird, "-");
        expect(drafts.at(-1)).toMatchObject({path: ["people", 2, "age"], state: "unparseable"});
        await buttonByLabel(wrapper, "删除：甲")!.trigger("click");
        await flushPromises();
        const items = wrapper.findAll("[data-nb-list-item]");
        expect(items.map((item) => (item.findAll("input")[1]!.element as HTMLInputElement).value)).toEqual(["", "-"]);
        expect(items.map((item) => item.find(".nb-form-list__title").text())).toEqual(["乙", "丙"]);
        // 旧路径上的草稿状态撤掉，在新路径上重报。
        expect(drafts.slice(-2)).toMatchObject([{path: ["people", 2, "age"], state: "clean"}, {path: ["people", 1, "age"], state: "unparseable"}]);
    });
});

describe("列表项的身份（时序与寿命）", () => {
    const schema = Type.Object({rows: Type.Array(Type.Object({n: Type.Optional(Type.Integer({title: "数"})), m: Type.Integer({title: "必填数"})}), {title: "行"})});
    const numberIn = (wrapper: VueWrapper, item: number, field: number) => wrapper.findAll("[data-nb-list-item]")[item]!.findAll("input")[field]!;

    it("两项都有写坏的草稿时互换位置：两条“无法解析”都还在", async () => {
        const {wrapper} = await mountForm(schema, {rows: [{m: 1}, {m: 2}]});
        await edit(numberIn(wrapper, 0, 0), "-");
        await edit(numberIn(wrapper, 1, 0), "-");
        await buttonByLabel(wrapper, "下移：第 1 项")!.trigger("click");
        await flushPromises();
        expect(wrapper.get("[data-nb-form-summary] button").text()).toBe("2 个问题");
    });

    it("“碰过”跟着项走：删掉前面一项后，后面那项的必填缺失照样显示", async () => {
        const {wrapper} = await mountForm(schema, {rows: [{}, {}]});
        const second = numberIn(wrapper, 1, 1);
        await second.trigger("focusin");
        await second.trigger("focusout");
        await flushPromises();
        expect(second.attributes("aria-invalid")).toBe("true");
        await buttonByLabel(wrapper, "删除：第 1 项")!.trigger("click");
        await flushPromises();
        expect(numberIn(wrapper, 0, 1).attributes("aria-invalid")).toBe("true");
        expect(numberIn(wrapper, 0, 1).element).toBe(second.element);
    });

    it("外部换成同样长度、内容不同的数组：重建身份，不把原来的草稿留给新的项", async () => {
        const {wrapper} = await mountForm(schema, {rows: [{n: 1, m: 1}, {n: 2, m: 2}]});
        const before = wrapper.findAll("[data-nb-list-item]").map((item) => item.attributes("data-nb-list-item"));
        await wrapper.setProps({modelValue: {rows: [{n: 10, m: 1}, {n: 20, m: 2}]}});
        await flushPromises();
        const after = wrapper.findAll("[data-nb-list-item]").map((item) => item.attributes("data-nb-list-item"));
        expect(after.some((id) => before.includes(id))).toBe(false);
        // 本表单自己的成员编辑不重建。
        await edit(numberIn(wrapper, 0, 0), "11");
        expect(wrapper.findAll("[data-nb-list-item]").map((item) => item.attributes("data-nb-list-item"))).toEqual(after);
    });

    it("两次操作都在调用方传回之前发出、再按顺序以副本传回：身份跟着最后采纳的结果", async () => {
        const held: unknown[] = [];
        const strings = Type.Object({tags: Type.Array(Type.String())});
        const wrapper = mount(SchemaForm, {attachTo: document.body, props: {schema: strings, modelValue: {tags: ["a", "b", "c"]}, locale: "zh-CN", "onUpdate:modelValue": (next: unknown) => held.push(next)}});
        mounted.push(wrapper);
        const idOf = (value: string) => wrapper.findAll("[data-nb-list-item]").find((item) => (item.get("input").element as HTMLInputElement).value === value)!.attributes("data-nb-list-item");
        const ids = {a: idOf("a"), b: idOf("b"), c: idOf("c")};
        await buttonByLabel(wrapper, "上移：第 2 项")!.trigger("click");
        // 调用方还没传回第一次的结果，第二次在原来的值上算：把 c 上移。
        await buttonByLabel(wrapper, "上移：第 3 项")!.trigger("click");
        for (const next of held.splice(0)) {
            await wrapper.setProps({modelValue: JSON.parse(JSON.stringify(next)) as unknown});
            await flushPromises();
        }
        expect(inputValues(wrapper)).toEqual(["a", "c", "b"]);
        expect([idOf("a"), idOf("c"), idOf("b")]).toEqual([ids.a, ids.c, ids.b]);
    });

    it("数字框里按 Alt+↑ 只排序，不步进数字", async () => {
        const {wrapper, emitted} = await mountForm(schema, {rows: [{n: 1, m: 1}, {n: 2, m: 2}]});
        const input = numberIn(wrapper, 1, 0);
        (input.element as HTMLInputElement).focus();
        await input.trigger("focusin");
        await input.trigger("keydown", {key: "ArrowUp", altKey: true});
        await flushPromises();
        await input.trigger("focusout");
        await flushPromises();
        expect(emitted).toEqual([{rows: [{n: 2, m: 2}, {n: 1, m: 1}]}]);
    });
});

describe("左列表右详情（输出 20）", () => {
    const item = Type.Object({name: Type.String({title: "名称"}), url: Type.Optional(Type.String({title: "地址"}))});
    const schema = Type.Object({servers: Type.Array(item, {title: "服务", "x-form": {widget: "master-detail", itemLabel: "name"}})});

    it("只挂载选中项的详情；选中区与操作按钮并列不嵌套；新增项自动选中并聚焦详情；删除选中项选中下一项", async () => {
        const {wrapper, emitted} = await mountForm(schema, {servers: [{name: "一"}, {name: "二"}, {name: "三"}]});
        expect(wrapper.findAll("[data-nb-detail]")).toHaveLength(1);
        expect(wrapper.findAll("button button")).toHaveLength(0);
        const select = () => wrapper.findAll("[data-nb-list-action='select']");
        expect(select()[0]!.attributes("aria-current")).toBe("true");
        await select()[1]!.trigger("click");
        expect((wrapper.get("[data-nb-detail] input").element as HTMLInputElement).value).toBe("二");

        await wrapper.get("[data-nb-list-add]").trigger("click");
        await flushPromises();
        expect(emitted.at(-1)).toEqual({servers: [{name: "一"}, {name: "二"}, {name: "三"}, {}]});
        expect(select()[3]!.attributes("aria-current")).toBe("true");
        expect(document.activeElement).toBe(wrapper.get("[data-nb-detail] input").element);

        await select()[1]!.trigger("click");
        await buttonByLabel(wrapper, "删除：二")!.trigger("click");
        await flushPromises();
        expect((wrapper.get("[data-nb-detail] input").element as HTMLInputElement).value).toBe("三");
    });

    it("在选中项上按 Alt+↑：选中跟着这一项走，与按“上移”一样", async () => {
        const {wrapper, emitted} = await mountForm(schema, {servers: [{name: "甲"}, {name: "乙"}, {name: "丙"}]});
        const select = () => wrapper.findAll("[data-nb-list-action='select']");
        await select()[1]!.trigger("click");
        await select()[1]!.trigger("keydown", {key: "ArrowUp", altKey: true});
        await flushPromises();
        expect(emitted.at(-1)).toEqual({servers: [{name: "乙"}, {name: "甲"}, {name: "丙"}]});
        expect((wrapper.get("[data-nb-detail] input").element as HTMLInputElement).value).toBe("乙");
        expect(select()[0]!.attributes("aria-current")).toBe("true");
    });

    it("SchemaField 的根是左列表右详情时，v-model:selected 由调用方接管", async () => {
        const selections: number[] = [];
        const wrapper = mount(SchemaField, {
            attachTo: document.body,
            props: {
                "schema": Type.Array(item, {"x-form": {widget: "master-detail", itemLabel: "name"}}),
                "modelValue": [{name: "一"}, {name: "二"}],
                "locale": "zh-CN",
                "selected": 1,
                "onUpdate:selected": (index: number) => selections.push(index),
            },
        });
        mounted.push(wrapper);
        expect((wrapper.get("[data-nb-detail] input").element as HTMLInputElement).value).toBe("二");
        await wrapper.findAll("[data-nb-list-action='select']")[0]!.trigger("click");
        expect(selections).toEqual([0]);
    });
});

describe("JSON 编辑（输出 1、15）", () => {
    const schema = Type.Object({extra: Type.Record(Type.String(), Type.Number(), {title: "扩展参数"})});

    it("写坏的 JSON 不提交、报无法解析；写对了提交；值按 schema 校验，问题报在这个字段上", async () => {
        const {wrapper, emitted} = await mountForm(schema, {extra: {a: 1}});
        const textarea = wrapper.get("[data-nb-widget='json'] textarea");
        expect((textarea.element as HTMLTextAreaElement).value).toBe("{\n  \"a\": 1\n}");
        await edit(textarea, "{\"a\": ");
        expect(emitted).toEqual([]);
        expect(textarea.attributes("aria-invalid")).toBe("true");
        await edit(textarea, "{\"a\": \"x\"}");
        expect(emitted).toEqual([{extra: {a: "x"}}]);
        expect(textarea.attributes("aria-invalid")).toBe("true");
    });
});

describe("自定义控件（输出 22）", () => {
    const Stars = defineComponent({
        name: "Stars",
        props: ["modelValue", "node", "readonly", "disabled", "invalid", "id", "labelledby", "describedby", "locale", "issues", "options", "meta"],
        emits: ["update:modelValue", "commit"],
        setup(props, {emit, expose}) {
            expose({focus: () => document.getElementById(String(props.id))?.focus()});
            return () => h("div", [
                h("button", {"id": props.id, "type": "button", "aria-describedby": props.describedby, "data-issues": String((props.issues as unknown[]).length), "onClick": () => emit("update:modelValue", Number(props.modelValue ?? 0) + 1)}, `★${String(props.modelValue ?? 0)}`),
                h("button", {type: "button", class: "done", onClick: () => emit("commit")}, "完成"),
            ]);
        },
    });
    const widgets = defineFormWidgets([{name: "stars", component: Stars, score: (node) => (node.hints.unit === "星" ? 5 : null)}]);

    it("登记的名字与内建控件或彼此重名时报错", () => {
        expect(() => defineFormWidgets([{name: "select", component: Stars}])).toThrow(FormWidgetError);
        expect(() => defineFormWidgets([{name: "x", component: Stars}, {name: "x", component: Stars}])).toThrow(expect.objectContaining({code: "duplicate-name"}));
    });

    it("写了名字直接选中，没写时按得分选；没登记的名字退回内建控件", async () => {
        const schema = Type.Object({
            a: Type.Integer({title: "甲", "x-form": {widget: "stars"}}),
            b: Type.Integer({title: "乙", "x-form": {unit: "星"}}),
            c: Type.Integer({title: "丙", "x-form": {widget: "unknown-widget"}}),
        });
        const {wrapper} = await mountForm(schema, {a: 1, b: 2, c: 3}, {widgets});
        expect(wrapper.findAll("[data-nb-widget]").map((node) => node.attributes("data-nb-widget"))).toEqual(["stars", "stars", "number"]);
        const star = wrapper.get("[data-nb-widget='stars'] button");
        const label = wrapper.get("[data-nb-widget='stars'] label");
        expect(label.attributes("for")).toBe(star.attributes("id"));
        expect(wrapper.findComponent({name: "Stars"}).props("labelledby")).toBe(label.attributes("id"));
    });

    it("发出的值是草稿：change 时等 commit 事件或焦点离开才提交；input 时立即提交", async () => {
        const schema = Type.Object({a: Type.Integer({title: "甲", minimum: 5, "x-form": {widget: "stars"}})});
        const {wrapper, emitted} = await mountForm(schema, {a: 1}, {widgets});
        const star = wrapper.get("[data-nb-widget='stars'] button");
        await star.trigger("click");
        await star.trigger("click");
        expect(star.text()).toBe("★3");
        expect(emitted).toEqual([]);
        await wrapper.get(".done").trigger("click");
        expect(emitted).toEqual([{a: 3}]);
        // 收到字段的问题与说明关联。
        expect(star.attributes("data-issues")).toBe("1");
        expect(document.getElementById(star.attributes("aria-describedby")!.split(" ")[0]!)?.textContent).toBe("不能小于 5");

        const instant = await mountForm(schema, {a: 1}, {widgets, commit: "input"});
        await instant.wrapper.get("[data-nb-widget='stars'] button").trigger("click");
        expect(instant.emitted).toEqual([{a: 2}]);
    });
});

describe("聚焦问题（输出 14）", () => {
    it("列表项里的问题：汇总写出项的标题，点它聚焦到那一项的那个字段", async () => {
        const schema = Type.Object({people: Type.Array(Type.Object({name: Type.String({title: "名字", minLength: 2})}), {title: "人物", "x-form": {itemLabel: "name"}})});
        const {wrapper} = await mountForm(schema, {people: [{name: "林照"}, {name: "x"}]});
        await wrapper.get("[data-nb-form-summary] button").trigger("click");
        const item = wrapper.get("[data-nb-form-summary] li button");
        expect(item.text()).toBe("人物 · x · 名字：至少 2 个字符");
        await item.trigger("click");
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.findAll("[data-nb-list-item]")[1]!.get("input").element);
    });

    it("折叠分组、未选中的详情里的问题：先打开再聚焦；去不了时不发 focus-issue", async () => {
        const schema = Type.Object({
            name: Type.String({title: "名称"}),
            servers: Type.Array(Type.Object({url: Type.String({title: "地址", minLength: 5})}), {title: "服务", "x-form": {widget: "master-detail"}}),
        });
        const layout = {type: "column", items: [{type: "field", path: "/name"}, {type: "group", label: "高级", collapsed: true, items: [{type: "field", path: "/servers"}]}]};
        const focused: unknown[] = [];
        const {wrapper} = await mountForm(schema, {name: "a", servers: [{url: "http://ok"}, {url: "x"}]}, {layout, onFocusIssue: (issue: unknown) => focused.push(issue)});
        expect(wrapper.find("[data-nb-detail]").exists()).toBe(false);
        const exposed = wrapper.vm as unknown as {focusFirstIssue(): Promise<boolean>; focusIssue(path: ReadonlyArray<string | number>): Promise<boolean>};
        expect(await exposed.focusFirstIssue()).toBe(true);
        await flushPromises();
        expect((document.activeElement as HTMLInputElement).value).toBe("x");
        expect(focused).toHaveLength(1);
        expect(await exposed.focusIssue(["nothing"])).toBe(false);
        expect(focused).toHaveLength(1);
    });
});

describe("分组折叠（输出 14、21）", () => {
    it("折叠的分组不挂载内容，标题旁标出里面的问题数；展开后挂载", async () => {
        const schema = Type.Object({name: Type.String({title: "名称"}), timeout: Type.Integer({title: "超时", maximum: 10})});
        const layout = {type: "column", items: [{type: "field", path: "/name"}, {type: "group", label: "高级", collapsed: true, items: [{type: "field", path: "/timeout"}]}]};
        const {wrapper} = await mountForm(schema, {name: "a", timeout: 99}, {layout});
        const toggle = wrapper.get("[aria-expanded]");
        expect(toggle.attributes("aria-expanded")).toBe("false");
        expect(wrapper.findAll("[data-nb-widget='number']")).toHaveLength(0);
        expect(toggle.text()).toContain("含 1 个问题");
        await toggle.trigger("click");
        expect(wrapper.findAll("[data-nb-widget='number']")).toHaveLength(1);
    });
});

describe("展示态里的结构", () => {
    it("对象列表照样画成结构，成员是静态的值，没有结构操作；JSON 可复制、短文字不给复制按钮", async () => {
        const schema = Type.Object({
            people: Type.Array(Type.Object({name: Type.String({title: "姓名"})})),
            extra: Type.Record(Type.String(), Type.Number(), {title: "扩展"}),
        });
        const {wrapper} = await mountForm(schema, {people: [{name: "林"}], extra: {a: 1}}, {mode: "view"});
        expect(wrapper.findAll("input, textarea")).toHaveLength(0);
        expect(wrapper.find("[data-nb-list-add]").exists()).toBe(false);
        expect(wrapper.text()).toContain("林");
        // 短的名字不给复制按钮，JSON 给。
        expect(wrapper.findAll(".nb-form-view button").map((button) => button.text())).toEqual(["复制"]);
    });
});
