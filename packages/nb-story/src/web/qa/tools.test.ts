/**
 * 问答工具在对话视图里的短语：读到的章连着写、被章数上限挡下的不算失败也不算读到，交卷被退回时写原因。
 */

import {describe, expect, test} from "bun:test";

import type {ToolCallView} from "@notnotype/nb-agent-ui";

import {chaptersPhrase, readRefused, storyToolsContribution} from "./tools";

const read = (from: object, to?: object, fields: Partial<ToolCallView> = {}): ToolCallView => ({id: "r", name: "read", status: "success", args: to === undefined ? {from} : {from, to}, result: {text: "37.1 正文", truncated: false}, ...fields}) as ToolCallView;
const refused = (chapter: number) => read({chapter}, undefined, {result: {text: "没有读：一问最多读 20 章，已经读满", truncated: false}});

describe("读原文", () => {
    test("读到的章合并成连续的几段；被上限挡下的、出错的不算", () => {
        const calls = [read({chapter: 35, paragraph: 1}, {chapter: 37, paragraph: 9}), read({chapter: 33}), read({chapter: 34}), read({chapter: 40}), refused(41), read({chapter: 42}, undefined, {status: "error"})];
        expect(chaptersPhrase(calls)).toBe("读了第 33–37、40 章");
        expect(readRefused(calls[4]!)).toBe(true);
        expect(readRefused(calls[0]!)).toBe(false);
    });

    test("一章也没读到：按次数说", () => {
        expect(chaptersPhrase([refused(41), refused(42)])).toBe("读了 2 次原文");
    });

    test("超出上限的一行写明没读", () => {
        const entry = storyToolsContribution({}).tools!.find(tool => tool.toolNames?.includes("read"))!;
        expect(entry.summary!(refused(41))).toBe("第 41 章：已到章数上限，没读");
    });
});

describe("交卷", () => {
    test("被退回时写原因的第一行，交上的写结论", () => {
        const entry = storyToolsContribution({}).tools!.find(tool => tool.toolNames?.includes("answer"))!;
        expect(entry.summary!({id: "a", name: "answer", status: "error", args: {conclusion: "x"}, error: "依据里的 39.1 晚于阅读位置\n其余"} as ToolCallView)).toBe("退回：依据里的 39.1 晚于阅读位置");
        expect(entry.summary!({id: "a", name: "answer", status: "success", args: {conclusion: "读者知道"}} as ToolCallView)).toBe("读者知道");
    });
});
