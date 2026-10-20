/**
 * 描述检查与 Agent 策略（docs/specs/ui/forms.md 输出 1、13、23），以及给 nbdev 的映射（“给下游的接口”）。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {checkDescription} from "./check";
import {resolveForm} from "./model";
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
    });

    it("布局：不存在、重复的字段为错误，漏写的字段为警告", () => {
        const schema = Type.Object({a: Type.String(), b: Type.String(), c: Type.String()});
        const layout = {type: "column", items: [{type: "field", path: "/a"}, {type: "field", path: "/a"}, {type: "field", path: "/zz"}]} as const;
        expect(codesOf(checkDescription(schema, {layout}))).toEqual(["/a layout-duplicate-field", "/zz layout-unknown-field", "/b layout-missing-field", "/c layout-missing-field"]);
    });

    it("不是对象的输入不抛异常", () => {
        expect(checkDescription(null).status).toBe("invalid");
        expect(checkDescription("x").status).toBe("invalid");
    });
});

describe("Agent 策略（输出 23）", () => {
    const agent = (schema: unknown) => checkDescription(schema, {policy: "agent"});

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

    it("超宽的联合、过深、过大、根不是对象、要用 JSON 编辑的字段都被拒", () => {
        const wide = Type.Object({c: Type.Union(Array.from({length: 51}, (_, index) => Type.Literal(index)))});
        expect(codesOf(agent(wide))).toContain(" union-too-wide");
        let deep: unknown = Type.String();
        for (let level = 0; level < 5; level += 1) deep = Type.Object({x: deep as never});
        expect(codesOf(agent(deep))).toContain(" too-deep");
        const big = Type.Object({s: Type.String({description: "x".repeat(40_000)})});
        expect(codesOf(agent(big))).toEqual(expect.arrayContaining([" too-large", " text-too-long"]));
        expect(codesOf(agent(Type.String()))).toContain(" root-not-object");
        expect(codesOf(agent(Type.Object({m: Type.Record(Type.String(), Type.String())})))).toContain("/m unsupported-type");
    });
});

describe("给 nbdev 的映射（Spec“给下游的接口”）", () => {
    // nbdev 的四种题与答复校验见 packages/dev-panel/src/core/questions.ts；这里钉住映射本身的边界，接入时由 dev-panel
    // 对照它真实的 validateAnswerValue 再测一次。
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
