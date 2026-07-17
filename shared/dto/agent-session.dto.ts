import {z} from "zod";
import type {JsonValue, Model, Usage} from "nbook/server/agent/messages/types";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import type {AgentChatEntryDto, AgentUserInputFormDto, PublicToolArgsDto, PublicToolResultDto} from "nbook/shared/dto/agent-public-event.dto";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const AgentSessionIdSchema = z.number().int().positive();

/**
 * Agent 工作模式（Task 90）。
 * - normal：无特殊约束，可读可写。
 * - discuss：只读讨论导向，写文件工具挂起审批。
 * - plan：只读计划导向，写文件工具挂起审批（计划目录内 .md 豁免）。
 */
export const AgentModeSchema = z.enum(["normal", "discuss", "plan"]);

export type AgentMode = z.infer<typeof AgentModeSchema>;

/**
 * 判断模式是否为只读模式（discuss / plan 共有约束：写文件工具需审批）。
 */
export function isReadonlyMode(mode: AgentMode): boolean {
    return mode === "discuss" || mode === "plan";
}

export const AgentUserMessageInputDtoSchema = z.object({
    text: z.string(),
    images: z.array(z.object({
        type: z.literal("image"),
        mimeType: z.string().trim().min(1),
        data: z.string().trim().min(1).max(AGENT_IMAGE_POLICY.maxImageEncodedChars),
    }).strict()).max(AGENT_IMAGE_POLICY.maxInputImages).optional(),
}).strict();

export const AgentResolutionDtoSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("tool_approval"),
        toolCallId: z.string().trim().min(1),
        approved: z.boolean(),
        resultText: z.string().optional(),
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }),
    z.object({
        kind: z.literal("user_input"),
        toolCallId: z.string().trim().min(1),
        /** Task 63: Low-Code Form 提交数据（存在时优先于 answers）。 */
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }).refine((value) => value.data !== undefined || value.answers !== undefined, {
        message: "user_input resolution 必须提供 data 或 answers",
    }),
]);

export type AgentResolutionDto = z.infer<typeof AgentResolutionDtoSchema>;

export const AgentCreateSessionRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    initial: JsonValueSchema.optional(),
    workspaceRoot: z.string().trim().min(1).optional(),
    workspaceKey: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    parentSessionId: AgentSessionIdSchema.optional(),
});

export const AgentInvokeRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue", "steer", "followup"]),
    message: AgentUserMessageInputDtoSchema.optional(),
    input: JsonValueSchema.optional(),
    title: z.string().trim().min(1).optional(),
    resolution: AgentResolutionDtoSchema.optional(),
    resolutions: z.array(AgentResolutionDtoSchema).optional(),
    clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
    caller: z.never().optional(),
    block: z.boolean().optional(),
}).superRefine((value, ctx) => {
    if ((value.mode === "prompt" || value.mode === "steer" || value.mode === "followup") && !value.message && value.input === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: `${value.mode} 模式必须提供 message 或 input`,
        });
    }
    if (value.mode === "continue" && (value.message || value.input !== undefined)) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: "continue 模式不能提供 message 或 input",
        });
    }
    if (value.resolution && value.resolutions) {
        ctx.addIssue({
            code: "custom",
            path: ["resolution"],
            message: "不能同时提供 resolution 和 resolutions",
        });
    }
});

export const AgentSessionListQueryDtoSchema = z.object({
    workspaceKey: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    includeArchived: z.coerce.boolean().optional(),
    includeSystem: z.coerce.boolean().optional(),
    profileKey: z.string().trim().min(1).optional(),
    profileGroup: z.enum(["all", "leader"]).optional(),
    status: z.enum(["all", "active", "running", "waiting", "idle", "interrupted", "archived"]).optional(),
    relation: z.enum(["all", "top", "child"]).optional(),
    search: z.string().trim().optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentSessionEventsQueryDtoSchema = z.object({
    after: z.coerce.number().int().nonnegative().optional(),
    eventEpoch: z.string().trim().min(1).optional(),
});

/**
 * Agent session 查询视图。空 query 与 recovery 等价；其它视图必须严格携带
 * 自己需要的参数，避免 cursor/include 等组合扩散到各个调用者。
 */
export const AgentSessionQueryDtoSchema = z.union([
    z.object({view: z.literal("recovery")}).strict(),
    z.object({view: z.literal("history"), cursor: z.string().trim().min(1).max(2048)}).strict(),
    z.object({view: z.literal("systemPrompt")}).strict(),
    z.object({}).strict(),
]);

export const AgentCommandRequestDtoSchema = z.discriminatedUnion("command", [
    z.object({command: z.literal("new")}),
    z.object({command: z.literal("archive"), reason: z.string().optional()}),
    z.object({command: z.literal("compact"), instructions: z.string().optional()}),
    z.object({command: z.literal("mode"), mode: AgentModeSchema}),
    z.object({command: z.literal("model"), modelKey: z.string().trim().min(1).nullable()}),
    z.object({command: z.literal("thinking"), thinkingLevel: ThinkingLevelSchema.nullable()}),
    z.object({command: z.literal("rename"), title: z.string().trim().min(1)}),
    z.object({command: z.literal("summarize")}),
    z.object({command: z.literal("retry"), entryId: z.string().trim().min(1).optional()}),
    z.object({command: z.literal("fork"), entryId: z.string().trim().min(1).optional()}),
    z.object({
        command: z.literal("tree"),
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
    }),
]);

export const AgentTreeRequestDtoSchema = z.union([
    z.object({
        position: z.literal("empty"),
    }),
    z.object({
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
        next: z.object({
            type: z.literal("invoke"),
            mode: z.enum(["prompt", "continue"]),
            message: AgentUserMessageInputDtoSchema.optional(),
            clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
        }).optional(),
    }),
]);

export const AgentAbortRequestDtoSchema = z.object({
    reason: z.string().optional(),
    clearQueue: z.boolean().optional(),
});

export const ClientVariablePatchAckDtoSchema = z.object({
    namespace: z.literal("client"),
    path: z.string().trim().min(1),
    operations: z.array(z.any()),
    appliedValue: JsonValueSchema.optional(),
    error: z.string().optional(),
    invocationId: z.string().optional(),
    toolCallId: z.string().optional(),
});

export type AgentCreateSessionRequestDto = z.infer<typeof AgentCreateSessionRequestDtoSchema>;
export type AgentUserMessageInputDto = z.infer<typeof AgentUserMessageInputDtoSchema>;
export type AgentInvokeRequestDto = z.infer<typeof AgentInvokeRequestDtoSchema>;
export type AgentSessionListQueryDto = z.infer<typeof AgentSessionListQueryDtoSchema>;
export type AgentSessionEventsQueryDto = z.infer<typeof AgentSessionEventsQueryDtoSchema>;
export type AgentSessionQueryDto = z.infer<typeof AgentSessionQueryDtoSchema>;
export type AgentCommandRequestDto = z.infer<typeof AgentCommandRequestDtoSchema>;
export type AgentTreeRequestDto = z.infer<typeof AgentTreeRequestDtoSchema>;
export type AgentAbortRequestDto = z.infer<typeof AgentAbortRequestDtoSchema>;
export type ClientVariablePatchAckDto = z.infer<typeof ClientVariablePatchAckDtoSchema> & VariablePatchAck;

export const AgentSkillCatalogItemDtoSchema = z.object({
    name: z.string().trim().min(1, "skill.name 不能为空"),
    description: z.string().trim().min(1, "skill.description 不能为空"),
});

export const ClientVariablesDtoSchema = z.object({
    ide: z.record(z.string(), JsonValueSchema).optional(),
    studio: z.record(z.string(), JsonValueSchema).optional(),
}).catchall(JsonValueSchema.optional());

export type AgentSkillCatalogItemDto = z.infer<typeof AgentSkillCatalogItemDtoSchema>;
export type ClientVariablesDto = z.infer<typeof ClientVariablesDtoSchema>;
export type ClientStateSnapshotDto = ClientVariablesDto;

export type AgentSessionStatus = "idle" | "running" | "waiting" | "archived" | "interrupted";
export type AgentSessionProfileAvailability = "loaded" | "missing" | "unloadable";

export type AgentEventCursorDto = {
    eventEpoch: string;
    /** 前端已经处理到的事件序号；订阅 SSE 时使用 after=该值。 */
    after: number;
};

export type AgentSessionContextUsageDto = {
    /** 当前 active context 的 token 估算值。 */
    usedTokens: number;
    /** 当前模型 context window；为空表示模型未声明窗口。 */
    limitTokens: number | null;
    /** usedTokens / limitTokens 的百分比；limitTokens 为空时为空。 */
    percent: number | null;
    estimated: true;
};

export type AgentSessionSummaryDto = {
    sessionId: number;
    profileKey: string;
    /**
     * 当前 session 引用的 profile 是否仍可用于后续运行。
     * 为空只会出现在仓储层原始摘要；HTTP runtime 投影会始终填充。
     */
    profileAvailability?: AgentSessionProfileAvailability;
    /** profile 不可继续运行时的用户可读原因；profile 可用时为空。 */
    profileIssueMessage?: string;
    workspaceKey: string;
    workspaceRoot: string;
    projectPath?: string;
    parentSessionId?: number;
    systemRole?: "summarizer";
    title?: string;
    summary?: string;
    status: AgentSessionStatus;
    updatedAt: number;
    archived: boolean;
    lastMessagePreview?: string;
    usage?: Usage;
};

export type AgentSessionListPageDto = {
    items: AgentSessionSummaryDto[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
};

export type AgentSessionSummarizerStateDto = {
    running: boolean;
    dirty: boolean;
    /** 最近一次构建出的 Agent Dialogue Content token 估算。为空表示尚未运行过。 */
    lastDialogueContentTokens?: number;
    /** 最近一次成功摘要的完成时间。为空表示尚未成功写回过。 */
    lastRunAt?: number;
    /** 最近一次后台摘要错误。为空表示当前没有可展示错误。 */
    lastError?: string;
};

export type AgentSessionProfileGroup = "all" | "leader";
export type AgentSessionStatusFilter = "all" | "active" | "running" | "waiting" | "idle" | "interrupted" | "archived";
export type AgentSessionRelationFilter = "all" | "top" | "child";

/** 当前有效关联的 Agent session；历史 detach 状态不会进入该 DTO。 */
export type AgentLinkedSessionDto = AgentSessionSummaryDto;

export type AgentSessionRelationsDto = {
    sessionId: number;
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
};

export type AgentPendingUserInputDto = {
    assistantMessageId?: string;
    toolCallId: string;
    toolName: string;
    args?: PublicToolArgsDto;
    planFilePath?: string;
    /** 仅 recovery 返回完整计划正文；live state 不携带。 */
    planContent?: string;
    planContentBytes?: number;
    /** Low-Code Form 规格，从 tool.user-input-required 事件复制；存在时优先于 args.form。 */
    formSpec?: {
        form: AgentUserInputFormDto;
        layout?: "dialog" | "inline" | "fullscreen";
        prompt?: string;
    };
};

/** @deprecated 使用 AgentPendingUserInputDto */
export type AgentPendingApprovalDto = AgentPendingUserInputDto;

export type AgentQueuedMessageDto = {
    id: string;
    kind: "steer" | "followup";
    text?: import("nbook/shared/dto/agent-public-event.dto").PublicTextPreviewDto;
    images: Array<{mimeType: string; dataBytes: number; dataOmitted: true}>;
    omittedImages: number;
    input?: import("nbook/shared/dto/agent-public-event.dto").PublicValuePreviewDto;
    createdAt: number;
};

export type AgentFollowUpQueueItemDto = AgentQueuedMessageDto;

export type AgentFollowUpQueueStateDto = {
    status: "ready" | "paused";
    pausedBy?: {
        invocationId: string;
        reason: "error" | "aborted" | "interrupted";
    };
    items: AgentFollowUpQueueItemDto[];
    omittedItems: number;
};

export type AgentQueuedMessageListDto = {
    items: AgentQueuedMessageDto[];
    omittedItems: number;
};

export type AgentQueueSummaryDto = {count: number};
export type AgentFollowUpQueueSummaryDto = AgentQueueSummaryDto & Pick<AgentFollowUpQueueStateDto, "status" | "pausedBy">;

export type AgentActiveInvocationDto = {
    invocationId: string;
    sessionId: number;
    status: "running" | "waiting" | "aborting";
    mode: "prompt" | "continue" | "compact";
    startedAt: number;
};

export type AgentSessionLiveStateDto = {
    summary: AgentSessionSummaryDto;
    /** 后台标题/摘要维护状态。为空表示当前 session 未启用或尚无摘要状态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本;变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    pendingUserInputs: AgentPendingUserInputDto[];
    steerQueue: AgentQueueSummaryDto;
    followUpQueue: AgentFollowUpQueueSummaryDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    contextUsage?: AgentSessionContextUsageDto;
};

export type AgentInvocationErrorPhaseDto = "prepare" | "pre_loop" | "model" | "tool" | "ingest" | "compaction" | "settleRun" | "unknown";

export type AgentInvocationErrorInfoDto = {
    message: string;
    phase: AgentInvocationErrorPhaseDto;
    retryable?: boolean;
    code?: string;
};

/** 阻塞 invocation HTTP 返回；内部 run/caller/callback 不进入公开 DTO。 */
export type InvokeAgentResult = {
    sessionId: number;
    invocationId: string;
    status: "completed" | "waiting" | "error";
    finalMessage?: string;
    reportResult?: {
        result: string;
        success?: boolean;
        /** 为空表示本次主路没有可用结构化 JSON 结果。 */
        data?: JsonValue;
    };
    error?: string;
    errorPhase?: AgentInvocationErrorPhaseDto;
    errorInfo?: AgentInvocationErrorInfoDto;
    usage?: Usage;
    elapsedMs?: number;
    queuedItem?: AgentQueuedMessageDto;
};

export type AgentCommandResult =
    | {
        kind: "live_state";
        status: "completed" | "started";
        sessionId: number;
        state: AgentSessionLiveStateDto;
    }
    | {
        kind: "created_session";
        status: "completed";
        sessionId: number;
        createdSession: AgentSessionSummaryDto;
    };

export type AgentTreeResult = {
    status: "completed" | "invoked";
    state: AgentSessionLiveStateDto;
    invocation?: InvokeAgentResult;
};

export type AgentAbortResult = {
    status: "idle" | "aborted";
    sessionId: number;
};

export type AgentAssistantUpdateDto =
    | {type: "text_start"; contentIndex: number}
    | {type: "text_delta"; contentIndex: number; delta: string; deltaBytes: number; deltaOmitted: boolean}
    | {type: "text_end"; contentIndex: number}
    | {type: "thinking_start"; contentIndex: number}
    | {type: "thinking_delta"; contentIndex: number; delta: string; deltaBytes: number; deltaOmitted: boolean}
    | {type: "thinking_end"; contentIndex: number}
    | {
        type: "toolcall_start";
        contentIndex: number;
        toolCallId?: string;
        toolName?: string;
    }
    | {
        type: "toolcall_args";
        contentIndex: number;
        toolCallId?: string;
        toolName?: string;
        args: PublicToolArgsDto;
        streamBytes: number;
        omitted: boolean;
    }
    | {
        type: "toolcall_end";
        contentIndex: number;
        toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
    };

export type AgentRuntimeStreamEventDto =
    | {
        type: "agent_start";
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "agent_end";
        status: "completed" | "waiting" | "failed" | "aborted" | "interrupted";
        usage?: Usage;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "turn_start";
        turnIndex: number;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "turn_end";
        turnIndex: number;
        status: "completed" | "waiting" | "failed";
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "message_start";
        messageId: string;
        role: "assistant";
        timestamp: number;
        model: string;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "message_update";
        messageId: string;
        update: AgentAssistantUpdateDto;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "message_end";
        messageId: string;
        stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
        usage: Usage;
        responseModel?: string;
        errorMessage?: string;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_start";
        toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_update";
        toolCallId: string;
        toolName: string;
        partialResult: PublicToolResultDto;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_end";
        toolCallId: string;
        toolName: string;
        result: PublicToolResultDto;
        isError: boolean;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool.user-input-required";
        toolCallId: string;
        toolName: string;
        args: PublicToolArgsDto;
        formSpec?: {
            form: AgentUserInputFormDto;
            prompt?: string;
            layout?: "dialog" | "inline" | "fullscreen";
        };
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar.start";
        sidecarType: string;
        stage: string;
        leafId: string;
    }
    | {
        type: "sidecar.complete";
        sidecarType: string;
        stage: string;
        leafId: string;
    }
    | {
        type: "sidecar.error";
        sidecarType: string;
        stage: string;
        error: string;
    }
    | {
        type: "sidecar_start";
        /** sidecar 类型名称，例如 "context-load" */
        sidecarType: string;
        /** sidecar 执行阶段，prepareRun 或 settleRun */
        stage: "prepareRun" | "settleRun";
        /** sidecar transcript 在 session 中的 leafId */
        leafId: string | null;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_complete";
        sidecarType: string;
        stage: "prepareRun" | "settleRun";
        leafId: string | null;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_error";
        sidecarType: string;
        stage: "prepareRun" | "settleRun";
        leafId: string | null;
        error: string;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_merge";
        /** 合并了哪些 sidecar 的数据 */
        sidecarTypes: string[];
        stage: "prepareRun" | "settleRun";
        /** 合并后实际写入 persistedMessages 的消息数量 */
        mergedMessageCount: number;
        sidecarContext?: { type: string; leafId: string };
    };

export type AgentSessionControlEvent =
    | {
        type: "connected";
        eventEpoch: string;
        latestSeq: number;
    }
    | {
        type: "snapshot_required";
        reason: string;
    }
    | {
        type: "steer_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "follow_up_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "session_entry";
        entry: AgentChatEntryDto;
    }
    | {
        type: "session_projection_invalidated";
        reason: "linked_agent_changed" | "pending_plan_content_changed";
    }
    | {
        type: "session_state_changed";
        state: AgentSessionLiveStateDto;
    }
    | {
        type: "invocation_aborted";
        reason?: string;
    }
    | {
        type: "client_variable_patch_requested";
        request: VariablePatchRequest;
    };

export type AgentSessionEventDto =
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "runtime";
        event: AgentRuntimeStreamEventDto;
    }
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };

/** Agent Chat Flow 的一页 durable history；entries 始终按旧到新排列。 */
export type AgentChatHistoryPageDto = {
    entries: AgentChatEntryDto[];
    /** 为空表示已经到达当前 active path 起点。 */
    previousCursor: string | null;
};

/** 打开、刷新或 SSE recovery 使用的 session 恢复真相。 */
export type AgentSessionRecoveryDto = {
    kind: "recovery";
    eventCursor: AgentEventCursorDto;
    summary: AgentSessionSummaryDto;
    /** 后台展示标题/摘要维护状态；仅面向 UI，不影响 Agent 运行态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本；变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
    tree: SessionTreeNode[];
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    pendingUserInputs: AgentPendingUserInputDto[];
    steerQueue: AgentQueuedMessageListDto;
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    contextUsage?: AgentSessionContextUsageDto;
};

/** 向 active path 起点翻页时返回的纯 history 响应。 */
export type AgentSessionHistoryPageDto = {
    kind: "history";
    sessionId: number;
    activePathRevision: string | null;
    history: AgentChatHistoryPageDto;
};

/** 显式查看时才构建的 provider system prompt。 */
export type AgentSessionSystemPromptDto = {
    kind: "systemPrompt";
    sessionId: number;
    systemPrompt: string;
};

export type AgentSessionQueryResultDto =
    | AgentSessionRecoveryDto
    | AgentSessionHistoryPageDto
    | AgentSessionSystemPromptDto;
