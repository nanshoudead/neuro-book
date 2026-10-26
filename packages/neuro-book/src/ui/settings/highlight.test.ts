/**
 * 命中文字的切分（`highlight.ts`）：片段首尾相接就是原文，命中的片段按词、不分大小写、所有命中都标。
 */

import {describe, expect, it} from "bun:test";

import {highlightSegments} from "./highlight";

const joined = (text: string, words: ReadonlyArray<string>): string => highlightSegments(text, words).map((segment) => segment.text).join("");
const hits = (text: string, words: ReadonlyArray<string>): string[] => highlightSegments(text, words).filter((segment) => segment.hit).map((segment) => segment.text);

describe("highlightSegments", () => {
    it("没有词、没有命中时是原文一段；空文本没有片段", () => {
        expect(highlightSegments("字号", [])).toEqual([{text: "字号", hit: false}]);
        expect(highlightSegments("字号", ["颜色"])).toEqual([{text: "字号", hit: false}]);
        expect(highlightSegments("", ["字"])).toEqual([]);
    });

    it("每个词的所有命中都标，按原文的写法；片段连起来是原文", () => {
        const text = "Font Size 与 FONT 与 font";
        expect(hits(text, ["font"])).toEqual(["Font", "FONT", "font"]);
        expect(hits("字号与行距，字号", ["行距", "字号"])).toEqual(["字号", "行距", "字号"]);
        expect(joined(text, ["font", "size"])).toBe(text);
    });

    it("词重叠时较长的优先，不把同一段标两次", () => {
        expect(highlightSegments("字号", ["字", "字号"])).toEqual([{text: "字号", hit: true}]);
    });

    it("正则元字符按字面找", () => {
        expect(hits("(a+b)* .* [x] a.b", ["(a+b)*", ".*", "[x]", "a.b"])).toEqual(["(a+b)*", ".*", "[x]", "a.b"]);
        expect(hits("abc", [".*"])).toEqual([]);
    });
});
