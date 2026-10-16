/**
 * `nbstory config`（docs/specs/story/qa.md 输出 18 到 21）：写、看、改问答配置，并检查它能不能用。由 main.ts 动态导入，
 * 只有 `test` 和 `init` 的交互才加载模型库与交互库。
 *
 * 密钥不经过这里：配置里只有存密钥的环境变量名，`show` 与 `test` 只说那个环境变量设没设置。
 */

import {access} from "node:fs/promises";

import {defaultConfigPath, loadQaConfig, parseQaConfig, qaLimits, saveQaConfig, type QaConfig} from "../qa/config";
import {ConfigEditError, setConfigField, unsetConfigField} from "../qa/config-edit";
import {QaError} from "../qa/errors";
import {EXIT_INTERRUPTED, EXIT_QA_FAILED, runInterruptible} from "./ask";
import type {CliIo} from "./main";

interface ConfigOptions {
    params: Record<string, unknown>;
    json: boolean;
}

const USAGE = "用法：nbstory config init | show | set <字段> <值> | unset <字段> | test（都可加 --config <文件>、--json）";

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

    try {
        switch (action) {
            case "show": {
                const config = await loadQaConfig(path);
                return done({path, config, apiKeySet: Boolean(process.env[config.model.apiKeyEnv])}, describe(path, config, process.env));
            }
            case "set":
            case "unset": {
                const config = await loadQaConfig(path);
                const field = params.field as string;
                const changed = action === "set" ? setConfigField(config, field, params.value as string, ` ${path} `) : unsetConfigField(config, field, ` ${path} `);
                await saveQaConfig(path, changed);
                return done({path, config: changed}, action === "set" ? `已改 ${field} = ${String(params.value)}` : `已去掉 ${field}`);
            }
            case "init":
                return await init(params, path, io, json, done, usageError);
            case "test":
                return await runInterruptible(io, signal => test(path, signal, io, json, done, fail));
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
 * `--force` 或交互里确认后才改，没给的字段保留原值。不在终端里又缺必填项，是用法错误，不挂起等输入。
 */
async function init(params: Record<string, unknown>, path: string, io: CliIo, json: boolean, done: Done, usageError: (message: string) => number): Promise<number> {
    const present = await exists(path);
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
    // 需要问人：没有配置而缺必填项，或已有配置而一个字段选项都没给。
    const needsInput = existing ? Object.values(flags).every(text => text === undefined) : missing.length > 0;
    const interactive = needsInput && !json && process.stdin.isTTY === true;

    if (present && params.force !== true && !interactive) return usageError(`已有配置 ${path}：加 --force 覆盖其中给出的字段（没给的保留），或用 nbstory config set 改单个字段`);
    if (needsInput && !interactive) {
        const names = {"model.baseUrl": "--base-url", "model.id": "--model", "model.apiKeyEnv": "--api-key-env"} as const;
        const wanted = existing ? "至少给一个字段选项（--base-url、--model、--api-key-env、--thinking）" : `缺少 ${missing.map(name => names[name]).join("、")}`;
        return usageError(`${wanted}${json ? "" : "；在终端里运行可以交互填写"}`);
    }

    let config: QaConfig;
    if (interactive) {
        const {initInteractively} = await import("./config-init");
        const answered = await initInteractively({path, filePresent: present, existing, flags});
        if (answered === null) {
            io.stderr("已取消，没有写配置");
            return EXIT_INTERRUPTED;
        }
        config = answered;
    } else {
        config = existing ?? parseQaConfig({model: {baseUrl: flags["model.baseUrl"], id: flags["model.id"], apiKeyEnv: flags["model.apiKeyEnv"]}}, ` ${path} `);
        for (const [name, text] of Object.entries(flags)) if (text !== undefined) config = setConfigField(config, name, text, ` ${path} `);
    }
    await saveQaConfig(path, config);
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
            `通过：${config.model.id} 回复“${result.text}”（${seconds} 秒，输入 ${result.usage.input}、输出 ${result.usage.output} token）`,
            `推理档：${thinkingText(config)}。这里只说明配置里写了什么，一个小请求证明不了服务端是否按这个档思考`,
        ].join("\n");
        return done({path, model: config.model.id, thinking: config.model.thinking ?? null, text: result.text, ms: result.ms, usage: result.usage}, text);
    }
    io.stderr(`· ${config.model.baseUrl} ${config.model.id}`);
    if (result.reason === "aborted") return fail("cancelled", "已取消", EXIT_INTERRUPTED);
    if (result.reason === "not_finished") return fail("model_failed", `模型没有正常结束（${result.stopReason}）`, EXIT_QA_FAILED, "local");
    return fail("model_failed", result.error.message, EXIT_QA_FAILED, result.error.kind);
}
