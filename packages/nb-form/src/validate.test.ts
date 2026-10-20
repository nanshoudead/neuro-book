/**
 * 路径、值与校验（docs/specs/ui/forms.md 输出 3–10、13）。schema 用真实的 TypeBox 生成。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {resolveForm} from "./model";
import {getAt, removeAt, setAt, toPointer} from "./path";
import {validateForm} from "./validate";
import {isVisible} from "./visible";

function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null) {
        for (const entry of Object.values(value)) deepFreeze(entry);
        Object.freeze(value);
    }
    return value;
}

const codes = (issues: ReadonlyArray<{path: ReadonlyArray<string | number>; code: string}>) => issues.map((issue) => `${toPointer(issue.path)} ${issue.code}`);

describe("路径与值（输出 3、4、6）", () => {
    it("JSON Pointer 转义 ~ 与 /；属性名 a/b 与嵌套的 a.b 是两个路径", () => {
        expect(toPointer(["a/b"])).toBe("/a~1b");
        expect(toPointer(["a", "b"])).toBe("/a/b");
        expect(toPointer(["x~y", 0])).toBe("/x~0y/0");
    });

    it("写时复制：冻结的输入不变，未改动的分支保留原引用", () => {
        const value = deepFreeze({a: {n: 1}, b: {m: 2}, rows: [{k: "x"}, {k: "y"}]});
        const next = setAt(value, ["a", "n"], 5) as typeof value;
        expect(next.a.n).toBe(5);
        expect(value.a.n).toBe(1);
        expect(next.b).toBe(value.b);
        expect(next.rows).toBe(value.rows);
        const rows = setAt(value, ["rows", 1, "k"], "z") as typeof value;
        expect(rows.rows[0]).toBe(value.rows[0]);
        expect(getAt(rows, ["rows", 1, "k"])).toBe("z");
    });

    it("路径与值的形状不合时不改，原样返回", () => {
        const value = deepFreeze({rows: ["a", "b"], a: 1});
        expect(removeAt(value, ["rows", "0"])).toBe(value);
        expect(removeAt(value, ["rows", 0.5])).toBe(value);
        expect(setAt(value, ["rows", -1], "x")).toBe(value);
        expect(setAt(value, ["rows", 4], "x")).toBe(value);
        expect(setAt(value, ["a", "x"], 1)).toBe(value);
        expect(setAt(value, ["rows", 2], "c")).toEqual({rows: ["a", "b", "c"], a: 1});
    });

    it("清除删键，不写 undefined；数组移除一项；不存在的路径原样返回", () => {
        const value = deepFreeze({a: 1, b: 2, rows: ["x", "y", "z"]});
        const removed = removeAt(value, ["a"]) as Record<string, unknown>;
        expect(Object.hasOwn(removed, "a")).toBe(false);
        expect(removeAt(value, ["rows", 1])).toEqual({a: 1, b: 2, rows: ["x", "z"]});
        expect(removeAt(value, ["missing"])).toBe(value);
    });
});

describe("校验与问题（输出 7–10）", () => {
    const provider = Type.Object({
        id: Type.String({readOnly: true}),
        name: Type.String({minLength: 1}),
        api: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
        apiKey: Type.String({writeOnly: true}),
        timeout: Type.Optional(Type.Integer({minimum: 1000})),
        extra: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, {additionalProperties: false});
    const model = resolveForm(provider);

    it("缺两个必填各报在缺的字段上，不是父对象上的一条", () => {
        expect(codes(validateForm(model, {id: "x", api: "openai"}))).toEqual(["/name required", "/apiKey required"]);
    });

    it("字面量联合的错值只报一条 not-in-choices；约束各有自己的码；多余属性报在对象上", () => {
        const issues = validateForm(model, {id: "x", name: "", api: "gemini", apiKey: "k", timeout: 10, other: 1});
        expect(codes(issues)).toEqual(["/name min-length", "/api not-in-choices", "/timeout minimum", " additional-property"]);
        expect(issues.find((issue) => issue.code === "minimum")!.params).toMatchObject({limit: 1000});
    });

    it("密钥已设置时不报必填（meta）", () => {
        const value = {id: "x", name: "n", api: "openai"};
        expect(codes(validateForm(model, value, {meta: {"/apiKey": {secret: "set"}}}))).toEqual([]);
        expect(codes(validateForm(model, value, {meta: {"/apiKey": {secret: "unreadable"}}}))).toEqual(["/apiKey required"]);
    });

    it("属性名里有 / 时问题落在正确的字段上", () => {
        const schema = Type.Object({"a/b": Type.String({minLength: 2}), a: Type.Object({b: Type.String()})});
        expect(codes(validateForm(resolveForm(schema), {"a/b": "x", a: {b: "ok"}}))).toEqual(["/a~1b min-length"]);
    });

    it("列表的元素各自校验，问题带下标；列表自己的数量约束报在列表上", () => {
        const schema = Type.Object({rows: Type.Array(Type.Object({k: Type.String({minLength: 2})}), {minItems: 3})});
        expect(codes(validateForm(resolveForm(schema), {rows: [{k: "ok"}, {k: "x"}]}))).toEqual(["/rows min-items", "/rows/1/k min-length"]);
    });

    it("多选的元素不在选项里报在那一项上", () => {
        const schema = Type.Object({tags: Type.Array(Type.Union([Type.Literal("a"), Type.Literal("b")]), {uniqueItems: true, minItems: 1})});
        expect(codes(validateForm(resolveForm(schema), {tags: []}))).toEqual(["/tags min-items"]);
        expect(codes(validateForm(resolveForm(schema), {tags: ["a", "c"]}))).toEqual(["/tags/1 not-in-choices"]);
    });

    it("可为 null 的字段接受 null；不可为 null 的报 type", () => {
        const schema = Type.Object({n: Type.Union([Type.Integer(), Type.Null()]), s: Type.String()});
        expect(codes(validateForm(resolveForm(schema), {n: null, s: null}))).toEqual(["/s type"]);
    });

    it("写错的正则记为 schema-error，不抛异常", () => {
        const schema = Type.Object({s: Type.String({pattern: "["})});
        const issues = validateForm(resolveForm(schema), {s: "x"});
        expect(codes(issues)).toEqual(["/s schema-error"]);
    });

    it("JSON 编辑的字段：错误都标在它自己上", () => {
        const schema = Type.Object({extra: Type.Record(Type.String(), Type.Integer())});
        expect(codes(validateForm(resolveForm(schema), {extra: {a: 1, b: "x"}}))).toEqual(["/extra type"]);
    });

    it("JSON 字段里一个值不合联合只报一条，不报每个分支的错误", () => {
        const schema = Type.Object({extra: Type.Record(Type.String(), Type.Union([Type.String({minLength: 3}), Type.Integer()]))});
        expect(codes(validateForm(resolveForm(schema), {extra: {a: "x"}}))).toEqual(["/extra not-in-choices"]);
    });

    it("字段有错时，对象与列表自身的约束照样报出", () => {
        const object = Type.Object({a: Type.String({minLength: 2}), b: Type.Optional(Type.String())}, {minProperties: 2});
        expect(codes(validateForm(resolveForm(object), {a: "x"}))).toEqual([" min-properties", "/a min-length"]);
        const list = Type.Object({rows: Type.Array(Type.String({minLength: 2}), {contains: {const: "ok"}})});
        expect(codes(validateForm(resolveForm(list), {rows: ["x"]}))).toEqual(["/rows contains", "/rows/0 min-length"]);
    });

    it("选项字段上并列的约束不被选项检查盖掉", () => {
        const schema = Type.Object({c: Type.Union([Type.Literal("x"), Type.Literal("yy")], {minLength: 2})});
        expect(codes(validateForm(resolveForm(schema), {c: "x"}))).toEqual(["/c min-length"]);
    });

    it("required 里有、properties 里没有的键缺了也报，不能借 meta 豁免", () => {
        const schema = {type: "object", properties: {name: {type: "string"}}, required: ["key"]};
        expect(codes(validateForm(resolveForm(schema), {name: "x"}, {meta: {"/key": {secret: "set"}}}))).toEqual(["/key required"]);
    });

    it("密钥的父属性名里有 / 时 meta 照样生效；根是密钥时也生效", () => {
        const schema = Type.Object({"a/b": Type.Object({key: Type.String({writeOnly: true})})});
        expect(codes(validateForm(resolveForm(schema), {"a/b": {}}, {meta: {"/a~1b/key": {secret: "set"}}}))).toEqual([]);
        const root = Type.String({writeOnly: true});
        expect(codes(validateForm(resolveForm(root), undefined, {meta: {"": {secret: "set"}}}))).toEqual([]);
    });

    it("JSON 字段接受 schema 允许的 null", () => {
        for (const schema of [Type.Null(), {}, Type.Union([Type.String(), Type.Number(), Type.Null()]), {type: ["string", "null"]}]) {
            expect(validateForm(resolveForm(Type.Object({v: schema as never})), {v: null})).toEqual([]);
        }
    });

    it("引用只让它所在的字段用 JSON 编辑，引用里的约束报在那个字段上", () => {
        const schema = {$defs: {n: {type: "integer", minimum: 3}}, type: "object", properties: {name: {type: "string"}, extra: {$ref: "#/$defs/n"}}};
        const model = resolveForm(schema);
        expect(model.root.kind).toBe("object");
        expect(model.root.children.map((child) => child.kind)).toEqual(["text", "json"]);
        expect(codes(validateForm(model, {name: "x", extra: 1}))).toEqual(["/extra minimum"]);
    });

    it("根缺值报根上的 required", () => {
        expect(codes(validateForm(model, undefined))).toEqual([" required"]);
    });
});

describe("条件显示（输出 13）", () => {
    const schema = Type.Object({
        api: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
        proxy: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "api", schema: {const: "openai"}}}})),
        rows: Type.Array(Type.Object({
            kind: Type.Union([Type.Literal("a"), Type.Literal("b")]),
            extra: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "kind", schema: {const: "b"}}}})),
            global: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "/api", schema: {const: "anthropic"}}}})),
        })),
    });
    const root = resolveForm(schema).root;
    const proxy = root.children.find((entry) => entry.path[0] === "proxy")!;
    const rows = root.children.find((entry) => entry.path[0] === "rows")!;

    it("兄弟字段满足条件才显示；隐藏不改值、照样校验", () => {
        expect(isVisible(proxy, {api: "openai"})).toBe(true);
        expect(isVisible(proxy, {api: "anthropic"})).toBe(false);
        expect(isVisible(proxy, {})).toBe(false);
        const issues = validateForm(resolveForm(schema), {api: "anthropic", proxy: 3, rows: []});
        expect(codes(issues)).toEqual(["/proxy type"]);
    });

    it("数组项里指同一项的兄弟；以 / 开头指根", async () => {
        const {itemNode} = await import("./model");
        const value = {api: "anthropic", rows: [{kind: "a"}, {kind: "b"}]};
        const first = itemNode(rows, 0)!;
        const second = itemNode(rows, 1)!;
        const extra = (item: typeof first) => item.children.find((entry) => entry.path[2] === "extra")!;
        const global = (item: typeof first) => item.children.find((entry) => entry.path[2] === "global")!;
        expect(isVisible(extra(first), value)).toBe(false);
        expect(isVisible(extra(second), value)).toBe(true);
        expect(isVisible(global(first), value)).toBe(true);
    });
});
