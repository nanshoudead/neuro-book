/**
 * 配置项声明到表单的映射（docs/specs/settings/settings-window.md 输出 9）：界面字段改名进 `x-form` 的提示，排法与宽度
 * 按选出的控件，结构字段的值合格了才写（输出 14）。声明都经 `defineSetting` 写出，与插件的写法相同。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";

import {settingErrors, settingForm, settingHints} from "./setting-form";

const title = {"zh-CN": "项", "en-US": "Item"};
const declare = (name: string, options: Omit<Parameters<typeof defineSetting>[0], "plugin" | "name" | "title">) => defineSetting({plugin: "x.test", name, title, ...options} as Parameters<typeof defineSetting>[0]).declaration;

describe("提示", () => {
    it("choices 的 title 改名 label，说明一起带上；ui 的各项照抄", () => {
        const declaration = declare("mode", {
            schema: Type.Union([Type.Literal("a"), Type.Literal("b")]),
            default: "a",
            choices: [{value: "a", title: {"zh-CN": "甲", "en-US": "A"}, description: {"zh-CN": "第一种", "en-US": "First"}}, {value: "b", title: {"zh-CN": "乙", "en-US": "B"}}],
            ui: {widget: "radio"},
        });
        expect(settingHints(declaration)).toEqual({
            widget: "radio",
            choices: [{value: "a", label: {"zh-CN": "甲", "en-US": "A"}, description: {"zh-CN": "第一种", "en-US": "First"}}, {value: "b", label: {"zh-CN": "乙", "en-US": "B"}}],
        });
    });

    it("动态选项 {from} 转成 options；没写 choices 与 ui 时没有提示", () => {
        expect(settingHints(declare("model", {schema: Type.String(), default: "", choices: {from: "x.test.models"}}))).toEqual({options: "x.test.models"});
        expect(settingHints(declare("plain", {schema: Type.String(), default: ""}))).toEqual({});
    });
});

describe("排法", () => {
    const cases: Array<[string, Parameters<typeof declare>[1], {wide: boolean; width: string; staged: boolean}]> = [
        ["开关按内容", {schema: Type.Boolean(), default: false}, {wide: false, width: "content", staged: false}],
        ["数字窄", {schema: Type.Integer(), default: 1}, {wide: false, width: "narrow", staged: false}],
        ["单行宽", {schema: Type.String(), default: ""}, {wide: false, width: "wide", staged: false}],
        ["多行另起一行", {schema: Type.String(), default: "", ui: {widget: "multiline"}}, {wide: true, width: "wide", staged: false}],
        ["四项下拉中等", {schema: Type.Union(["a", "b", "c", "d"].map((value) => Type.Literal(value))), default: "a"}, {wide: false, width: "medium", staged: false}],
        ["字符串列表另起一行、合格才写", {schema: Type.Array(Type.String()), default: []}, {wide: true, width: "wide", staged: true}],
        ["对象合格才写", {schema: Type.Object({a: Type.String()}), default: {a: ""}}, {wide: true, width: "wide", staged: true}],
        ["JSON 合格才写", {schema: Type.Record(Type.String(), Type.String()), default: {}}, {wide: true, width: "wide", staged: true}],
    ];
    for (const [name, options, expected] of cases) {
        it(name, () => expect(settingForm(declare("x", options))).toMatchObject(expected));
    }

    it("同一份声明每次拿到同一份提示", () => {
        const declaration = declare("x", {schema: Type.Boolean(), default: false});
        expect(settingForm(declaration).hints).toBe(settingForm(declaration).hints);
    });
});

describe("错误", () => {
    it("只算错误：必填缺失与长度不够是错误", () => {
        const form = settingForm(declare("people", {schema: Type.Array(Type.Object({name: Type.String({minLength: 1})})), default: []}));
        expect(settingErrors(form, [{name: "林照"}])).toEqual([]);
        expect(settingErrors(form, [{name: "林照"}, {}]).map((issue) => [issue.path, issue.code])).toEqual([[[1, "name"], "required"]]);
    });
});
