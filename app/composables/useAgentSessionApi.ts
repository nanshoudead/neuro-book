import {readSseStream} from "nbook/app/utils/http/read-sse";
import type {
    AgentAbortRequestDto,
    AgentAbortResult,
    AgentCommandResult,
    AgentCommandRequestDto,
    AgentCreateSessionRequestDto,
    AgentInvokeRequestDto,
    AgentSessionEventDto,
    AgentSessionEventsQueryDto,
    AgentSessionHistoryPageDto,
    AgentSessionListPageDto,
    AgentSessionListQueryDto,
    AgentSessionRelationsDto,
    AgentSessionRecoveryDto,
    AgentSessionSystemPromptDto,
    AgentTreeResult,
    AgentTreeRequestDto,
    ClientVariablePatchAckDto,
    InvokeAgentResult,
} from "nbook/shared/dto/agent-session.dto";

/**
 * Agent session HTTP API。新前端只使用 /api/agent/sessions/**。
 */
export function useAgentSessionApi() {
    const listSessions = (query: AgentSessionListQueryDto = {}) => {
        return $fetch<AgentSessionListPageDto>("/api/agent/sessions", {
            query,
        });
    };

    const createSession = (body: AgentCreateSessionRequestDto) => {
        return $fetch<{sessionId: number; profileKey: string; title?: string}>("/api/agent/sessions", {
            method: "POST",
            body,
        });
    };

    /** 获取打开/刷新/SSE recovery 所需的 shell 和最近 history 尾页。 */
    const getSessionRecovery = (sessionId: number) => {
        return $fetch<AgentSessionRecoveryDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "recovery"},
        });
    };

    /** 获取当前 active path 更早的一页 history。cursor 由服务端生成，前端不解析。 */
    const getSessionHistory = (sessionId: number, cursor: string) => {
        return $fetch<AgentSessionHistoryPageDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "history", cursor},
        });
    };

    /** 按需构建 provider system prompt，不将其伪装成 Chat Flow history。 */
    const getSessionSystemPrompt = (sessionId: number) => {
        return $fetch<AgentSessionSystemPromptDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "systemPrompt"},
        });
    };

    const getSessionRelations = (sessionId: number) => {
        return $fetch<AgentSessionRelationsDto>(`/api/agent/sessions/${sessionId}/relations`);
    };

    const invokeSession = (sessionId: number, body: AgentInvokeRequestDto) => {
        return $fetch<InvokeAgentResult>(`/api/agent/sessions/${sessionId}/invocations`, {
            method: "POST",
            body,
        });
    };

    const runCommand = (sessionId: number, body: AgentCommandRequestDto) => {
        return $fetch<AgentCommandResult>(`/api/agent/sessions/${sessionId}/commands`, {
            method: "POST",
            body,
        });
    };

    const moveTree = (sessionId: number, body: AgentTreeRequestDto) => {
        return $fetch<AgentTreeResult>(`/api/agent/sessions/${sessionId}/tree`, {
            method: "POST",
            body,
        });
    };

    const abortSession = (sessionId: number, body: AgentAbortRequestDto = {}) => {
        return $fetch<AgentAbortResult>(`/api/agent/sessions/${sessionId}/abort`, {
            method: "POST",
            body,
        });
    };

    const acknowledgeClientVariablePatch = (sessionId: number, body: ClientVariablePatchAckDto) => {
        return $fetch<{ok: boolean}>(`/api/agent/sessions/${sessionId}/client-variable-patch-acks`, {
            method: "POST",
            body,
        });
    };

    const subscribeSessionEvents = async (
        sessionId: number,
        cursor: AgentSessionEventsQueryDto,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options: {onOpen?: () => void} = {},
    ): Promise<void> => {
        const query = new URLSearchParams();
        if (typeof cursor.after === "number") {
            query.set("after", String(cursor.after));
        }
        if (cursor.eventEpoch) {
            query.set("eventEpoch", cursor.eventEpoch);
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        const response = await fetch(`/api/agent/sessions/${sessionId}/events${suffix}`, {
            signal,
        });
        await readSseStream<AgentSessionEventDto>(response, onEvent, options);
    };

    return {
        acknowledgeClientVariablePatch,
        abortSession,
        createSession,
        getSessionHistory,
        getSessionRecovery,
        getSessionRelations,
        getSessionSystemPrompt,
        invokeSession,
        listSessions,
        moveTree,
        runCommand,
        subscribeSessionEvents,
    };
}
