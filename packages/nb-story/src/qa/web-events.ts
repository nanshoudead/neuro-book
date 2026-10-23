/**
 * 推给网页问答页的运行事件：harness 的事件里只留对话视图（nb-agent-ui 的 `createHarnessTranscript`）用得到的部分。
 * 网页以会话日志为准、事件只作运行中的临时显示，所以这里能丢就丢：
 * - `message_update` 的 `assistantMessageEvent` 每条都带一份到当前为止的完整半截消息，不转；
 * - 用户消息与工具结果的消息事件、`turn_*`、`message_end`、工具的中途进度，视图都不用；
 * - `agent_end` 带的整串消息不转。
 * 消息里的错误正文在 harness 交出事件之前已遮盖密钥（nb-harness 的 `redactEventMessages`）。
 */

export type QaAgentEvent =
    | {readonly type: "agent_start"}
    | {readonly type: "agent_end"}
    | {readonly type: "message_start" | "message_update"; readonly message: unknown}
    | {readonly type: "tool_execution_start"; readonly toolCallId: string; readonly toolName: string}
    | {readonly type: "tool_execution_end"; readonly toolCallId: string; readonly toolName: string; readonly isError: boolean; readonly result: {readonly content: unknown; readonly details?: unknown}};

type Loose = {readonly type: string} & Readonly<Record<string, unknown>>;

/** 网页要的那部分；视图不用的事件为 null。 */
export function webEventOf(event: {readonly type: string}): QaAgentEvent | null {
    const loose = event as Loose;
    switch (loose.type) {
        case "agent_start":
        case "agent_end":
            return {type: loose.type};
        case "message_start":
        case "message_update": {
            const message = loose.message as {role?: unknown} | undefined;
            return message?.role === "assistant" ? {type: loose.type, message} : null;
        }
        case "tool_execution_start":
            return {type: "tool_execution_start", toolCallId: String(loose.toolCallId), toolName: String(loose.toolName)};
        case "tool_execution_end": {
            const result = (loose.result ?? {}) as {content?: unknown; details?: unknown};
            return {type: "tool_execution_end", toolCallId: String(loose.toolCallId), toolName: String(loose.toolName), isError: loose.isError === true, result: {content: result.content, ...(result.details === undefined ? {} : {details: result.details})}};
        }
        default:
            return null;
    }
}
