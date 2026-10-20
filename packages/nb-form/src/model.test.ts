/**
 * 字段树、种类与控件选择（docs/specs/ui/forms.md 输出 1、2）。schema 都用真实的 TypeBox 生成，与手写 JSON 对照。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {fallbackWidget} from "./fallback";
import {findNode, itemNode, kindOf, MAX_DEPTH, resolveForm} from "./model";
import type {FieldKind, FieldNode} from "./model";
import {optionKey, optionValue} from "./options";

const child = (node: FieldNode, name: string) => node.children.find((entry) => entry.path[entry.path.length - 1] === name)!;

describe("种类：TypeBox 生成的写法与手写 JSON", () => {
    const cases: Array<[string, object, FieldKind]> = [
        ["布尔", Type.Boolean(), "boolean"],
        ["字面量联合", Type.Union([Type.Literal("a"), Type.Literal("b")]), "choice"],
        ["手写 enum", {enum: ["a", "b"]}, "choice"],
        ["数与布尔字面量", Type.Union([Type.Literal(1), Type.Literal(true)]), "choice"],
        ["整数", Type.Integer({minimum: 1}), "number"],
        ["数", Type.Number(), "number"],
        ["文字", Type.String(), "text"],
        ["可为 null 的文字", Type.Union([Type.String(), Type.Null()]), "text"],
        ["不许重复的字面量联合数组", Type.Array(Type.Union([Type.Literal("x"), Type.Literal("y")]), {uniqueItems: true}), "multi"],
        ["允许重复的字面量联合数组", Type.Array(Type.Union([Type.Literal("x"), Type.Literal("y")])), "json"],
        ["字符串数组", Type.Array(Type.String()), "string-list"],
        ["对象", Type.Object({a: Type.String()}), "object"],
        ["对象数组", Type.Array(Type.Object({a: Type.String()})), "object-list"],
        ["Record", Type.Record(Type.String(), Type.String()), "json"],
        ["开放对象", Type.Object({}), "json"],
        ["写明 additionalProperties: true 与省略一样", {type: "object", properties: {name: {type: "string"}}, additionalProperties: true}, "object"],
        ["整数数组", Type.Array(Type.Integer()), "json"],
        ["其它联合", Type.Union([Type.String(), Type.Number()]), "json"],
        ["引用", {$defs: {n: {type: "string"}}, $ref: "#/$defs/n"}, "json"],
    ];
    for (const [name, schema, kind] of cases) {
        it(name, () => expect(kindOf(schema)).toBe(kind));
    }

    it("超过深度上限的部分用 JSON 编辑，字段不消失", () => {
        let schema: object = Type.Object({leaf: Type.String()});
        for (let depth = 0; depth < MAX_DEPTH + 2; depth += 1) schema = Type.Object({next: schema});
        let node = resolveForm(schema).root;
        let levels = 0;
        while (node.kind === "object") {
            node = node.children[0]!;
            levels += 1;
        }
        expect(levels).toBe(MAX_DEPTH);
        expect(node.kind).toBe("json");
    });
});

describe("字段树", () => {
    it("必填来自父对象的 required，只读向下传，标题与说明取提示、title 或属性名", () => {
        const schema = Type.Object({
            id: Type.String({readOnly: true, title: "ID"}),
            name: Type.Optional(Type.String({"x-form": {label: {"zh-CN": "名称", "en-US": "Name"}, help: "显示用"}})),
            meta: Type.Object({note: Type.String()}, {readOnly: true}),
        });
        const root = resolveForm(schema).root;
        expect(child(root, "id")).toMatchObject({required: true, readOnly: true, label: "ID"});
        expect(child(root, "name")).toMatchObject({required: false, readOnly: false, label: {"zh-CN": "名称", "en-US": "Name"}, help: "显示用"});
        expect(child(child(root, "meta"), "note")).toMatchObject({readOnly: true, path: ["meta", "note"]});
    });

    it("可为 null 的字段按内层的种类，标为 nullable；内外两层的注解合并", () => {
        const root = resolveForm(Type.Object({
            n: Type.Union([Type.Integer(), Type.Null()]),
            key: Type.Union([Type.String(), Type.Null()], {writeOnly: true}),
            note: Type.Union([Type.String({"x-form": {widget: "multiline"}}), Type.Null()], {title: "备注"}),
        })).root;
        expect(child(root, "n")).toMatchObject({kind: "number", nullable: true});
        expect(child(root, "key")).toMatchObject({writeOnly: true, widget: "secret"});
        expect(child(root, "note")).toMatchObject({widget: "multiline", label: "备注"});
    });

    it("自引用的 JS 对象不让解析抛异常", () => {
        const schema: Record<string, unknown> = {type: "string"};
        schema.default = schema;
        expect(resolveForm(schema).root.kind).toBe("text");
    });

    it("列表元素的字段按实际下标定位", () => {
        const root = resolveForm(Type.Object({rows: Type.Array(Type.Object({a: Type.String()}))})).root;
        const second = itemNode(child(root, "rows"), 2)!;
        expect(second.path).toEqual(["rows", 2]);
        expect(second.children[0]!.path).toEqual(["rows", 2, "a"]);
    });

    it("选项名按值与类型对上 x-form.choices，没对上的用值本身", () => {
        const schema = Type.Union([Type.Literal(1), Type.Literal("1"), Type.Literal(true)], {"x-form": {choices: [{value: "1", label: "字符串一"}, {value: true, label: "是", disabled: true}]}});
        const node = resolveForm(schema).root;
        expect(node.choices).toEqual([{value: 1, label: "1"}, {value: "1", label: "字符串一"}, {value: true, label: "是", disabled: true}]);
    });

    it("x-form 的数组里写错的项只丢掉那一项", () => {
        const schema = Type.Union([Type.Literal("a"), Type.Literal("b")], {"x-form": {choices: [{value: "a", label: "甲"}, {value: {}, label: "坏"}], recommend: ["b", null]}});
        const node = resolveForm(schema).root;
        expect(node.choices).toEqual([{value: "a", label: "甲"}, {value: "b", label: "b"}]);
        expect(node.hints.recommend).toEqual(["b"]);
    });

    it("按 JSON Pointer 找字段：属性名里的 / 与 ~ 要转义", () => {
        const root = resolveForm(Type.Object({"a/b": Type.String(), "c~d": Type.String(), a: Type.Object({b: Type.String()})})).root;
        expect(findNode(root, "/a~1b")?.path).toEqual(["a/b"]);
        expect(findNode(root, "/c~0d")?.path).toEqual(["c~d"]);
        expect(findNode(root, "/a/b")?.path).toEqual(["a", "b"]);
    });

    it("没有布局时按属性顺序；布局漏写的字段补在末尾", () => {
        const schema = Type.Object({a: Type.String(), b: Type.String(), c: Type.String()});
        expect(resolveForm(schema).layout).toEqual({type: "column", items: [{type: "field", path: "/a"}, {type: "field", path: "/b"}, {type: "field", path: "/c"}]});
        const layout = {type: "row", items: [{type: "field", path: "/c"}, {type: "field", path: "/a"}]} as const;
        expect(resolveForm(schema, {layout}).layout).toEqual({type: "column", items: [layout, {type: "field", path: "/b"}]});
    });
});

describe("控件选择（输出 2）", () => {
    const widgetOf = (schema: object) => resolveForm(schema).root.widget;
    const literals = (count: number) => Type.Union(Array.from({length: count}, (_, index) => Type.Literal(`v${String(index)}`)));
    const cases: Array<[string, object, FieldNode["widget"]]> = [
        ["布尔用开关", Type.Boolean(), "switch"],
        ["confirm 用是 / 否", Type.Boolean({"x-form": {widget: "confirm"}}), "confirm"],
        ["3 项以内横排单选", literals(3), "radio-row"],
        ["4 项用下拉", literals(4), "select"],
        ["16 项用可搜索的下拉", literals(16), "search-select"],
        ["searchable 用可搜索的下拉", Type.Union([Type.Literal("a"), Type.Literal("b")], {"x-form": {searchable: true}}), "search-select"],
        ["动态选项缺省用下拉", Type.String({"x-form": {options: "models"}}), "select"],
        ["动态选项可以搜索", Type.String({"x-form": {options: "models", searchable: true}}), "search-select"],
        ["多选用复选组", Type.Array(literals(2), {uniqueItems: true}), "checkboxes"],
        ["多行", Type.String({"x-form": {widget: "multiline"}}), "multiline"],
        ["writeOnly 用密钥输入", Type.String({writeOnly: true}), "secret"],
        ["字符串列表", Type.Array(Type.String()), "string-list"],
        ["对象列表", Type.Array(Type.Object({a: Type.String()})), "object-list"],
        ["左列表右详情", Type.Array(Type.Object({a: Type.String()}), {"x-form": {widget: "master-detail"}}), "master-detail"],
        ["JSON 兜底", Type.Record(Type.String(), Type.String()), "json"],
        ["自定义控件", Type.String({"x-form": {widget: "color-swatch"}}), {custom: "color-swatch"}],
        ["list 是列表缺省画法的别名", Type.Array(Type.String(), {"x-form": {widget: "list"}}), "string-list"],
        ["与种类不配的内建控件按没写处理", Type.Integer({"x-form": {widget: "multiline"}}), "number"],
        ["单选写了复选组也按没写处理", Type.Union([Type.Literal("a"), Type.Literal("b")], {"x-form": {widget: "checkboxes"}}), "radio-row"],
    ];
    for (const [name, schema, widget] of cases) {
        it(name, () => expect(widgetOf(schema)).toEqual(widget));
    }

    it("显式 radio 盖过项数；字面量联合上的动态选项走下拉", () => {
        expect(widgetOf(Type.Union([Type.Literal("a"), Type.Literal("b"), Type.Literal("c"), Type.Literal("d")], {"x-form": {widget: "radio"}}))).toBe("radio");
        expect(widgetOf(Type.Union([Type.Literal("a")], {"x-form": {options: "models"}}))).toBe("select");
    });
});

describe("选项的键与终端退回", () => {
    it("1 与 \"1\"、true 与 \"true\" 是不同的键，键能换回字面量", () => {
        const values = [1, "1", true, "true"] as const;
        const keys = values.map(optionKey);
        expect(new Set(keys).size).toBe(4);
        for (const value of values) expect(optionValue(optionKey(value), values)).toBe(value);
        expect(optionValue("s:none", values)).toBeUndefined();
    });

    it("每种内建控件都有终端里的退回画法", () => {
        expect(fallbackWidget("search-select")).toBe("pick-one");
        expect(fallbackWidget("json")).toBe("editor");
        expect(fallbackWidget("secret")).toBe("masked");
    });
});
