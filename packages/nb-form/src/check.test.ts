/**
 * 描述检查与 Agent 策略（docs/specs/ui/forms.md 输出 1、13、23），以及给 nbdev 的映射（“给下游的接口”）。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {checkDescription} from "./check";
import {resolveForm} from "./model";
import type {FormLayout} from "./model";
import {toPointer} from "./path";
import {validateForm} from "./validate";

const codesOf = (check: ReturnType<typeof checkDescription>) => check.problems.map((entry) => `${entry.path} ${entry.code}`);

describe("可信作者的描述", () => {
    it("全部可结构化编辑时为 structured；有 JSON 字段时为 json", () => {
        expect(checkDescription(Type.Object({a: Type.String(), b: Type.Boolean()})).status).toBe("structured");
        const json = checkDescription(Type.Object({extra: Type.Record(Type.String(), Type.String())}));
        expect(json.status).toBe("json");
        expect(codesOf(json)).toEqual(["/extra json-field"]);
    });

    it("控件与种类不配、选项与字面量对不上、推荐不在选项里、必填上写条件、条件指向不存在的字段", () => {
        const schema = Type.Object({
            n: Type.Integer({"x-form": {widget: "multiline"}}),
            c: Type.Union([Type.Literal("a"), Type.Literal("b")], {"x-form": {choices: [{value: "z", label: "Z"}], recommend: ["q"]}}),
            hidden: Type.String({"x-form": {visibleWhen: {field: "c", schema: {const: "a"}}}}),
            ghost: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "nope", schema: {const: 1}}}})),
        });
        const check = checkDescription(schema);
        expect(check.status).toBe("invalid");
        expect(codesOf(check)).toEqual([
            "/n widget-mismatch",
            "/c choice-not-in-schema",
            "/c recommend-not-in-choices",
            "/hidden conditional-required",
            "/ghost visible-when-unknown-field",
        ]);
    });

    it("x-form 写了不认识的键或形状不对的文字", () => {
        const check = checkDescription(Type.Object({a: Type.String({"x-form": {lable: "x", help: 3}})}));
        expect(codesOf(check)).toEqual(["/a unknown-hint", "/a bad-hint"]);
        // 空的多语言文字、不是整数的行数也是坏形状；非空的多语言文字与正整数合格。
        const edges = checkDescription(Type.Object({a: Type.String({"x-form": {label: {}, rows: 1.5}}), b: Type.String({"x-form": {label: {en: "B"}, rows: 2}})}));
        expect(edges.problems.filter((entry) => entry.code === "bad-hint").map((entry) => `${entry.path} ${String(entry.params.key)}`)).toEqual(["/a label", "/a rows"]);
    });

    it("写了却没有生效的内建控件报 widget-mismatch：文字的下拉没有 options、有 options 时写多行", () => {
        const schema = Type.Object({
            plain: Type.String({"x-form": {widget: "select"}}),
            multi: Type.String({"x-form": {widget: "multiline", options: "models"}}),
            picked: Type.String({"x-form": {widget: "select", options: "models", searchable: true}}),
            listed: Type.Array(Type.String(), {"x-form": {widget: "list"}}),
        });
        expect(codesOf(checkDescription(schema))).toEqual(["/plain widget-mismatch", "/multi widget-mismatch"]);
        expect(resolveForm(schema).root.children.map((child) => child.widget)).toEqual(["text", "select", "select", "string-list"]);
    });

    it("布局：不存在、重复的字段为错误，漏写的字段为警告", () => {
        const schema = Type.Object({a: Type.String(), b: Type.String(), c: Type.String()});
        const layout = {type: "column", items: [{type: "field", path: "/a"}, {type: "field", path: "/a"}, {type: "field", path: "/zz"}]} as const;
        expect(codesOf(checkDescription(schema, {layout}))).toEqual(["/a layout-duplicate-field", "/zz layout-unknown-field", "/b layout-missing-field", "/c layout-missing-field"]);
    });

    it("x-form 的坏形状逐键报出，不被悄悄丢掉", () => {
        const schema = Type.Object({s: Type.Optional(Type.String({"x-form": {visibleWhen: "bad", widget: 3, rows: -1, searchable: "yes", options: 42, choices: [{value: {}, label: "x"}]}}))});
        const keys = checkDescription(schema).problems.filter((entry) => entry.code === "bad-hint").map((entry) => entry.params.key);
        expect(keys).toEqual(["widget", "options", "searchable", "rows", "choices", "visibleWhen"]);
    });

    it("条件里写错的正则、指向不存在的根字段都报出来", () => {
        const schema = Type.Object({x: Type.String(), s: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "x", schema: {type: "string", pattern: "["}}}})), t: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "/missing", schema: {const: 1}}}}))});
        expect(codesOf(checkDescription(schema))).toEqual(["/s visible-when-bad-pattern", "/t visible-when-unknown-field"]);
    });

    it("显式 json 对任何种类都成立", () => {
        for (const schema of [Type.String(), Type.Boolean(), Type.Integer(), Type.Object({a: Type.String()}), Type.Array(Type.String())]) {
            const described = {...schema, "x-form": {widget: "json"}};
            expect(resolveForm(described).root.widget).toBe("json");
            expect(checkDescription(Type.Object({f: described as never})).problems.filter((entry) => entry.code === "widget-mismatch")).toEqual([]);
        }
    });

    it("布局只排根上的字段", () => {
        const schema = Type.Object({o: Type.Object({x: Type.String(), y: Type.String()}), z: Type.String()});
        const layout = {type: "column", items: [{type: "field", path: "/o/x"}, {type: "field", path: "/o"}, {type: "field", path: "/z"}]} as const;
        expect(codesOf(checkDescription(schema, {layout}))).toEqual(["/o/x layout-nested-field"]);
    });

    it("不是对象的输入不抛异常", () => {
        expect(checkDescription(null).status).toBe("invalid");
        expect(checkDescription("x").status).toBe("invalid");
    });
});

describe("Agent 策略（输出 23）", () => {
    const agent = (schema: unknown) => checkDescription(schema, {policy: "agent"});
    const agent_ = (schema: unknown, layout: FormLayout) => checkDescription(schema, {policy: "agent", layout});

    it("常见的提问描述通过", () => {
        const schema = Type.Object({
            choice: Type.Union([Type.Literal("a"), Type.Literal("b")]),
            tags: Type.Array(Type.Union([Type.Literal("x"), Type.Literal("y")]), {uniqueItems: true}),
            note: Type.Optional(Type.String({maxLength: 500, "x-form": {widget: "multiline"}})),
            people: Type.Array(Type.Object({name: Type.String(), age: Type.Optional(Type.Integer())})),
        });
        expect(agent(schema)).toEqual({status: "structured", problems: []});
    });

    it("灾难性的正则、写错的正则都被拒，不求值、不抛异常", () => {
        expect(codesOf(agent(Type.Object({s: Type.String({pattern: "^(a+)+$"})})))).toContain(" keyword-not-allowed");
        expect(agent(Type.Object({s: Type.String({pattern: "["})})).status).toBe("invalid");
    });

    it("密钥、自定义控件、引用、条件里的正则都被拒", () => {
        expect(codesOf(agent(Type.Object({k: Type.String({writeOnly: true})})))).toContain(" keyword-not-allowed");
        expect(codesOf(agent(Type.Object({k: Type.String({"x-form": {widget: "secret"}})})))).toContain("/k secret-not-allowed");
        expect(codesOf(agent(Type.Object({k: Type.String({"x-form": {widget: "color"}})})))).toContain("/k custom-widget-not-allowed");
        expect(codesOf(agent({type: "object", properties: {k: {$ref: "#/$defs/x"}}, $defs: {x: {type: "string"}}}))).toContain(" keyword-not-allowed");
        const conditional = Type.Object({a: Type.String(), b: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "a", schema: {pattern: "^(a+)+$"}}}}))});
        expect(codesOf(agent(conditional))).toContain(" keyword-not-allowed");
    });

    it("布局一起计入字节、文字长度与节点数", () => {
        const schema = Type.Object({a: Type.String()});
        const layout = {type: "group", label: "x".repeat(40_000), items: [{type: "field", path: "/a"}]} as const;
        expect(codesOf(agent_(schema, layout))).toEqual(expect.arrayContaining([" too-large", " text-too-long"]));
    });

    it("名叫 pattern、writeOnly、$ref 的业务字段不是关键字", () => {
        for (const name of ["pattern", "writeOnly", "$ref"]) {
            expect(agent({type: "object", properties: {[name]: {type: "string"}}})).toEqual({status: "structured", problems: []});
        }
    });

    it("超宽的联合、过深、过大、根不是对象、要用 JSON 编辑的字段都被拒", () => {
        const wide = Type.Object({c: Type.Union(Array.from({length: 51}, (_, index) => Type.Literal(index)))});
        expect(codesOf(agent(wide))).toContain(" union-too-wide");
        // 根之下只许一层对象（对象列表的元素也算一层）。
        expect(agent(Type.Object({a: Type.Object({b: Type.String()})})).status).toBe("structured");
        expect(codesOf(agent(Type.Object({a: Type.Object({b: Type.Object({c: Type.String()})})})))).toContain("/a/b too-deep");
        expect(codesOf(agent(Type.Object({rows: Type.Array(Type.Object({inner: Type.Object({c: Type.String()})}))})))).toContain("/rows/0/inner too-deep");
        // schema 的嵌套层数把组合器也算上：20 层 anyOf 包在条件里也拦得住。
        let nested: Record<string, unknown> = {const: "x"};
        for (let level = 0; level < 20; level += 1) nested = {anyOf: [nested]};
        expect(codesOf(agent(Type.Object({a: Type.String(), b: Type.Optional(Type.String({"x-form": {visibleWhen: {field: "a", schema: nested}}}))})))).toContain(" too-deep");
        const big = Type.Object({s: Type.String({description: "x".repeat(40_000)})});
        expect(codesOf(agent(big))).toEqual(expect.arrayContaining([" too-large", " text-too-long"]));
        expect(codesOf(agent(Type.String()))).toContain(" root-not-object");
        expect(codesOf(agent(Type.Object({m: Type.Record(Type.String(), Type.String())})))).toContain("/m unsupported-type");
    });
});

describe("给 nbdev 的映射（Spec“给下游的接口”）", () => {
    // nbdev 的四种题与答复校验见 packages/dev-panel/src/core/questions.ts。这里只钉住标准 JSON Schema 能表达的部分；
    // nbdev 特有的规则（文字按 UTF-16 计长度、去空白后非空、不许控制字符）由 nbdev 的适配器以调用方问题报告，接入时
    // 在 dev-panel 里对照真实的 validateAnswerValue 测（核心不能依赖 dev-panel）。
    const options = Type.Union([Type.Literal("fix"), Type.Literal("skip"), Type.Literal("discuss")], {"x-form": {widget: "radio", recommend: ["fix"]}});
    const schema = Type.Object({
        single: options,
        multi: Type.Array(Type.Union([Type.Literal("a"), Type.Literal("b")]), {uniqueItems: true, minItems: 1, "x-form": {widget: "checkboxes"}}),
        text: Type.String({minLength: 1, maxLength: 10_000, "x-form": {widget: "multiline"}}),
        confirm: Type.Optional(Type.Boolean({"x-form": {widget: "confirm"}})),
    });

    it("描述通过 Agent 策略之外的完整检查", () => {
        expect(checkDescription(schema).status).toBe("structured");
    });

    it("空多选、空文字、过长文字被拒；确认未答是缺值，false 是合法的否", () => {
        const model = resolveForm(schema);
        const issues = validateForm(model, {single: "fix", multi: [], text: "", confirm: false});
        expect(issues.map((issue) => `${toPointer(issue.path)} ${issue.code}`)).toEqual(["/multi min-items", "/text min-length"]);
        expect(validateForm(model, {single: "fix", multi: ["a"], text: "x".repeat(10_001)}).map((issue) => issue.code)).toEqual(["max-length"]);
        expect(validateForm(model, {single: "fix", multi: ["a"], text: "ok"})).toEqual([]);
    });
});
