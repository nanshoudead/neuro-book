/**
 * 用问答配置向模型发一个最小请求（`nbstory config test`，docs/specs/story/qa.md 的“配置”）：证明服务地址、模型名、
 * 密钥环境变量和推理档能被服务接受。不证明服务端真的按推理档思考。
 */

import {createHarness, createToolRegistry, type HarnessOptions, type RunError, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog} from "@notnotype/nb-session";

import {configuredModel, thinkingOption, type QaConfig} from "./config";
import probeProfile from "./probe.profile";

export type ProbeResult =
    | {ok: true; text: string; ms: number; usage: TurnResult["usage"]}
    | {ok: false; reason: "failed"; error: RunError; ms: number}
    | {ok: false; reason: "aborted"; ms: number}
    | {ok: false; reason: "not_finished"; stopReason: TurnResult["stopReason"]; ms: number};

export async function probeModel(config: QaConfig, options: {signal?: AbortSignal; streamFn?: HarnessOptions["streamFn"]} = {}): Promise<ProbeResult> {
    const started = Date.now();
    const harness = await createHarness({
        profile: probeProfile,
        initial: {},
        registry: createToolRegistry(),
        model: configuredModel(config),
        sessionLog: createMemorySessionLog({sessionId: "config-test"}),
        ...thinkingOption(config),
        ...(options.streamFn === undefined ? {} : {streamFn: options.streamFn}),
    });
    try {
        const result = await harness.turn("请回复。", options.signal === undefined ? undefined : {signal: options.signal});
        const ms = Date.now() - started;
        if (result.stopReason === "error") return {ok: false, reason: "failed", error: result.error!, ms};
        if (result.stopReason === "aborted") return {ok: false, reason: "aborted", ms};
        if (result.stopReason !== "stop") return {ok: false, reason: "not_finished", stopReason: result.stopReason, ms};
        return {ok: true, text: result.text.trim(), ms, usage: result.usage};
    } finally {
        await harness.close();
    }
}
