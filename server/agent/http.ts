import {createError, getRouterParam} from "h3";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentHistoryQueryError} from "nbook/server/agent/session/history-query";
import {isAttachmentError} from "nbook/server/agent/attachments/types";
import {projectPublicInvocationResult} from "nbook/server/agent/events/public-invocation-result-projection";
import type {InvokeAgentInput} from "nbook/server/agent/harness/types";
import type {ServerTimingSink} from "nbook/server/utils/server-timing";
import {
    AgentSessionIdSchema,
    type AgentAbortRequestDto,
    type AgentCommandRequestDto,
    type AgentCreateSessionRequestDto,
    type ClientVariablePatchAckDto,
    type AgentInvokeRequestDto,
    type AgentSessionEventsQueryDto,
    type AgentSessionListPageDto,
    type AgentSessionListQueryDto,
    type AgentSessionQueryDto,
    type AgentSessionQueryResultDto,
    type AgentTreeRequestDto,
    type AgentTreeResult,
    type InvokeAgentResult,
} from "nbook/shared/dto/agent-session.dto";

type GlobalAgentHttp = {
    agentHarness?: NeuroAgentHarness;
};

const globalForAgentHttp = globalThis as typeof globalThis & GlobalAgentHttp;

/**
 * 获取 Agent Harness 单例。session 真相在 JSONL，单例只持有运行期事件中心和依赖。
 */
export function useAgentHarness(): NeuroAgentHarness {
    if (!globalForAgentHttp.agentHarness) {
        const runtimePaths = runtimePathsFromEnv();
        globalForAgentHttp.agentHarness = new NeuroAgentHarness({
            runtimePaths,
            repo: new JsonlSessionRepository(runtimePaths.workspaceRoot),
            watchProfiles: true,
            holdAttachmentRuntimeLease: true,
        });
    }
    return globalForAgentHttp.agentHarness;
}

/** 释放 HTTP 单例持有的 Workspace Root runtime lease。 */
export async function disposeAgentHarness(): Promise<void> {
    const harness = globalForAgentHttp.agentHarness;
    globalForAgentHttp.agentHarness = undefined;
    await harness?.dispose();
}

/**
 * 读取数字 sessionId 路由参数。
 */
export function requireAgentSessionId(event: Parameters<typeof getRouterParam>[0]): number {
    const raw = getRouterParam(event, "sessionId");
    const parsed = AgentSessionIdSchema.safeParse(Number(raw));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    return parsed.data;
}

/**
 * 创建 Agent session。
 */
export async function createAgentSession(body: AgentCreateSessionRequestDto, harness = useAgentHarness()) {
    return harness.createAgent({
        profileKey: body.profileKey,
        initial: body.initial,
        workspaceRoot: body.workspaceRoot,
        workspaceKey: body.workspaceKey,
        projectPath: body.projectPath,
        parentSessionId: body.parentSessionId,
    });
}

/**
 * 列出 Agent session 摘要。
 */
export async function listAgentSessions(query: AgentSessionListQueryDto, harness = useAgentHarness()): Promise<AgentSessionListPageDto> {
    if ("listSessionPage" in harness && typeof harness.listSessionPage === "function") {
        return harness.listSessionPage(query);
    }
    const items = await harness.listSessions(query);
    return {
        items,
        total: items.length,
        offset: query.offset ?? 0,
        limit: query.limit ?? items.length,
        hasMore: false,
    };
}

/**
 * 按 query view 返回 session recovery、history 或 system prompt。
 */
export async function getAgentSessionQuery(
    sessionId: number,
    query: AgentSessionQueryDto,
    harness = useAgentHarness(),
    timingSink?: ServerTimingSink,
): Promise<AgentSessionQueryResultDto> {
    try {
        return timingSink
            ? await harness.getSessionQuery(sessionId, query, timingSink)
            : await harness.getSessionQuery(sessionId, query);
    } catch (error) {
        if (error instanceof AgentHistoryQueryError) {
            throw createError({
                statusCode: error.statusCode,
                message: error.message,
                data: {code: error.code},
            });
        }
        throw error;
    }
}

/**
 * 返回关联 Agent 面板使用的轻量关系投影。
 */
export async function getAgentSessionRelations(sessionId: number, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return timingSink
        ? harness.getSessionRelations(sessionId, timingSink)
        : harness.getSessionRelations(sessionId);
}

/**
 * 阻塞调用 Agent session。
 */
export async function invokeAgentSession(sessionId: number, body: AgentInvokeRequestDto, harness = useAgentHarness()): Promise<InvokeAgentResult> {
    try {
        const result = await harness.invokeAgent(toInvokeInput(sessionId, body));
        return projectPublicInvocationResult(result);
    } catch (error) {
        if (!isAttachmentError(error)) {
            throw error;
        }
        if (error.code === "limit_exceeded") {
            throw createError({
                statusCode: 413,
                message: "图片超过允许预算",
                data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED", retryable: false},
            });
        }
        if (error.code === "storage_failed") {
            throw createError({
                statusCode: 503,
                message: "Attachment 存储暂不可用",
                data: {code: "ATTACHMENT_STORAGE_UNAVAILABLE", retryable: true},
            });
        }
        throw createError({
            statusCode: 400,
            message: "图片输入无效",
            data: {code: "INVALID_IMAGE_INPUT", retryable: false},
        });
    }
}

/**
 * 执行 session command。slash command 在前端识别后进入这里。
 */
export async function runAgentSessionCommand(sessionId: number, body: AgentCommandRequestDto, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return timingSink
        ? harness.runCommand(sessionId, body, timingSink)
        : harness.runCommand(sessionId, body);
}

/**
 * 切换 session tree，并可在切换后立即 invoke。
 *
 * 当前实现先移动 leaf 再 invoke；若 invoke 失败，leaf 不会自动回滚。
 */
export async function moveAgentSessionTree(sessionId: number, body: AgentTreeRequestDto, harness = useAgentHarness()): Promise<AgentTreeResult> {
    const result = await harness.moveTree(sessionId, body);
    return result.invocation
        ? {...result, invocation: projectPublicInvocationResult(result.invocation)}
        : {status: result.status, state: result.state};
}

/**
 * 请求中断当前 invocation。
 */
export async function abortAgentSession(sessionId: number, body: AgentAbortRequestDto, harness = useAgentHarness()) {
    return harness.abortInvocation(sessionId, body);
}

/**
 * 前端确认 client.* variable patch 已应用。
 */
export async function acknowledgeClientVariablePatch(sessionId: number, body: ClientVariablePatchAckDto, harness = useAgentHarness()) {
    await harness.acknowledgeClientVariablePatch(sessionId, body);
    return {ok: true};
}

/**
 * 订阅 session 事件。
 */
export function subscribeAgentSessionEvents(sessionId: number, cursor: AgentSessionEventsQueryDto = {}, harness = useAgentHarness()) {
    return harness.subscribeSessionEvents(sessionId, cursor);
}

/** 解析并读取 Chat Flow durable attachment。 */
export async function readAgentSessionAttachment(sessionId: number, entryId: string, contentIndex: number, harness = useAgentHarness()) {
    const locator = await harness.resolveSessionAttachment(sessionId, entryId, contentIndex);
    return {
        ...locator,
        bytes: await harness.attachmentStore.load(locator.ref),
    };
}

/**
 * 将 HTTP DTO 转成 harness invoke 输入。
 */
export function toInvokeInput(
    sessionId: number,
    body: AgentInvokeRequestDto,
    onEvent?: InvokeAgentInput["onEvent"],
): InvokeAgentInput {
    return {
        sessionId,
        mode: body.mode,
        message: body.message,
        payload: body.input,
        title: body.title,
        resolution: body.resolution as InvokeAgentInput["resolution"],
        resolutions: body.resolutions as InvokeAgentInput["resolutions"],
        clientState: body.clientState,
        caller: {kind: "user"},
        block: body.block,
        onEvent,
    };
}
