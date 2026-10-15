/**
 * 按步骤给出模型输出的替身（docs/specs/agent/harness.md 验收）：只替换模型的输出，Agent 调度、工具参数校验、
 * 会话日志都走真的。provider 层的行为（重试、密钥、请求地址）不在这里，用 OMP 的 fetch 接缝测。
 */

import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import type {AssistantMessage, Context, StopReason, ToolCall} from "@oh-my-pi/pi-ai";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai/utils/event-stream";

export interface ScriptedStep {
    /** 文字、thinking 或工具调用；字符串当作一段文字。 */
    readonly content: string | AssistantMessage["content"];
    readonly stopReason?: StopReason;
    readonly usage?: Partial<Pick<AssistantMessage["usage"], "input" | "output" | "cacheRead" | "cacheWrite">> & {readonly cost?: number};
    readonly error?: {readonly message: string; readonly status?: number; readonly errorId?: number};
    /** 发出这一步之前等它完成：用来在“模型请求进行中”做取消、重叠、关闭。 */
    readonly gate?: Promise<unknown>;
}

export interface ScriptedModel {
    readonly streamFn: StreamFn;
    /** 每次请求收到的上下文（系统提示词、消息、工具名），按请求先后。 */
    readonly requests: readonly Context[];
}

export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
    return {type: "toolCall", id, name, arguments: args};
}

/** 一步可以简写成一段文字或一组内容块。 */
export type ScriptedInput = ScriptedStep | string | AssistantMessage["content"];

/** 按顺序逐次给出 `steps`；步骤用完后再被请求就报错（测试写少了步骤）。 */
export function scriptedModel(inputs: readonly ScriptedInput[]): ScriptedModel {
    const steps: ScriptedStep[] = inputs.map((input) => (typeof input === "string" || Array.isArray(input) ? {content: input} : (input as ScriptedStep)));
    const requests: Context[] = [];
    let index = 0;
    const streamFn: StreamFn = async (model, context, options) => {
        requests.push(JSON.parse(JSON.stringify(context)) as Context);
        const step = steps[index];
        index += 1;
        if (step === undefined) throw new Error(`脚本只有 ${steps.length} 步，收到第 ${index} 次请求`);
        if (step.gate !== undefined) await step.gate;
        const content: AssistantMessage["content"] = typeof step.content === "string" ? [{type: "text", text: step.content}] : step.content;
        const hasCalls = content.some((block) => block.type === "toolCall");
        const aborted = options?.signal?.aborted === true;
        const stopReason: StopReason = aborted ? "aborted" : (step.stopReason ?? (step.error !== undefined ? "error" : hasCalls ? "toolUse" : "stop"));
        const usage = step.usage ?? {};
        const message: AssistantMessage = {
            role: "assistant",
            content,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: usage.input ?? 0,
                output: usage.output ?? 0,
                cacheRead: usage.cacheRead ?? 0,
                cacheWrite: usage.cacheWrite ?? 0,
                totalTokens: (usage.input ?? 0) + (usage.output ?? 0),
                cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.cost ?? 0},
            },
            stopReason,
            timestamp: Date.now(),
            ...(step.error === undefined ? {} : {errorMessage: step.error.message, errorStatus: step.error.status, errorId: step.error.errorId}),
        };
        const stream = createAssistantMessageEventStream();
        stream.push({type: "start", partial: message});
        if (stopReason === "error" || stopReason === "aborted") stream.push({type: "error", reason: stopReason, error: message});
        else stream.push({type: "done", reason: stopReason, message});
        stream.end(message);
        return stream;
    };
    return {streamFn, requests};
}
