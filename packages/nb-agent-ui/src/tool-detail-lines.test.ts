import {describe, expect, it} from "bun:test";
import type {ToolCallView} from "./types";
import {editInputChanges} from "./tool-args";
import {fileContentLines, fileDiffLines, splitLines} from "./tool-detail-lines";

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

    it("edit 每个片段先删后增，片段之间加省略行", () => {
        const lines = fileDiffLines(call("edit", {path: "a.md", edits: [{oldText: "旧1\n旧2", newText: "新"}, {oldText: "甲", newText: "乙"}]}));
        expect(lines.map((line) => `${line.tone}:${line.text}`)).toEqual([
            "removed:旧1", "removed:旧2", "added:新", "muted:⋯", "removed:甲", "added:乙",
        ]);
    });

    it("apply_patch 去掉行首符号并按符号着色，文件头淡色", () => {
        const lines = fileDiffLines(call("apply_patch", {patch: "*** Update File: a.md\n-旧\n+新\n 不变"}));
        expect(lines.map((line) => `${line.tone ?? "plain"}:${line.text}`)).toEqual([
            "muted:*** Update File: a.md", "removed:旧", "added:新", "plain:不变",
        ]);
    });

    it("write 全部为新增", () => {
        expect(fileDiffLines(call("write", {path: "a.md", content: "一\n二\n"})).every((line) => line.tone === "added")).toBe(true);
    });
});

describe("nb-harness 的 edit（参数是 input）", () => {
    const patchInput = "*** Begin Patch\n*** Update File: 正文/第三章.md\n@@\n-钟声敲到第十一下\n+钟声敲到第十二下\n*** End Patch";

    it("还没有结果时按 input 显示补丁，改到的文件从补丁头认出、带增删行数", () => {
        const edit = call("edit", {input: patchInput});
        expect(fileDiffLines(edit).filter((line) => line.tone !== "muted")).toEqual([{text: "钟声敲到第十一下", tone: "removed"}, {text: "钟声敲到第十二下", tone: "added"}]);
        expect(editInputChanges(edit)).toEqual([{path: "正文/第三章.md", added: 1, removed: 1}]);
    });

    it("hashline 有结果时显示改完的那几行；改到的文件以 result.details.files 为准", () => {
        const edit = {...call("edit", {input: "[正文/第三章.md#a1]\n=1 钟声敲到第十二下"}), status: "success" as const, result: {text: "[正文/第三章.md]\n1:钟声敲到第十二下", truncated: false, details: {mode: "hashline", files: [{path: "正文/第三章.md", op: "update", warnings: []}]}}};
        expect(fileDiffLines(edit)).toEqual([{text: "[正文/第三章.md]"}, {text: "1:钟声敲到第十二下"}]);
        expect(editInputChanges(edit)).toEqual([{path: "正文/第三章.md", added: null, removed: null}]);
    });

    it("hashline 还没有结果时，从 [路径#标记] 认出改到的文件，行数未知", () => {
        expect(editInputChanges(call("edit", {input: "[设定/人物.md#k9]\n+3 新的一行\n[正文/第一章.md#z0]\n-1"}))).toEqual([
            {path: "设定/人物.md", added: null, removed: null},
            {path: "正文/第一章.md", added: null, removed: null},
        ]);
    });
});
