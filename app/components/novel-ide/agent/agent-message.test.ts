import {describe, expect, it} from "vitest";
import {applyRuntimeEventToMessages, applySessionEntryToMessages, deriveMessagesFromChatEntries, isContinuationPointMessage, type AgentMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentChatEntryDto} from "nbook/shared/dto/agent-public-event.dto";

describe("agent-message public projection", () => {
    it("durable history 保留正文 preview 的 bytes/omitted 元数据", () => {
        const messages = deriveMessagesFromChatEntries([
            user("user-1", "截断正文", 100_000, true),
            assistant("assistant-1", "回答预览", 80_000, true),
        ]);

        expect(messages).toEqual([
            expect.objectContaining({id: "user-1", contentBytes: 100_000, contentOmitted: true}),
            expect.objectContaining({id: "assistant-1", contentBytes: 80_000, contentOmitted: true}),
        ]);
    });

    it("durable assistant 按 invocation 收敛对应 live turn", () => {
        const previous: AgentMessage[] = [
            {id: "old", type: "ai", content: "旧", invocationId: "run-1", projectionSource: "durable"},
            {id: "live", type: "ai", content: "生成中", invocationId: "run-1", projectionSource: "live"},
        ];

        const messages = applySessionEntryToMessages(previous, {...assistant("assistant-1", "最终", 6, false), invocationId: "run-1"});

        expect(messages.map((message) => [message.id, message.content, message.projectionSource])).toEqual([
            ["old", "旧", "durable"],
            ["assistant-1", "最终", "durable"],
        ]);
    });

    it("durable tool result 归并到 toolCallId 所属 assistant", () => {
        const withAssistant = applySessionEntryToMessages([], {
            ...assistant("assistant-1", "", 0, false),
            toolCalls: [{id: "call-1", index: 0, name: "write", args: {kind: "write", path: "a.md", contentPreview: "", contentBytes: 0, contentOmitted: false}}],
        });
        const messages = applySessionEntryToMessages(withAssistant, {
            id: "result-1",
            timestamp: 2,
            type: "tool_result",
            toolCallId: "call-1",
            toolName: "write",
            result: {content: [{type: "text", textPreview: "完成", textBytes: 6, textOmitted: false}], omittedContentBlocks: 0},
            isError: false,
        });

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({id: "call-1", status: "success", result: "完成"}));
    });

    it("delta-first runtime event 按 messageId/contentIndex 合并", () => {
        let messages = applyRuntimeEventToMessages([], {type: "message_start", messageId: "assistant-1", role: "assistant", timestamp: 1, model: "test"}, "run-1");
        messages = applyRuntimeEventToMessages(messages, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "你", deltaBytes: 3, deltaOmitted: false}}, "run-1");
        messages = applyRuntimeEventToMessages(messages, {type: "message_update", messageId: "assistant-1", update: {type: "text_delta", contentIndex: 0, delta: "好", deltaBytes: 3, deltaOmitted: false}}, "run-1");

        expect(messages).toEqual([expect.objectContaining({id: "assistant-1", content: "你好", projectionSource: "live"})]);
    });

    it("continuation point 只接受允许的 settled tool call", () => {
        expect(isContinuationPointMessage({id: "user", type: "user", content: "继续"})).toBe(true);
        expect(isContinuationPointMessage({id: "ai", type: "ai", content: "", toolCalls: [{id: "call", index: 0, name: "read", argsText: "", status: "success"}]}, {allowSettledAiToolCalls: true})).toBe(true);
        expect(isContinuationPointMessage({id: "ai", type: "ai", content: "", toolCalls: [{id: "call", index: 0, name: "read", argsText: "", status: "running"}]}, {allowSettledAiToolCalls: true})).toBe(false);
    });
});

function user(id: string, preview: string, bytes: number, omitted: boolean): AgentChatEntryDto {
    return {id, timestamp: 1, type: "user", intent: "normal", content: {preview, bytes, omitted}};
}

function assistant(id: string, preview: string, bytes: number, omitted: boolean): Extract<AgentChatEntryDto, {type: "assistant"}> {
    return {
        id,
        timestamp: 1,
        type: "assistant",
        content: {preview, bytes, omitted},
        thinking: {preview: "", bytes: 0, omitted: false},
        status: "done",
        model: "test",
        usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
        toolCalls: [],
        omittedToolCalls: 0,
    };
}
