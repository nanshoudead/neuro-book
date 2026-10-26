/**
 * 单次请求：不带工具的 Profile，渲染后请求一次模型，不经会话（docs/specs/agent/harness.md 输出 17）。
 */

import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import {streamSimple, type AssistantMessage} from "@oh-my-pi/pi-ai";
import {isProfileDefinition, ProfileError, type ProfileDefinition} from "@notnotype/nb-profile";
import {renderContext} from "./context.js";
import {HarnessError} from "./errors.js";
import {MissingModelKeyError, type ResolvedModel} from "./model.js";
import {redactErrorMessage, redactText} from "./redact.js";
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
    if (!isProfileDefinition(profile)) throw new HarnessError("profile_invalid", "profile 不是 defineProfile 的结果");
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

    // 单次请求只取 Profile 的系统提示词，input 是唯一一条用户消息；Profile 里静态写的消息是会话用的，不混进来（输出 17）。
    const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        meter.request();
        return fetch(input, init);
    }) as typeof fetch;
    let message: AssistantMessage;
    try {
        const stream = await (options.streamFn ?? (streamSimple as StreamFn))(
            model.model,
            {systemPrompt: rendered.systemPrompt, messages: [{role: "user", content: options.input, timestamp: Date.now()}], tools: []},
            {apiKey, signal: options.signal, fetch: counted},
        );
        message = await stream.result();
    } catch (error) {
        // provider 在建流时抛错或流 reject：没有结构化的错误信息，归为 provider（取消归 aborted），不按文字猜。
        meter.markIncomplete();
        if (options.signal?.aborted) return {stopReason: "aborted", text: "", error: null, usage: meter.snapshot()};
        return fail({kind: "provider", status: null, message: redactText(String(error), [apiKey])});
    }
    redactErrorMessage(message, [apiKey]);
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
