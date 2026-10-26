/**
 * 用问答配置向模型发一个最小请求（`nbstory config test`，docs/specs/story/qa.md 的“配置”）：证明服务地址、模型名、
 * 密钥环境变量和推理档能被服务接受。不证明服务端真的按推理档思考。
 *
 * 结果不带模型回的正文：要证明的只是连通，而正文是上游给的任意文字（可能回显请求里的密钥），不该进命令输出。
 */

import {createHarness, createToolRegistry, type HarnessOptions, type RunError, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog} from "@notnotype/nb-session";

import type {KeyEnv} from "../platform/startup-env";
import type {QaConfig} from "./config";
import {keyVariables, onlyKeysIn, resolveQaModel, thinkingOption} from "./harness-model";
import probeProfile from "./probe.profile";

export type ProbeResult =
    | {ok: true; ms: number; usage: TurnResult["usage"]}
    | {ok: false; reason: "failed"; error: RunError; ms: number}
    | {ok: false; reason: "aborted"; ms: number}
    | {ok: false; reason: "not_finished"; stopReason: TurnResult["stopReason"]; ms: number};

/** `keyEnv` 给了就只认这份环境里的密钥（与问答同口径，docs/adr/0032）。 */
export async function probeModel(config: QaConfig, options: {signal?: AbortSignal; streamFn?: HarnessOptions["streamFn"]; keyEnv?: KeyEnv} = {}): Promise<ProbeResult> {
    const started = Date.now();
    const chosen = resolveQaModel(config);
    const model = options.keyEnv === undefined ? chosen : {...chosen, resolved: onlyKeysIn(chosen.resolved, keyVariables(config, chosen.ref), options.keyEnv)};
    const harness = await createHarness({
        profile: probeProfile,
        initial: {},
        registry: createToolRegistry(),
        model: model.resolved,
        sessionLog: createMemorySessionLog({sessionId: "config-test"}),
        ...thinkingOption(model),
        ...(options.streamFn === undefined ? {} : {streamFn: options.streamFn}),
    });
    try {
        const result = await harness.turn("请回复。", options.signal === undefined ? undefined : {signal: options.signal});
        const ms = Date.now() - started;
        if (result.stopReason === "error") return {ok: false, reason: "failed", error: result.error!, ms};
        if (result.stopReason === "aborted") return {ok: false, reason: "aborted", ms};
        if (result.stopReason !== "stop") return {ok: false, reason: "not_finished", stopReason: result.stopReason, ms};
        return {ok: true, ms, usage: result.usage};
    } finally {
        await harness.close();
    }
}
