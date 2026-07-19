import {describe, expect, it, vi} from "vitest";
import {
    abortAgentSession,
    createAgentSession,
    getAgentSessionRelations,
    getAgentSessionQuery,
    invokeAgentSession,
    listAgentSessions,
    moveAgentSessionTree,
    runAgentSessionCommand,
    toInvokeInput,
} from "nbook/server/agent/http";
import {AgentHistoryQueryError} from "nbook/server/agent/session/history-query";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

describe("agent session http helpers", () => {
    it("createAgentSession 调用 harness.createAgent", async () => {
        const createAgent = vi.fn(async () => ({
            sessionId: 7,
            profileKey: "leader.default",
            title: "Leader",
        }));

        await expect(createAgentSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            parentSessionId: 1,
        }, {createAgent} as never)).resolves.toEqual(expect.objectContaining({
            sessionId: 7,
        }));

        expect(createAgent).toHaveBeenCalledWith({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            parentSessionId: 1,
        });
    });

    it("listAgentSessions 调用 harness.listSessionPage", async () => {
        const listSessionPage = vi.fn(async () => ({
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
            hasMore: false,
        }));
        const query = {
            workspaceKey: "global",
            includeArchived: true,
            profileGroup: "leader",
            status: "active",
            relation: "top",
            limit: 25,
        } as const;

        await expect(listAgentSessions(query, {listSessionPage} as never)).resolves.toEqual(expect.objectContaining({
            items: [],
            total: 0,
        }));

        expect(listSessionPage).toHaveBeenCalledWith(query);
    });

    it("getAgentSessionQuery 调用 harness.getSessionQuery", async () => {
        const getSessionQuery = vi.fn(async () => ({kind: "recovery", summary: {sessionId: 12}}));

        await getAgentSessionQuery(12, {}, {getSessionQuery} as never);

        expect(getSessionQuery).toHaveBeenCalledWith(12, {});
    });

    it("history cursor 错误映射为稳定 HTTP code", async () => {
        const getSessionQuery = vi.fn(async () => {
            throw new AgentHistoryQueryError("ACTIVE_PATH_CHANGED", "active path changed");
        });

        await expect(getAgentSessionQuery(12, {
            view: "history",
            cursor: "cursor-1",
        }, {getSessionQuery} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "ACTIVE_PATH_CHANGED"},
        });
    });

    it("getAgentSessionRelations 调用 harness.getSessionRelations", async () => {
        const getSessionRelations = vi.fn(async () => ({
            sessionId: 12,
            linkedAgents: [],
            linkedByAgents: [],
        }));

        await getAgentSessionRelations(12, {getSessionRelations} as never);

        expect(getSessionRelations).toHaveBeenCalledWith(12);
    });

    it("invokeAgentSession 调用 harness.invokeAgent", async () => {
        const invokeAgent = vi.fn(async () => ({
            sessionId: 12,
            invocationId: "run-1",
            status: "completed",
        }));

        await invokeAgentSession(12, {
            mode: "prompt",
            message: {text: "hello"},
            input: {plotId: "plot-1"},
            title: "Invoke title",
        }, {invokeAgent} as never);

        expect(invokeAgent).toHaveBeenCalledWith({
            sessionId: 12,
            mode: "prompt",
            message: {text: "hello"},
            payload: {plotId: "plot-1"},
            title: "Invoke title",
            resolution: undefined,
            clientState: undefined,
            caller: {kind: "user"},
            block: undefined,
            onEvent: undefined,
        });
    });

    it("invokeAgentSession 保留内部结构化结果但只返回有界 HTTP 摘要", async () => {
        const data = {body: "完整结构化正文".repeat(100_000)};
        const reportText = "\u0000".repeat(100_000);
        const finalMessage = "最终正文".repeat(100_000);
        const internalResult = {
            sessionId: 12,
            invocationId: "run-large-output",
            status: "completed" as const,
            finalMessage,
            reportResult: {
                result: reportText,
                success: true,
                data,
            },
        };

        const result = await invokeAgentSession(12, {
            mode: "prompt",
            message: {text: "hello"},
        }, {
            invokeAgent: vi.fn(async () => internalResult),
        } as never);

        expect(internalResult.reportResult.data).toBe(data);
        expect(result.reportResult).toEqual(expect.objectContaining({
            success: true,
            resultBytes: Buffer.byteLength(reportText, "utf8"),
            resultOmitted: true,
            dataOmitted: true,
        }));
        expect(result.reportResult).not.toHaveProperty("data");
        expect(result.finalMessageOmitted).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    });

    it("invokeAgentSession 的 partial finalMessage 与重复错误文本共享响应预算", async () => {
        const errorMessage = "\u0000".repeat(4_000);
        const finalMessage = "部分正文".repeat(100_000);

        const result = await invokeAgentSession(12, {
            mode: "prompt",
            message: {text: "hello"},
        }, {
            invokeAgent: vi.fn(async () => ({
                sessionId: 12,
                invocationId: "run-large-error",
                status: "error",
                finalMessage,
                error: errorMessage,
                errorPhase: "model",
                errorInfo: {
                    message: errorMessage,
                    phase: "model",
                },
            })),
        } as never);

        expect(result.error).toBe(result.errorInfo?.message);
        expect(result.finalMessageOmitted).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(96 * 1024);
    });

    it("invokeAgentSession 将图片输入和存储错误映射为稳定 HTTP 合同", async () => {
        const body = {mode: "prompt" as const, message: {text: "hello"}};

        await expect(invokeAgentSession(12, body, {
            invokeAgent: vi.fn(async () => { throw new AttachmentError("invalid_input", "bad image"); }),
        } as never)).rejects.toMatchObject({statusCode: 400, data: {code: "INVALID_IMAGE_INPUT", retryable: false}});

        await expect(invokeAgentSession(12, body, {
            invokeAgent: vi.fn(async () => { throw new AttachmentError("limit_exceeded", "too large"); }),
        } as never)).rejects.toMatchObject({statusCode: 413, data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED", retryable: false}});

        await expect(invokeAgentSession(12, body, {
            invokeAgent: vi.fn(async () => { throw new AttachmentError("storage_failed", "offline"); }),
        } as never)).rejects.toMatchObject({statusCode: 503, data: {code: "ATTACHMENT_STORAGE_UNAVAILABLE", retryable: true}});
    });

    it("runAgentSessionCommand 调用 harness.runCommand", async () => {
        const runCommand = vi.fn(async () => ({
            status: "completed",
            sessionId: 12,
        }));

        await runAgentSessionCommand(12, {command: "mode", mode: "plan"}, {runCommand} as never);

        expect(runCommand).toHaveBeenCalledWith(12, {command: "mode", mode: "plan"});
    });

    it("热路径 helper 会把 Server-Timing sink 传给 harness", async () => {
        const timingSink = {mark: vi.fn()};
        const getSessionQuery = vi.fn(async () => ({kind: "recovery", summary: {sessionId: 12}}));
        const getSessionRelations = vi.fn(async () => ({
            sessionId: 12,
            linkedAgents: [],
            linkedByAgents: [],
        }));
        const runCommand = vi.fn(async () => ({
            status: "completed",
            sessionId: 12,
        }));

        await getAgentSessionQuery(12, {}, {getSessionQuery} as never, timingSink);
        await getAgentSessionRelations(12, {getSessionRelations} as never, timingSink);
        await runAgentSessionCommand(12, {command: "mode", mode: "plan"}, {runCommand} as never, timingSink);

        expect(getSessionQuery).toHaveBeenCalledWith(12, {}, timingSink);
        expect(getSessionRelations).toHaveBeenCalledWith(12, timingSink);
        expect(runCommand).toHaveBeenCalledWith(12, {command: "mode", mode: "plan"}, timingSink);
    });

    it("moveAgentSessionTree 调用 harness.moveTree 并投影嵌套 invocation", async () => {
        const moveTree = vi.fn(async () => ({
            status: "invoked",
            state: {},
            invocation: {
                sessionId: 12,
                invocationId: "tree-run-1",
                status: "completed",
                reportResult: {
                    result: "done",
                    data: {privateOutput: "完整内部结果"},
                },
            },
        }));

        const result = await moveAgentSessionTree(12, {targetEntryId: "entry-1", position: "at"}, {moveTree} as never);

        expect(moveTree).toHaveBeenCalledWith(12, {targetEntryId: "entry-1", position: "at"});
        expect(result.invocation?.reportResult).toEqual({
            result: "done",
            resultBytes: 4,
            resultOmitted: false,
            dataOmitted: true,
        });
        expect(result.invocation?.reportResult).not.toHaveProperty("data");
    });

    it("abortAgentSession 调用 harness.abortInvocation", async () => {
        const abortInvocation = vi.fn(async () => ({
            status: "aborted",
            sessionId: 12,
        }));

        await abortAgentSession(12, {reason: "stop"}, {abortInvocation} as never);

        expect(abortInvocation).toHaveBeenCalledWith(12, {reason: "stop"});
    });

    it("toInvokeInput 保留 streaming onEvent callback", () => {
        const onEvent = vi.fn();

        expect(toInvokeInput(4, {
            mode: "continue",
            resolution: {
                kind: "tool_approval",
                toolCallId: assertPublicToolCallId("tool-1"),
                approved: true,
            },
        }, onEvent)).toEqual({
            sessionId: 4,
            mode: "continue",
            message: undefined,
            payload: undefined,
            title: undefined,
            resolution: {
                kind: "tool_approval",
                toolCallId: "tool-1",
                approved: true,
            },
            clientState: undefined,
            caller: {kind: "user"},
            block: undefined,
            onEvent,
        });
    });
});
