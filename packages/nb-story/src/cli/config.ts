/**
 * `nbstory config`（docs/specs/story/qa.md 输出 18 到 21）：写、看、改问答配置，并检查它能不能用。由 main.ts 动态导入，
 * 只有 `test` 和 `init` 的交互才加载模型库与交互库。
 *
 * 密钥不经过这里：配置里只有存密钥的环境变量名，`show` 与 `test` 只说那个环境变量设没设置。
 */

import {access} from "node:fs/promises";

import {currentConfigDigest, defaultConfigPath, ingestModel, loadQaConfig, parseQaConfig, qaLimits, readQaConfigFile, recallModel, saveQaConfig, type QaConfig} from "../qa/config";
import {ConfigEditError, echoable, envNameProblem, setConfigField, unsetConfigField} from "../qa/config-edit";
import {QaError} from "../qa/errors";
import {EXIT_INTERRUPTED, EXIT_QA_FAILED, runInterruptible} from "./ask";
import type {CliIo} from "./main";

interface ConfigOptions {
    params: Record<string, unknown>;
    json: boolean;
}

const USAGE = "用法：nbstory config init | show | set <字段> <值> | unset <字段> | test [--ingest]（都可加 --config <文件>、--json）";

const THINKING_NOTE = "不写：请求不带推理档，由服务端的默认档决定";

function thinkingText(config: QaConfig): string {
    return config.model.thinking ?? `未写（${THINKING_NOTE}）`;
}

function describe(path: string, config: QaConfig, env: NodeJS.ProcessEnv): string {
    const {model} = config;
    const limits = qaLimits(config);
    return [
        `配置文件：${path}`,
        `服务地址：${model.baseUrl}`,
        `模型：${model.id}`,
        `密钥环境变量：${model.apiKeyEnv}（${env[model.apiKeyEnv] ? "已设置" : "没有设置"}）`,
        `推理档：${thinkingText(config)}`,
        ...(model.contextWindow === undefined ? [] : [`上下文窗口：${model.contextWindow}`]),
        ...(model.maxTokens === undefined ? [] : [`输出上限：${model.maxTokens}`]),
        ...(model.price === undefined ? [] : [`价格（每百万 token）：输入 ${model.price.input}，输出 ${model.price.output}${model.price.cacheRead === undefined ? "" : `，缓存读取 ${model.price.cacheRead}`}，${model.price.currency}`]),
        `图当目录最多读 ${limits.maxChapters} 章；全读上限 ${limits.fullReadMaxChars} 字`,
        ingestLine(config, env),
        recallLine(config, env),
    ].join("\n");
}

function recallLine(config: QaConfig, env: NodeJS.ProcessEnv): string {
    const model = recallModel(config);
    if (model === null) return "挑相关说法：关（ingest.recall.enabled）";
    if (model.source !== "ingest.recall.model") return "挑相关说法：开，用抽取模型";
    return [
        `挑相关说法：开，模型 ${model.id}（${model.baseUrl}）`,
        `挑选的密钥环境变量：${model.apiKeyEnv}（${env[model.apiKeyEnv] ? "已设置" : "没有设置"}）`,
        ...(model.price === null ? [] : [`挑选的价格（每百万 token）：输入 ${model.price.input}，输出 ${model.price.output}${model.price.cacheRead === undefined ? "" : `，缓存读取 ${model.price.cacheRead}`}，${model.price.currency}`]),
    ].join("\n");
}

function ingestLine(config: QaConfig, env: NodeJS.ProcessEnv): string {
    const model = ingestModel(config);
    if (model.source === "model") return "抽取模型：没有单独配置（ingest.model），用上面的模型，推理档由抽取按步骤固定";
    return [
        `抽取模型：${model.id}（${model.baseUrl}）`,
        `抽取的密钥环境变量：${model.apiKeyEnv}（${env[model.apiKeyEnv] ? "已设置" : "没有设置"}）`,
        `抽取的输出上限：${model.maxTokens}`,
        ...(model.price === null ? [] : [`抽取的价格（每百万 token）：输入 ${model.price.input}，输出 ${model.price.output}${model.price.cacheRead === undefined ? "" : `，缓存读取 ${model.price.cacheRead}`}，${model.price.currency}`]),
    ].join("\n");
}

export async function configCommand(options: ConfigOptions, io: CliIo): Promise<number> {
    const {params, json} = options;
    const action = params.action as string | undefined;
    const path = typeof params.config === "string" ? params.config : defaultConfigPath();

    const usageError = (message: string): number => {
        io.stderr(`${message}\n${USAGE}`);
        return 2;
    };
    const done = (data: unknown, text: string): number => {
        io.stdout(json ? JSON.stringify({ok: true, data}) : text);
        return 0;
    };
    const fail = (code: string, message: string, exit: number, kind?: string): number => {
        if (json) io.stdout(JSON.stringify({ok: false, error: {code, message, ...(kind === undefined ? {} : {kind})}}));
        else io.stderr(`错误（${code}${kind ? `，${kind}` : ""}）：${message}${code === "qa_unconfigured" ? "\n下一步：用 nbstory config init 写配置，或 nbstory config show 看现在的配置" : ""}`);
        return exit;
    };

    const arity: Record<string, number> = {init: 0, show: 0, test: 0, set: 2, unset: 1};
    if (action === undefined || !(action in arity)) return usageError(action === undefined ? "缺少动作" : `没有动作 ${action}`);
    const given = [params.field, params.value].filter(item => item !== undefined).length;
    if (given !== arity[action]) return usageError(`${action} 要 ${arity[action]} 个参数，给了 ${given} 个`);
    if (params.ingest === true && action !== "test") return usageError("--ingest 只用于 config test");

    try {
        switch (action) {
            case "show": {
                const config = await loadQaConfig(path);
                const ingest = ingestModel(config);
                const recall = recallModel(config);
                return done(
                    {
                        path, config, apiKeySet: Boolean(process.env[config.model.apiKeyEnv]),
                        ingest: {source: ingest.source, id: ingest.id, apiKeySet: Boolean(process.env[ingest.apiKeyEnv])},
                        recall: recall === null ? null : {source: recall.source, id: recall.id, apiKeySet: Boolean(process.env[recall.apiKeyEnv])},
                    },
                    describe(path, config, process.env),
                );
            }
            case "set":
            case "unset": {
                // 读的时候记下摘要，写的时候核对：中间被网页设置页或另一个命令改过就报 config_conflict，不盖掉它。
                const {config, digest} = await readQaConfigFile(path);
                const field = params.field as string;
                const changed = action === "set" ? setConfigField(config, field, params.value as string, ` ${path} `) : unsetConfigField(config, field, ` ${path} `);
                await saveQaConfig(path, changed, {expect: digest});
                return done({path, config: changed}, action === "set" ? (echoable(field) ? `已改 ${field} = ${String(params.value)}` : `已改 ${field}`) : `已去掉 ${field}`);
            }
            case "init":
                return await init(params, path, io, json, done, usageError);
            case "test":
                return await runInterruptible(io, signal => (params.ingest === true ? testIngest(path, signal, io, json, done, fail) : test(path, signal, io, json, done, fail)));
        }
    } catch (error) {
        if (error instanceof ConfigEditError) return usageError(error.message);
        if (error instanceof QaError) return fail(error.code, error.message, 1);
        throw error;
    }
    return 0;
}

type Done = (data: unknown, text: string) => number;
type Fail = (code: string, message: string, exit: number, kind?: string) => number;

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false,
    );
}

/**
 * 写配置。三个必填项（服务地址、模型名、密钥环境变量名）在选项里给齐就直接写，缺的在终端里交互问；已有配置只在
 * `--force` 或终端里确认后才改，没给的字段保留原值。
 */
async function init(params: Record<string, unknown>, path: string, io: CliIo, json: boolean, done: Done, usageError: (message: string) => number): Promise<number> {
    const present = await exists(path);
    // 交互问完之前别人可能改了文件：写的时候按开始时的样子核对（读不成的坏文件也有摘要，确认覆盖后整份重写）。
    const expect = await currentConfigDigest(path);
    let existing: QaConfig | null = null;
    if (present) {
        // 文件在但读不成配置（坏了）：确认覆盖后当作没有，整份重写。
        existing = await loadQaConfig(path).catch((error: unknown) => {
            if (error instanceof QaError) return null;
            throw error;
        });
    }
    const flags = {"model.baseUrl": params.baseUrl, "model.id": params.model, "model.apiKeyEnv": params.apiKeyEnv, "model.thinking": params.thinking} as Record<string, string | undefined>;
    const missing = existing ? [] : (["model.baseUrl", "model.id", "model.apiKeyEnv"] as const).filter(name => flags[name] === undefined);
    // 要问字段：没有配置而缺必填项，或已有配置而一个字段选项都没给。要确认覆盖：已有文件而没加 --force。两件事都要
    // 问人，只有在终端里（且没加 --json）才能问，否则是用法错误，不挂起等输入。
    const needsInput = existing ? Object.values(flags).every(text => text === undefined) : missing.length > 0;
    // 贴了密钥本身的写法在任何校验之前就当用法错误报（不写盘、不回显原文）；整份校验也会拦，但那是另一种失败。
    const pastedKey = flags["model.apiKeyEnv"] === undefined ? undefined : envNameProblem(flags["model.apiKeyEnv"]);
    if (pastedKey !== undefined) return usageError(`model.apiKeyEnv：${pastedKey}`);
    const needsConfirm = present && params.force !== true;
    const canPrompt = !json && process.stdin.isTTY === true;

    if (needsConfirm && !canPrompt) return usageError(`已有配置 ${path}：加 --force 覆盖其中给出的字段（没给的保留），或用 nbstory config set 改单个字段`);
    if (needsInput && !canPrompt) {
        const names = {"model.baseUrl": "--base-url", "model.id": "--model", "model.apiKeyEnv": "--api-key-env"} as const;
        const wanted = existing ? "至少给一个字段选项（--base-url、--model、--api-key-env、--thinking）" : `缺少 ${missing.map(name => names[name]).join("、")}`;
        return usageError(`${wanted}${json ? "" : "；在终端里运行可以交互填写"}`);
    }
    const cancelled = (): number => {
        io.stderr("已取消，没有写配置");
        return EXIT_INTERRUPTED;
    };

    let config: QaConfig;
    if (needsInput) {
        const {initInteractively} = await import("./config-init");
        const answered = await initInteractively({path, confirmOverwrite: needsConfirm, existing, flags});
        if (answered === null) return cancelled();
        config = answered;
    } else {
        // 先按选项算出新配置：写法不对在确认覆盖之前就报。
        config = existing ?? parseQaConfig({model: {baseUrl: flags["model.baseUrl"], id: flags["model.id"], apiKeyEnv: flags["model.apiKeyEnv"]}}, ` ${path} `);
        for (const [name, text] of Object.entries(flags)) if (text !== undefined) config = setConfigField(config, name, text, ` ${path} `);
        if (needsConfirm) {
            const {confirmOverwrite} = await import("./config-init");
            if (!(await confirmOverwrite(path))) return cancelled();
        }
    }
    await saveQaConfig(path, config, {expect});
    const warning = process.env[config.model.apiKeyEnv] ? "" : `\n· 环境变量 ${config.model.apiKeyEnv} 现在没有设置，问答前要先设置它`;
    return done({path, config}, `已写 ${path}${warning}\n下一步：nbstory config test 检查能不能用`);
}

/** 向配置的模型发一个最小请求（见 qa/probe.ts）。失败的归类同 `ask`：退出码 4，取消 130。 */
async function test(path: string, signal: AbortSignal, io: CliIo, json: boolean, done: Done, fail: Fail): Promise<number> {
    const config = await loadQaConfig(path);
    const {probeModel} = await import("../qa/probe");
    let result: Awaited<ReturnType<typeof probeModel>>;
    try {
        result = await probeModel(config, {signal});
    } catch (error) {
        return fail("model_failed", `本机错误：${error instanceof Error ? error.message : String(error)}`, EXIT_QA_FAILED, "local");
    }
    if (result.ok) {
        const seconds = (result.ms / 1000).toFixed(1);
        const text = [
            `通过：${config.model.id} 正常回话（${seconds} 秒，输入 ${result.usage.input}、输出 ${result.usage.output} token）`,
            `推理档：${thinkingText(config)}。这里只说明配置里写了什么，一个小请求证明不了服务端是否按这个档思考`,
        ].join("\n");
        return done({path, model: config.model.id, thinking: config.model.thinking ?? null, ms: result.ms, usage: result.usage}, text);
    }
    io.stderr(`· ${config.model.baseUrl} ${config.model.id}`);
    if (result.reason === "aborted") return fail("cancelled", "已取消", EXIT_INTERRUPTED);
    if (result.reason === "not_finished") return fail("model_failed", `模型没有正常结束（${result.stopReason}）`, EXIT_QA_FAILED, "local");
    return fail("model_failed", result.error.message, EXIT_QA_FAILED, result.error.kind);
}

/**
 * 用抽取实际用的模型，按抽取固定的两档各发一个最小请求（docs/specs/story/qa.md 输出 23），走抽取同一条传输路径
 * （ingest/model.ts），所以通过就说明抽取发得出去。挑选相关说法开着时，再用挑选的模型发一个 `minimal` 的。每档只试
 * 一次，不按抽取的延迟表等着重发；不降档。
 */
async function testIngest(path: string, signal: AbortSignal, io: CliIo, json: boolean, done: Done, fail: Fail): Promise<number> {
    const config = await loadQaConfig(path);
    const model = ingestModel(config);
    const recall = recallModel(config);
    const {callModel, ModelAborted, ModelError} = await import("../ingest/model");
    const endpointOf = (choice: {baseUrl: string; id: string; apiKeyEnv: string; maxTokens: number}) => ({baseUrl: choice.baseUrl, model: choice.id, apiKey: process.env[choice.apiKeyEnv] ?? "", maxTokens: choice.maxTokens});
    type Trial = {effort: "minimal" | "medium"; for: "ingest" | "recall"};
    type Result = Trial & ({ok: true; ms: number; usage: {input: number; output: number}} | {ok: false; kind: string; message: string});
    const trials: Trial[] = [{effort: "minimal", for: "ingest"}, {effort: "medium", for: "ingest"}, ...(recall === null ? [] : [{effort: "minimal", for: "recall"} as const])];
    const results: Result[] = [];
    for (const {effort, for: target} of trials) {
        const endpoint = endpointOf(target === "recall" ? recall! : model);
        const started = Date.now();
        let usage = {input: 0, output: 0};
        try {
            await callModel(endpoint, {
                system: "只回一个 JSON 对象。",
                user: '回 {"ok":true}',
                effort, signal, maxAttempts: 1,
                onAttempt: attempt => (usage = {input: attempt.usage.input, output: attempt.usage.output}),
            });
            results.push({effort, for: target, ok: true, ms: Date.now() - started, usage});
        } catch (error) {
            if (error instanceof ModelAborted) return fail("cancelled", "已取消", EXIT_INTERRUPTED);
            if (!(error instanceof ModelError)) throw error;
            results.push({effort, for: target, ok: false, kind: error.kind, message: error.message});
        }
    }
    const label = (result: Result) => `${result.for === "recall" ? "挑选 " : ""}${result.effort} 档`;
    const lines = results.map(result => (result.ok ? `通过：${label(result)}正常回话（${(result.ms / 1000).toFixed(1)} 秒，输入 ${result.usage.input}、输出 ${result.usage.output} token）` : `失败：${label(result)}（${result.kind}）${result.message}`));
    const failed = results.find((result): result is Extract<Result, {ok: false}> => !result.ok);
    const head = [`抽取模型：${model.id}（${model.baseUrl}，取自 ${model.source}）`, ...(recall === null ? [] : [`挑选模型：${recall.id}（${recall.baseUrl}，取自 ${recall.source}）`])].join("\n");
    const data = {path, model: model.id, source: model.source, efforts: results.filter(result => result.for === "ingest"), recall: recall === null ? null : {model: recall.id, source: recall.source, efforts: results.filter(result => result.for === "recall")}};
    if (!failed) return done(data, [head, ...lines].join("\n"));
    const message = `${label(failed)}：${failed.message}${failed.kind === "provider" ? "（模型不接受这一档时换模型；抽取不降档）" : ""}`;
    // 失败时两档的结果都要给（qa 输出 23“分别报告”）：JSON 的失败对象另带 data。
    if (json) {
        io.stdout(JSON.stringify({ok: false, error: {code: "model_failed", message, kind: failed.kind}, data}));
        return EXIT_QA_FAILED;
    }
    io.stderr([head, ...lines].join("\n"));
    return fail("model_failed", message, EXIT_QA_FAILED, failed.kind);
}
