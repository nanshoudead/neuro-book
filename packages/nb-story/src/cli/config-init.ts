/**
 * `nbstory config init` 的交互部分（docs/specs/story/qa.md 输出 19）。只在终端里、选项没给齐时才加载这个文件，所以
 * `@clack/prompts` 不拖慢别的命令。
 *
 * 选项里已经给出的字段不再问。密钥环境变量名这一项只收环境变量名的写法：常见的错是把密钥本身贴进来，那样密钥就
 * 落进配置文件了，所以写法不对时拒绝并说明。
 */

import type {Readable, Writable} from "node:stream";

import {cancel, confirm, intro, isCancel, outro, select, text} from "@clack/prompts";

import {parseQaConfig, type QaConfig} from "../qa/config";
import {setConfigField} from "../qa/config-edit";

export interface InitRequest {
    path: string;
    /** 配置文件已经在（不论读不读得成）：先确认覆盖。 */
    filePresent: boolean;
    /** 读得成的已有配置，作为各项的默认值，没问到的字段保留。 */
    existing: QaConfig | null;
    /** 选项里给的字段（点路径 → 文字），不再问。 */
    flags: Record<string, string | undefined>;
    /** 测试用：替换终端的输入输出。 */
    streams?: {input: Readable; output: Writable};
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const NO_THINKING = "none";

/** 问完返回新配置；任何一步取消或不确认覆盖，返回 null，调用方不写盘。 */
export async function initInteractively(request: InitRequest): Promise<QaConfig | null> {
    const prompt = request.streams ?? {};
    const {existing, flags} = request;

    intro("写问答配置", prompt);
    if (request.filePresent) {
        const overwrite = await confirm({message: `已有配置 ${request.path}，覆盖其中的字段？`, initialValue: false, ...prompt});
        if (isCancel(overwrite) || !overwrite) return cancelled(prompt);
    }

    const ask = async (name: string, message: string, current: string | undefined, validate: (value: string) => string | undefined): Promise<string | null> => {
        if (flags[name] !== undefined) return flags[name]!;
        const answer = await text({message, ...(current === undefined ? {} : {initialValue: current}), validate: value => validate(value ?? ""), ...prompt});
        return isCancel(answer) ? null : answer.trim();
    };
    const nonEmpty = (label: string) => (value: string) => (value.trim() === "" ? `${label}不能为空` : undefined);

    const baseUrl = await ask("model.baseUrl", "OpenAI 兼容服务的地址（例如 https://api.example.com/v1）", existing?.model.baseUrl, nonEmpty("服务地址"));
    if (baseUrl === null) return cancelled(prompt);
    const id = await ask("model.id", "模型名", existing?.model.id, nonEmpty("模型名"));
    if (id === null) return cancelled(prompt);
    const apiKeyEnv = await ask("model.apiKeyEnv", "存密钥的环境变量名（填变量名，不要贴密钥本身）", existing?.model.apiKeyEnv, value =>
        ENV_NAME.test(value.trim()) ? undefined : "这里要填环境变量名（字母、数字、下划线，例如 OPENAI_API_KEY），不是密钥本身",
    );
    if (apiKeyEnv === null) return cancelled(prompt);

    let thinking = flags["model.thinking"];
    if (thinking === undefined) {
        const level = await select<string>({
            message: "推理档",
            initialValue: existing?.model.thinking ?? NO_THINKING,
            options: [
                {value: NO_THINKING, label: "不写", hint: "请求不带推理档，由服务端的默认档决定"},
                {value: "low", label: "low"},
                {value: "medium", label: "medium"},
                {value: "high", label: "high"},
                {value: "xhigh", label: "xhigh", hint: "t05 回归用的档"},
            ],
            ...prompt,
        });
        if (isCancel(level)) return cancelled(prompt);
        thinking = level === NO_THINKING ? undefined : level;
    }

    let config = existing ?? parseQaConfig({model: {baseUrl, id, apiKeyEnv}}, ` ${request.path} `);
    config = setConfigField(setConfigField(setConfigField(config, "model.baseUrl", baseUrl, ""), "model.id", id, ""), "model.apiKeyEnv", apiKeyEnv, "");
    if (thinking !== undefined) config = setConfigField(config, "model.thinking", thinking, "");
    else if (config.model.thinking !== undefined && flags["model.thinking"] === undefined) {
        // 选了“不写”：去掉已有配置里的推理档。
        const {thinking: _removed, ...rest} = config.model;
        config = parseQaConfig({...config, model: rest}, ` ${request.path} `);
    }
    outro("配置已确认，写盘后用 nbstory config test 检查", prompt);
    return config;
}

function cancelled(prompt: {output?: Writable}): null {
    cancel("已取消", prompt);
    return null;
}
