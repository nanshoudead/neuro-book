/**
 * 公开字符串预览。preview 是唯一公开正文；bytes 表示原始 UTF-8 大小。
 */
export type PublicTextPreviewDto = {
    preview: string;
    bytes: number;
    omitted: boolean;
};

/**
 * 未知工具值的有界结构预览。
 */
export type PublicValuePreviewDto =
    | {kind: "null"}
    | {kind: "boolean"; value: boolean}
    | {kind: "number"; value: number}
    | {kind: "string"; preview: string; bytes: number; omitted: boolean}
    | {kind: "array"; items: PublicValuePreviewDto[]; omittedItems: number}
    | {kind: "object"; entries: Array<{key: string; value: PublicValuePreviewDto}>; omittedEntries: number}
    | {kind: "unsupported"; valueType: string};

export type PublicWriteToolArgsDto = {
    kind: "write";
    path?: string;
    contentPreview: string;
    contentBytes: number;
    contentOmitted: boolean;
};

export type PublicEditToolArgsDto = {
    kind: "edit";
    path?: string;
    edits: Array<{
        oldTextPreview: string;
        oldTextBytes: number;
        oldTextOmitted: boolean;
        newTextPreview: string;
        newTextBytes: number;
        newTextOmitted: boolean;
    }>;
    omittedEdits: number;
};

export type PublicApplyPatchToolArgsDto = {
    kind: "apply_patch";
    patchPreview: string;
    patchBytes: number;
    patchOmitted: boolean;
    touchedFiles: string[];
    touchedFilesOmitted: boolean;
};

export type PublicGenericToolArgsDto = {
    kind: "generic";
    value: PublicValuePreviewDto;
};

/**
 * 公开工具参数。专用工具使用领域字段；未知工具只能进入有界 generic preview。
 */
export type PublicToolArgsDto =
    | PublicWriteToolArgsDto
    | PublicEditToolArgsDto
    | PublicApplyPatchToolArgsDto
    | PublicGenericToolArgsDto;

export type PublicToolContentDto =
    | {
        type: "text";
        textPreview: string;
        textBytes: number;
        textOmitted: boolean;
    }
    | {
        type: "image";
        mimeType: string;
        dataBytes: number;
        dataOmitted: true;
    };

export type PublicToolResultDetailsDto =
    | {
        kind: "file_change";
        diffPreview: string;
        diffBytes: number;
        diffOmitted: boolean;
        firstChangedLine?: number;
        files: string[];
        filesOmitted: boolean;
    }
    | {
        kind: "read";
        path?: string;
        startLine?: number;
        endLine?: number;
        totalLines?: number;
        nextOffset?: number;
    }
    | {
        kind: "bash";
        truncated: boolean;
        truncatedBy?: "bytes" | "lines";
        totalLines?: number;
        totalBytes?: number;
        fullOutputPath?: string;
    }
    | {
        kind: "request_user_input";
        answers: Array<{
            questionIndex?: number;
            text?: string;
            /** 原始回答正文未完整公开时为 true。 */
            textOmitted?: boolean;
            selectedOptionIndex?: number;
            note?: string;
            /** 原始补充说明未完整公开时为 true。 */
            noteOmitted?: boolean;
            ignored?: boolean;
        }>;
        omittedAnswers: number;
    }
    | {
        kind: "switch_mode";
        approved?: boolean;
        pending?: boolean;
        targetMode?: string;
    }
    | {
        kind: "task";
        value: PublicValuePreviewDto;
    }
    | {
        kind: "agent";
        sessionId?: number;
        profileKey?: string;
        status?: string;
        value: PublicValuePreviewDto;
    }
    | {
        kind: "generic";
        value: PublicValuePreviewDto;
    };

/**
 * 工具执行和 durable toolResult 共用的公开结果投影。
 */
export type PublicToolResultDto = {
    content: PublicToolContentDto[];
    omittedContentBlocks: number;
    details?: PublicToolResultDetailsDto;
};

export type AgentChatUserEntryDto = {
    id: string;
    timestamp: number;
    type: "user";
    content: PublicTextPreviewDto;
    intent: "normal" | "steer";
};

export type AgentChatAssistantEntryDto = {
    id: string;
    timestamp: number;
    type: "assistant";
    invocationId?: string;
    content: PublicTextPreviewDto;
    thinking: PublicTextPreviewDto;
    error?: PublicTextPreviewDto;
    status: "done" | "partial" | "interrupted" | "error";
    model: string;
    usage: Usage;
    toolCalls: Array<{
        id: string;
        index: number;
        name: string;
        args: PublicToolArgsDto;
    }>;
    omittedToolCalls: number;
};

export type AgentChatToolResultEntryDto = {
    id: string;
    timestamp: number;
    type: "tool_result";
    toolCallId: string;
    toolName: string;
    result: PublicToolResultDto;
    isError: boolean;
};

export type AgentChatSystemEntryDto = {
    id: string;
    timestamp: number;
    type: "system";
    source: "custom" | "reminder" | "compaction" | "branch_summary";
    label: string;
    content: PublicTextPreviewDto;
};

export type AgentChatInvocationErrorEntryDto = {
    id: string;
    timestamp: number;
    type: "invocation_error";
    invocationId: string;
    message: PublicTextPreviewDto;
    phase: string;
    retryable?: boolean;
    code?: string;
};

/**
 * Chat Flow 的逐 entry 公开真相。它不包含 Session Tree/账本内部字段。
 */
export type AgentChatEntryDto =
    | AgentChatUserEntryDto
    | AgentChatAssistantEntryDto
    | AgentChatToolResultEntryDto
    | AgentChatSystemEntryDto
    | AgentChatInvocationErrorEntryDto;
import type {Usage} from "@earendil-works/pi-ai";
import type {LowCodeFieldDto, LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

export type AgentUserInputFieldDto = Omit<LowCodeFieldDto, "component" | "resource"> & {
    component: Exclude<LowCodeFieldDto["component"], "resource-preset">;
};

/** Agent waiting 只允许轻量、可直接公开的 Low-Code 表单。 */
export type AgentUserInputFormDto = {
    defaults: LowCodeJsonObject;
    fields: AgentUserInputFieldDto[];
};
