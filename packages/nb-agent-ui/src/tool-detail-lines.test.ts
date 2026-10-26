import {describe, expect, it} from "bun:test";
import type {ToolCallView} from "./types";
import {fileContentLines, splitLines} from "./tool-detail-lines";

function call(name: string, args: ToolCallView["args"], resultText?: string): ToolCallView {
    return {id: "c1", name, status: "success", args, ...(resultText === undefined ? {} : {result: {text: resultText, truncated: false}})};
}

describe("tool-detail-lines", () => {
    it("末尾换行不产生空行", () => {
        expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
        expect(splitLines("")).toEqual([]);
    });

    it("读取结果从 offset 开始编号", () => {
        expect(fileContentLines(call("read", {path: "a.md", offset: 41}, "x\ny")).startLine).toBe(41);
        expect(fileContentLines(call("read", {path: "a.md"}, "x")).startLine).toBe(1);
    });
});
