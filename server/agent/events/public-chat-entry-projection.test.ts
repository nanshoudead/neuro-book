import {describe, expect, it} from "vitest";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import type {SessionEntry} from "nbook/server/agent/session/types";

describe("projectAgentChatEntry", () => {
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
});
