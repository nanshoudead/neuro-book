import {afterEach, describe, expect, expectTypeOf, it, vi} from "vitest";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import type {AgentAbortResult} from "nbook/shared/dto/agent-session.dto";

const globalWithFetch = globalThis as unknown as Record<string, unknown>;
let previousFetch: unknown;

describe("useAgentSessionApi", () => {
    afterEach(() => {
        globalWithFetch.$fetch = previousFetch;
        previousFetch = undefined;
    });

    it("getSessionRelations 请求轻量关联关系接口", async () => {
        const relations = {
            sessionId: 12,
            linkedAgents: [],
            linkedByAgents: [],
        };
        const fetchMock = vi.fn(async () => relations);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.getSessionRelations(12)).resolves.toEqual(relations);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/12/relations");
    });

    it("使用单一 session GET 的 recovery/history/systemPrompt 判别查询", async () => {
        const recovery = {kind: "recovery", history: {entries: [], previousCursor: null}};
        const history = {kind: "history", sessionId: 12, activePathRevision: "rev-1", history: {entries: [], previousCursor: null}};
        const systemPrompt = {kind: "systemPrompt", sessionId: 12, systemPrompt: "SYSTEM"};
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(recovery)
            .mockResolvedValueOnce(history)
            .mockResolvedValueOnce(systemPrompt);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.getSessionRecovery(12)).resolves.toEqual(recovery);
        await expect(api.getSessionHistory(12, "cursor-1")).resolves.toEqual(history);
        await expect(api.getSessionSystemPrompt(12)).resolves.toEqual(systemPrompt);

        expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/agent/sessions/12", {query: {view: "recovery"}});
        expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agent/sessions/12", {query: {view: "history", cursor: "cursor-1"}});
        expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/agent/sessions/12", {query: {view: "systemPrompt"}});
    });

    it("listSessions 返回分页结果", async () => {
        const page = {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            hasMore: false,
        };
        const fetchMock = vi.fn(async () => page);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.listSessions({workspaceKey: "global", limit: 50})).resolves.toEqual(page);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions", {
            query: {workspaceKey: "global", limit: 50},
        });
    });

    it("runCommand 返回判别联合结果", async () => {
        const result = {
            kind: "live_state",
            status: "completed",
            sessionId: 12,
            state: {
                summary: {
                    sessionId: 12,
                    profileKey: "leader.default",
                    workspaceKey: "global",
                    workspaceRoot: "workspace",
                    status: "idle",
                    updatedAt: 1,
                    archived: false,
                },
                activeLeafId: null,
                activePathRevision: null,
                pendingUserInputs: [],
                steerQueue: [],
                followUpQueue: {status: "ready", items: []},
                activeInvocation: null,
                model: null,
                thinkingLevel: null,
                effectiveThinkingLevel: "off",
                agentMode: "plan",
            },
        };
        const fetchMock = vi.fn(async () => result);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.runCommand(12, {command: "mode", mode: "plan"})).resolves.toEqual(result);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/12/commands", {
            method: "POST",
            body: {command: "mode", mode: "plan"},
        });
    });

    it("abortSession 消费 shared AgentAbortResult 合同", async () => {
        const result: AgentAbortResult = {status: "aborted", sessionId: 12};
        const fetchMock = vi.fn(async () => result);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const request = useAgentSessionApi().abortSession(12, {reason: "user abort"});

        expectTypeOf(request).toEqualTypeOf<Promise<AgentAbortResult>>();
        await expect(request).resolves.toEqual(result);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/12/abort", {
            method: "POST",
            body: {reason: "user abort"},
        });
    });
});
