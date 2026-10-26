/**
 * 把 Profile 渲染成交给模型的系统提示词与消息（docs/specs/agent/harness.md 输出 7、8）。
 *
 * 历史消息是会话日志里 OMP 消息的原样，按原样交回；Profile 里静态写的文字消息转成 OMP 的消息。静态消息的
 * timestamp 固定为 0：同一会话两次请求之间它们不变，前缀才稳定（输出 9）。
 */

import type {AgentMessage} from "@oh-my-pi/pi-agent-core";
import type {Model} from "@oh-my-pi/pi-catalog";
import {renderProfile, type ProfileDefinition} from "@notnotype/nb-profile";

export interface RenderedContext {
    readonly systemPrompt: string[];
    readonly messages: AgentMessage[];
}

export function renderContext(profile: ProfileDefinition, input: {readonly initial: unknown; readonly tools: ReadonlySet<string>; readonly history: readonly AgentMessage[]; readonly model: Model}): RenderedContext {
    const node = profile.context({initial: input.initial as never, tools: input.tools, history: input.history});
    const rendered = renderProfile<AgentMessage>(node, {history: input.history, tools: input.tools});
    const messages = rendered.messages.map((message): AgentMessage => {
        if (message.kind === "history") return message.message;
        if (message.role === "user") return {role: "user", content: message.text, timestamp: 0};
        return {
            role: "assistant",
            content: [{type: "text", text: message.text}],
            api: input.model.api,
            provider: input.model.provider,
            model: input.model.id,
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            stopReason: "stop",
            timestamp: 0,
        };
    });
    return {systemPrompt: [...rendered.systemPrompt], messages};
}
