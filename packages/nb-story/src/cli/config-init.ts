/**
 * `nbstory config init` 的交互部分（docs/specs/story/qa.md 输出 19）。只在终端里、选项没给齐时才加载这个文件，所以
 * `@clack/prompts` 不拖慢别的命令。
 *
 * 选项里已经给出的字段不再问。密钥环境变量名的写法检查与 `config set` 共用（`envNameProblem`）。
 */

import type {Readable, Writable} from "node:stream";

import {cancel, confirm, intro, isCancel, outro, select, text} from "@clack/prompts";

import {EFFORTS} from "../contract/config-schema";
import {LEGACY_PROVIDER_ID, parseModelRef, type ConfigCatalog, type Effort, type QaConfig} from "../qa/config";
import {applyInitAnswers, envNameProblem, type InitAnswers} from "../qa/config-edit";

export interface InitRequest {
    path: string;
    /** 配置文件已经在（不论读不读得成）而没加 `--force`：先确认覆盖。 */
    confirmOverwrite: boolean;
    /** 读得成的已有配置，作为各项的默认值，没问到的字段保留。 */
    existing: QaConfig | null;
    /** 选项里给的字段，不再问。 */
    flags: Partial<Record<"baseUrl" | "model" | "apiKeyEnv" | "thinking", string>>;
    /** 校验目录模型的引用。 */
    catalog: ConfigCatalog;
    /** 测试用：替换终端的输入输出。 */
    streams?: {input: Readable; output: Writable};
}

const NO_THINKING = "none";

type Streams = {input?: Readable; output?: Writable};

/** 默认不覆盖：直接回车、取消都算不覆盖。 */
async function askOverwrite(path: string, prompt: Streams): Promise<boolean> {
    const overwrite = await confirm({message: `已有配置 ${path}，覆盖其中的字段？`, initialValue: false, ...prompt});
    return !isCancel(overwrite) && overwrite;
}

/** 字段都在选项里给了，只确认覆盖已有配置。不覆盖返回 false，调用方不写盘。 */
export async function confirmOverwrite(path: string, streams?: Streams): Promise<boolean> {
    const prompt = streams ?? {};
    intro("写问答配置", prompt);
    if (!(await askOverwrite(path, prompt))) {
        cancelled(prompt);
        return false;
    }
    outro("确认覆盖", prompt);
    return true;
}

/** 问完返回新配置；任何一步取消或不确认覆盖，返回 null，调用方不写盘。 */
export async function initInteractively(request: InitRequest): Promise<QaConfig | null> {
    const prompt = request.streams ?? {};
    const {existing, flags} = request;

    intro("写问答配置", prompt);
    if (request.confirmOverwrite && !(await askOverwrite(request.path, prompt))) return cancelled(prompt);

    const ask = async (name: keyof InitRequest["flags"], message: string, current: string | undefined, validate: (value: string) => string | undefined): Promise<string | null> => {
        if (flags[name] !== undefined) return flags[name]!;
        const answer = await text({message, ...(current === undefined ? {} : {initialValue: current}), validate: value => validate(value ?? ""), ...prompt});
        return isCancel(answer) ? null : answer.trim();
    };
    const nonEmpty = (label: string) => (value: string) => (value.trim() === "" ? `${label}不能为空` : undefined);

    // 先问用目录里的模型还是自定义地址；选项里给了地址或密钥变量就是自定义地址，不再问。
    const current = existing === null ? null : parseModelRef(existing.model.use);
    const currentCustom = current !== null && existing?.providers?.[current.provider] !== undefined;
    let kind: "catalog" | "custom";
    if (flags.baseUrl !== undefined || flags.apiKeyEnv !== undefined) kind = "custom";
    else {
        const picked = await select<"catalog" | "custom">({
            message: "用哪里的模型",
            initialValue: currentCustom || existing === null ? "custom" : "catalog",
            options: [
                {value: "catalog", label: "OMP 目录里的模型", hint: "写成 服务商/模型名，例如 deepseek/deepseek-flash；密钥用那家的环境变量"},
                {value: "custom", label: "自定义地址", hint: "OpenAI 兼容的服务地址、模型名与存密钥的环境变量"},
            ],
            ...prompt,
        });
        if (isCancel(picked)) return cancelled(prompt);
        kind = picked;
    }

    let answers: InitAnswers;
    if (kind === "catalog") {
        const valid = (value: string) => {
            const {provider, model} = parseModelRef(value.trim());
            if (provider === "" || model === "") return "写成 服务商/模型名，例如 deepseek/deepseek-flash";
            if (!request.catalog.hasProvider(provider)) return `OMP 目录里没有服务商 ${provider}`;
            return request.catalog.hasModel(provider, model) ? undefined : `OMP 目录的 ${provider} 里没有模型 ${model}`;
        };
        const ref = await ask("model", "模型（服务商/模型名）", currentCustom ? undefined : existing?.model.use, valid);
        if (ref === null) return cancelled(prompt);
        answers = {kind: "catalog", ref};
    } else {
        const legacy = existing?.providers?.[LEGACY_PROVIDER_ID];
        const baseUrl = await ask("baseUrl", "OpenAI 兼容服务的地址（例如 https://api.example.com/v1）", legacy?.baseUrl, nonEmpty("服务地址"));
        if (baseUrl === null) return cancelled(prompt);
        const id = await ask("model", "模型名", current?.provider === LEGACY_PROVIDER_ID ? current.model : undefined, nonEmpty("模型名"));
        if (id === null) return cancelled(prompt);
        const apiKeyEnv = await ask("apiKeyEnv", "存密钥的环境变量名（填变量名，不要贴密钥本身）", legacy?.apiKeyEnv, value => envNameProblem(value.trim()));
        if (apiKeyEnv === null) return cancelled(prompt);
        answers = {kind: "custom", baseUrl, id, apiKeyEnv};
    }

    let thinking: Effort | null | undefined = flags.thinking as Effort | undefined;
    if (thinking === undefined) {
        const level = await select<string>({
            message: "推理档（模型不支持这一档时往下夹，不支持推理就不发）",
            initialValue: existing?.model.thinking ?? NO_THINKING,
            options: [{value: NO_THINKING, label: "不写", hint: "请求不带推理档，由服务端的默认档决定"}, ...EFFORTS.map(effort => ({value: effort, label: effort}))],
            ...prompt,
        });
        if (isCancel(level)) return cancelled(prompt);
        thinking = level === NO_THINKING ? null : (level as Effort);
    }

    const config = applyInitAnswers(existing, answers, thinking, ` ${request.path} `, request.catalog);
    outro("配置已确认，写盘后用 nbstory config test 检查", prompt);
    return config;
}

function cancelled(prompt: Streams): null {
    cancel("已取消", prompt);
    return null;
}
