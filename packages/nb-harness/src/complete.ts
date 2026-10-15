/**
 * 单次请求：不带工具的 Profile，渲染后请求一次模型，不经会话（docs/specs/agent/harness.md 输出 17）。
 */

import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import {streamSimple, type Message} from "@oh-my-pi/pi-ai";
import {ProfileError, type ProfileDefinition} from "@notnotype/nb-profile";
import {renderContext} from "./context.js";
import {HarnessError} from "./errors.js";
import {MissingModelKeyError, type ResolvedModel} from "./model.js";
import {classifyProviderError, UsageMeter, type CompleteResult, type RunError} from "./run-result.js";

export interface CompleteOptions {
    readonly profile: ProfileDefinition;
    readonly initial: unknown;
    readonly input: string;
    readonly model: ResolvedModel;
    readonly signal?: AbortSignal;
    /** 替换模型输出（测试用）。 */
    readonly streamFn?: StreamFn;
}

export async function complete(options: CompleteOptions): Promise<CompleteResult> {
    const {profile, model} = options;
    if (profile.tools.length > 0) throw new HarnessError("profile_has_tools", `单次请求只接受不带工具的 Profile，${profile.manifest.key} 声明了 ${profile.tools.length} 个`);
    let initial: unknown;
    try {
        initial = profile.parseInitial(options.initial);
    } catch (error) {
        if (error instanceof ProfileError) throw new HarnessError(error.code, error.message, {details: error.details});
        throw error;
    }

    const meter = new UsageMeter(model.priceKnown);
    const fail = (error: RunError): CompleteResult => ({stopReason: "error", text: "", error, usage: meter.snapshot()});
    let apiKey: string;
    try {
        apiKey = model.apiKey();
    } catch (error) {
        if (error instanceof MissingModelKeyError) return fail({kind: "auth", status: null, message: error.message});
        throw error;
    }
    let rendered;
    try {
        rendered = renderContext(profile, {initial, tools: new Set(), history: [], model: model.model});
    } catch (error) {
        return fail({kind: "local", status: null, message: `渲染 Profile 失败：${String(error)}`});
    }

    // 无工具的 Profile 渲染不出工具消息，历史又为空：渲染结果只有用户与助手的文字消息，正是模型接受的形状。
    const messages = rendered.messages.filter((message): message is Message => message.role === "user" || message.role === "assistant");
    const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        meter.request();
        return fetch(input, init);
    }) as typeof fetch;
    const stream = await (options.streamFn ?? (streamSimple as StreamFn))(
        model.model,
        {systemPrompt: rendered.systemPrompt, messages: [...messages, {role: "user", content: options.input, timestamp: Date.now()}], tools: []},
        {apiKey, signal: options.signal, fetch: counted},
    );
    const message = await stream.result();
    meter.add(message);
    if (options.signal?.aborted) meter.markIncomplete();
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    switch (message.stopReason) {
        case "error":
            return {stopReason: "error", text, error: classifyProviderError(message), usage: meter.snapshot()};
        case "aborted":
            meter.markIncomplete();
            return {stopReason: "aborted", text, error: null, usage: meter.snapshot()};
        case "length":
            return {stopReason: "length", text, error: null, usage: meter.snapshot()};
        default:
            return {stopReason: "stop", text, error: null, usage: meter.snapshot()};
    }
}
