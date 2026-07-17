import {describe, expect, it} from "vitest";
import {
    encodeFollowUpQueue,
    parseFollowUpQueue,
    parseStoredMessage,
    parseStoredMessages,
    StoredMessageInvariantError,
} from "nbook/server/agent/messages/stored-message-codec";

describe("stored message codec", () => {
    it("将 Pi raw image 识别为待迁移数据", () => {
        expect(() => parseStoredMessage({
            role: "user",
            content: [{type: "image", mimeType: "image/png", data: "AAAA"}],
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({
            code: "migration_required",
        }));
    });

    it("拒绝 attachment block 偷渡内联 data", () => {
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{
                type: "attachment",
                attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 4},
                data: "AAAA",
            }],
            isError: false,
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("严格校验 assistant 的必需字段与 content block", () => {
        expect(() => parseStoredMessage({
            role: "assistant",
            content: [{type: "text", text: "done"}],
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("批量 parser 和 Provider 最终门禁拒绝 assistant attachment", () => {
        expect(() => parseStoredMessages([{
            role: "assistant",
            content: [{
                type: "attachment",
                attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 4},
            }],
            api: "openai-completions",
            provider: "test",
            model: "test",
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            stopReason: "stop",
            timestamp: 1,
        }])).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("follow-up queue 使用严格 codec 往返并拒绝坏 item", () => {
        const state = {
            status: "paused" as const,
            pausedBy: {invocationId: "inv-1", reason: "aborted" as const},
            items: [{
                id: "item-1",
                kind: "followup" as const,
                message: {
                    text: "继续",
                    attachments: [{
                        type: "attachment" as const,
                        attachment: {id: `sha256:${"b".repeat(64)}` as const, mimeType: "image/png", bytes: 4},
                        name: "cover.png",
                    }],
                },
                createdAt: 1,
            }],
        };

        expect(parseFollowUpQueue(encodeFollowUpQueue(state))).toEqual(state);
        expect(() => parseFollowUpQueue({
            status: "ready",
            items: [{id: "bad", kind: "followup", message: {text: "继续", images: []}, createdAt: 1}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });

    it("details 和 queue input 只接受真正可序列化的 JsonValue", () => {
        const circular: {self?: unknown} = {};
        circular.self = circular;
        expect(() => parseStoredMessage({
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{type: "text", text: "done"}],
            details: new Date(),
            isError: false,
            timestamp: 1,
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
        expect(() => parseFollowUpQueue({
            status: "ready",
            items: [{id: "item-1", kind: "followup", input: circular, createdAt: 1}],
        })).toThrowError(expect.objectContaining<Partial<StoredMessageInvariantError>>({code: "corrupt"}));
    });
});
