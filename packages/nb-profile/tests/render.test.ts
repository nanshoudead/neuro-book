import {describe, expect, test} from "bun:test";
import {AIMessage, HistorySet, If, Message, ProfilePrompt, Reminder, System, renderProfile, type ProfileNode} from "../src";

// 历史消息对 nb-profile 是不透明的；用带标记的对象确认它被原样搬运，而不是被重建。
const first = {role: "user", content: "第一条"};
const second = {role: "toolResult", toolCallId: "c1", content: [{type: "text", text: "工具输出"}]};
const history = [first, second] as const;
const noTools = new Set<string>();

describe("renderProfile", () => {
    test("System 与 Reminder 按文档顺序进入 systemPrompt", () => {
        const node = ProfilePrompt({
            children: [System({children: ["第一段"]}), Reminder({children: ["提醒一段"]}), System({children: ["第二段"]})],
        });

        const rendered = renderProfile(node, {history: [], tools: noTools});
        expect(rendered.systemPrompt).toEqual(["第一段", "提醒一段", "第二段"]);
        expect(rendered.messages).toEqual([]);
    });

    test("HistorySet 原样展开历史，与静态消息按文档顺序排列", () => {
        const node = ProfilePrompt({
            children: [Message({children: ["静态用户消息"]}), HistorySet(), AIMessage({children: ["静态助手消息"]})],
        });

        const rendered = renderProfile(node, {history, tools: noTools});
        expect(rendered.messages).toEqual([
            {kind: "text", role: "user", text: "静态用户消息"},
            {kind: "history", message: first},
            {kind: "history", message: second},
            {kind: "text", role: "assistant", text: "静态助手消息"},
        ]);
        const replayed = rendered.messages[1];
        expect(replayed?.kind === "history" ? replayed.message : null).toBe(first);
    });

    test("If when=false 丢弃整棵子树（顶层与 System 内部都生效）", () => {
        const node = ProfilePrompt({
            children: [
                If({when: false, children: [System({children: ["不应出现"]}), Message({children: ["也不应出现"]})]}),
                System({children: ["保留 A", If({when: false, children: ["丢弃 B"]}), "保留 C"]}),
                If({when: true, children: [Message({children: ["保留的消息"]})]}),
            ],
        });

        const rendered = renderProfile(node, {history: [], tools: noTools});
        expect(rendered.systemPrompt).toEqual(["保留 A\n保留 C"]);
        expect(rendered.messages).toEqual([{kind: "text", role: "user", text: "保留的消息"}]);
    });

    test("If tool 按生效工具集取舍，嵌在 System 里同样生效", () => {
        const node = ProfilePrompt({
            children: [
                System({children: ["总规则", If({tool: "story.timeline", children: ["时间线的用法"]}), If({tool: "story.ledger", children: ["数值的用法"]})]}),
                If({tool: "story.ledger", children: [System({children: ["整段数值说明"]})]}),
            ],
        });

        const rendered = renderProfile(node, {history: [], tools: new Set(["story.timeline"])});
        expect(rendered.systemPrompt).toEqual(["总规则\n时间线的用法"]);
    });

    test("If 要恰好给 when 或 tool 中的一个", () => {
        expect(() => If({when: true, tool: "x"} as never)).toThrow(/恰好/u);
        expect(() => If({} as never)).toThrow(/恰好/u);
    });

    test("连续空段折叠成一个空行，首尾空白去掉", () => {
        const node = System({children: ["标题", "", "", "正文", "  "]});

        expect(renderProfile(node, {history: [], tools: noTools}).systemPrompt).toEqual(["标题\n\n正文"]);
    });

    test("Message 默认 user，role=assistant 时按助手输出", () => {
        const node = ProfilePrompt({
            children: [Message({children: ["默认角色"]}), Message({role: "assistant", children: ["显式角色"]})],
        });

        expect(renderProfile(node, {history: [], tools: noTools}).messages).toEqual([
            {kind: "text", role: "user", text: "默认角色"},
            {kind: "text", role: "assistant", text: "显式角色"},
        ]);
    });

    test("未知节点只下探子节点，不抛错", () => {
        const custom: ProfileNode = {kind: "DomainThing", props: {}, children: [Message({children: ["穿透"]})]};

        expect(renderProfile(custom, {history: [], tools: noTools}).messages).toEqual([{kind: "text", role: "user", text: "穿透"}]);
    });
});
