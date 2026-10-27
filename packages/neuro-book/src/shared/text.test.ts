/** docs/specs/ui/i18n.md 输出 1：schema 与 nb-ui 的判别对同一组值给出相同的结论。 */

import {describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {isText} from "@notnotype/nb-ui/text";
import {portabilityProblems} from "@notnotype/nb-runtime/plugins";

import {TextSchema} from "./text";

const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["字面文字", "保存"],
    ["引用", {kind: "text", key: "commands.save.title"}],
    ["带命名空间与参数的引用", {kind: "text", ns: "nbook.editor", key: "files.count", params: {count: 2, name: "a.md"}}],
    ["两种语言", {"zh-CN": "保存", "en-US": "Save"}],
    ["单语言", {"en-US": "Save"}],
    ["键不是语言标签", {"zh-CN": "保存", "kind": "x"}],
    ["kind 不对", {kind: "other", key: "x"}],
    ["键里有冒号", {kind: "text", key: "other:title"}],
    ["参数是对象", {kind: "text", key: "x", params: {a: {}}}],
    ["数字", 3],
];

describe("TextSchema 与 nb-ui 的判别一致", () => {
    for (const [name, value] of cases) {
        it(name, () => {
            const bySchema = Value.Check(TextSchema, value);
            // nb-ui 的判别不管键里的冒号与参数类型（那由翻译时的整理处理），schema 更严：只在 schema 接受时要求判别也接受。
            if (bySchema) expect(isText(value)).toBe(true);
            expect(bySchema).toBe(["字面文字", "引用", "带命名空间与参数的引用", "两种语言", "单语言"].includes(name));
        });
    }
});

describe("TextSchema 是纯 JSON Schema", () => {
    it("第三方插件的贡献点能用它（没有可移植性问题）", () => {
        expect(portabilityProblems(TextSchema)).toEqual([]);
    });
});
