import {describe, expect, it} from "vitest";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {SessionEntry} from "nbook/server/agent/session/types";

describe("projectAgentChatEntry", () => {
    it("纯 attachment prompt 仍形成可见 user entry，并保留原 contentIndex", () => {
        const entry = {
            id: "entry-image",
            parentId: null,
            timestamp: 101,
            type: "message",
            origin: "prompt",
            message: {
                role: "user",
                content: [{
                    type: "attachment",
                    attachment: {
                        id: `sha256:${"b".repeat(64)}`,
                        mimeType: "image/webp",
                        bytes: 42_000,
                    },
                    name: "参考图.webp",
                }],
                timestamp: 101,
            },
        } as unknown as SessionEntry;

        expect(projectAgentChatEntry(entry)).toEqual({
            id: "entry-image",
            timestamp: 101,
            type: "user",
            blocks: [{
                type: "attachment",
                contentIndex: 0,
                attachment: {
                    attachmentId: `sha256:${"b".repeat(64)}`,
                    mimeType: "image/webp",
                    bytes: 42_000,
                    name: "参考图.webp",
                    dataOmitted: true,
                },
            }],
            omittedBlocks: 0,
            textSummary: {bytes: 0, omitted: false},
            intent: "normal",
        });
    });

    it("user text blocks 共用 64 KiB 预算，控制字符转义后完整 event 仍低于硬上限", () => {
        const content = Array.from({length: 40}, (_, index) => index % 2 === 0
            ? {type: "text" as const, text: "\n".repeat(100_000)}
            : {
                type: "attachment" as const,
                attachment: {
                    id: `sha256:${String(index).padStart(64, "a")}`,
                    mimeType: "image/png",
                    bytes: 1024,
                },
                name: `${"图".repeat(2_000)}.png`,
            });
        const entry = {
            id: "entry-large-user",
            parentId: null,
            timestamp: 102,
            type: "message",
            origin: "prompt",
            message: {role: "user", content, timestamp: 102},
        } as unknown as SessionEntry;

        const projected = projectAgentChatEntry(entry);
        expect(projected?.type).toBe("user");
        if (projected?.type !== "user") return;
        expect(projected.blocks).toHaveLength(32);
        expect(projected.omittedBlocks).toBe(8);
        expect(projected.textSummary).toEqual({
            bytes: 2_000_019,
            omitted: true,
        });
        expect(projected.blocks
            .filter((block) => block.type === "text")
            .reduce((bytes, block) => bytes + Buffer.byteLength(block.content.preview, "utf8"), 0))
            .toBeLessThanOrEqual(64 * 1024);
        expect(Buffer.byteLength(JSON.stringify({
            sessionId: 1,
            kind: "session",
            event: {type: "session_entry", entry: projected},
        }), "utf8")).toBeLessThan(128 * 1024);
        expect(projected).not.toHaveProperty("content");
        expect(projected).not.toHaveProperty("attachments");
    });

    it("assistant entry 的 write tool call 不公开完整正文", () => {
        const content = "正文".repeat(600_000);
        const entry: SessionEntry = {
            id: "entry-assistant",
            parentId: "entry-user",
            timestamp: 100,
            type: "message",
            origin: "ingest",
            message: {
                role: "assistant",
                content: [{
                    type: "text",
                    text: "正在写入",
                }, {
                    type: "toolCall",
                    id: "tool-write",
                    name: "write",
                    arguments: {
                        path: "manuscript/chapter-1.md",
                        content,
                    },
                }],
                api: "openai-responses",
                provider: "openai",
                model: "gpt-5",
                usage: {
                    input: 1,
                    output: 2,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 3,
                    cost: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        total: 0,
                    },
                },
                stopReason: "toolUse",
                timestamp: 100,
            },
        };

        const projected = projectAgentChatEntry(entry, {invocationId: "invoke-1"});

        expect(projected).toEqual(expect.objectContaining({
            type: "assistant",
            id: "entry-assistant",
            invocationId: "invoke-1",
            toolCalls: [expect.objectContaining({
                id: "tool-write",
                name: "write",
                args: expect.objectContaining({
                    kind: "write",
                    path: "manuscript/chapter-1.md",
                    contentBytes: Buffer.byteLength(content, "utf8"),
                    contentOmitted: true,
                }),
            })],
        }));
        expect(JSON.stringify(projected)).not.toContain(content);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });

    it("assistant 正文、thinking、error 和 tool calls 共用单条 entry 预算", () => {
        const large = "长".repeat(100_000);
        const entry = {
            id: "entry-large",
            parentId: null,
            timestamp: 1,
            type: "message" as const,
            origin: "ingest" as const,
            message: {
                role: "assistant" as const,
                content: [
                    {type: "thinking" as const, thinking: large},
                    {type: "text" as const, text: large},
                    ...Array.from({length: 40}, (_, index) => ({type: "toolCall" as const, id: `call-${String(index)}`, name: "apply_patch", arguments: {patch: large}})),
                ],
                api: "test",
                provider: "test",
                model: "test",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "error" as const,
                errorMessage: large,
                timestamp: 1,
            },
        };

        const projected = projectAgentChatEntry(entry, {invocationId: "run-1"});

        expect(projected?.type).toBe("assistant");
        if (projected?.type !== "assistant") return;
        expect(projected.toolCalls).toHaveLength(32);
        expect(projected.omittedToolCalls).toBe(8);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(96 * 1024);
    });

    it("durable tool result 的 toolName 使用与 runtime 相同的有界投影", () => {
        const toolName = "tool-" + "x".repeat(10_000);
        const entry = {
            id: "entry-tool-result",
            parentId: null,
            timestamp: 1,
            type: "message" as const,
            origin: "ingest" as const,
            message: {
                role: "toolResult" as const,
                toolCallId: "call-1",
                toolName,
                content: [{type: "text" as const, text: "ok"}],
                isError: false,
                timestamp: 1,
            },
        } as unknown as SessionEntry;

        const projected = projectAgentChatEntry(entry);

        expect(projected?.type).toBe("tool_result");
        if (projected?.type !== "tool_result") return;
        expect(Buffer.byteLength(projected.toolName, "utf8")).toBeLessThanOrEqual(512);
        expect(projected.toolName).not.toContain(toolName);
    });

    it("durable assistant 与 tool result 遇到非法 toolCallId 时 fail closed", () => {
        const invalidId = "工".repeat(200);
        expect(() => projectAgentChatEntry({
            id: "assistant-invalid-tool-id",
            parentId: null,
            timestamp: 1,
            type: "message",
            origin: "ingest",
            message: {
                role: "assistant",
                content: [{type: "toolCall", id: invalidId, name: "read", arguments: {path: "manuscript/1.md"}}],
                api: "test",
                provider: "test",
                model: "test",
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "toolUse",
                timestamp: 1,
            },
        })).toThrow("Tool call identity 无效");

        expect(() => projectAgentChatEntry({
            id: "tool-result-invalid-tool-id",
            parentId: null,
            timestamp: 1,
            type: "message",
            origin: "ingest",
            message: {
                role: "toolResult",
                toolCallId: " ",
                toolName: "read",
                content: [{type: "text", text: "ok"}],
                isError: false,
                timestamp: 1,
            },
        })).toThrow("Tool call identity 无效");
    });
});
