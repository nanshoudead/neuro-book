/**
 * 相邻用户消息合并（docs/specs/agent/harness.md）：只合并相邻的 user，别的角色隔开就不合并。
 */

import {describe, expect, test} from "bun:test";

import {mergeAdjacentUserMessages} from "../src/merge-user-messages";

const user = (text: string | object[], timestamp = 1) => ({role: "user", content: text, timestamp});
const assistant = (text: string) => ({role: "assistant", content: [{type: "text", text}]});

describe("相邻用户消息合并", () => {
    test("提醒与问题两条相邻的 user 合成一条，文字之间空一行；不改原数组", () => {
        const input = [user("第一问"), assistant("答"), user([{type: "text", text: "<system-reminder>…</system-reminder>"}], 2), user([{type: "text", text: "第二问"}], 3)];
        const merged = mergeAdjacentUserMessages(input);
        expect(merged).toHaveLength(3);
        expect(merged[2]).toMatchObject({role: "user", content: [{type: "text", text: "<system-reminder>…</system-reminder>\n\n第二问"}], timestamp: 2});
        expect(input).toHaveLength(4);
    });

    test("没有相邻的 user 时原样；字符串内容与块内容都能合并；非文字块按顺序保留", () => {
        expect(mergeAdjacentUserMessages([user("问"), assistant("答"), user("再问")])).toHaveLength(3);
        const image = {type: "image", data: "abc"};
        const merged = mergeAdjacentUserMessages([user("甲"), user([image, {type: "text", text: "乙"}])]);
        expect(merged).toHaveLength(1);
        expect(merged[0]!.content).toEqual([{type: "text", text: "甲"}, image, {type: "text", text: "乙"}]);
    });
});
