/**
 * 核心的文字解析（docs/specs/ui/forms.md“输入与前置条件”的 `FormText`）：字符串与语言映射在核心解析，目录里的键要经
 * Vue 层的翻译端口，核心只给键名兜底。
 */

import {describe, expect, it} from "bun:test";

import {isFormText, resolveText} from "./text";

describe("resolveText", () => {
    it("语言映射取当前语言，没有取 en-US，再没有取第一种", () => {
        const text = {"zh-CN": "名称", "en-US": "Name"};
        expect(resolveText(text, "zh-CN")).toBe("名称");
        expect(resolveText(text, "ja-JP")).toBe("Name");
        expect(resolveText({"fr-FR": "Nom", "de-DE": "Name"}, "ja-JP")).toBe("Nom");
        expect(resolveText("名称", "en-US")).toBe("名称");
        expect(resolveText(undefined, "zh-CN")).toBe("");
    });

    it("目录里的键在核心翻不了，给键名；不带参数的引用不会被当成语言映射", () => {
        expect(resolveText({kind: "text", key: "settings.unit"}, "zh-CN")).toBe("settings.unit");
        expect(resolveText({kind: "text", ns: "nb-form", key: "add", params: {n: 1}}, "en-US")).toBe("add");
    });
});

describe("isFormText", () => {
    it("接受字符串、目录里的键与语言映射；空映射与参数不合规的引用不是文字", () => {
        expect(isFormText("x")).toBe(true);
        expect(isFormText({kind: "text", ns: "nb-form", key: "add", params: {count: 2, name: "a"}})).toBe(true);
        expect(isFormText({"zh-CN": "名称"})).toBe(true);
        expect(isFormText({})).toBe(false);
        expect(isFormText({kind: "text", key: "add", params: {at: []}})).toBe(false);
        expect(isFormText(3)).toBe(false);
    });
});
