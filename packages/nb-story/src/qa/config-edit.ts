/**
 * `nbstory config set/unset` 的字段表与改法（docs/specs/story/qa.md 的“配置”）。只认配置 schema 里的字段；改完整份
 * 配置重新过 schema，所以字段之间的约束（例如 `maxChapters` 的范围）只在 schema 一处。
 */

import {parseQaConfig, type QaConfig} from "./config";

/** 字段名不认识、值的写法不对，或要去掉必填字段：用法错误，不是配置错误。 */
export class ConfigEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigEditError";
    }
}

type Kind = "text" | "envName" | "integer" | "thinking" | "json";

interface FieldSpec {
    kind: Kind;
    /** 必填字段只能改，不能去掉。 */
    required: boolean;
}

/** 点路径 → 字段。`model.price` 是一整组，写成 JSON：只改其中一项会让组不完整。 */
export const CONFIG_FIELDS: Readonly<Record<string, FieldSpec>> = {
    "model.baseUrl": {kind: "text", required: true},
    "model.id": {kind: "text", required: true},
    "model.apiKeyEnv": {kind: "envName", required: true},
    "model.contextWindow": {kind: "integer", required: false},
    "model.maxTokens": {kind: "integer", required: false},
    "model.thinking": {kind: "thinking", required: false},
    "model.price": {kind: "json", required: false},
    "qa.maxChapters": {kind: "integer", required: false},
    "qa.fullReadMaxChars": {kind: "integer", required: false},
};

const THINKING_LEVELS = ["low", "medium", "high", "xhigh"];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * 密钥环境变量名的写法不对时的说明，对时为 undefined。常见的错是把密钥本身贴进来，那样密钥就落进配置文件、又被
 * 输出回显，所以写法不对一律拒绝，说明里也不带原文。交互的 `init` 用同一条检查。
 */
export function envNameProblem(text: string): string | undefined {
    return ENV_NAME.test(text) ? undefined : "密钥环境变量名只能是字母、数字、下划线（例如 OPENAI_API_KEY），这里要填变量名，不是密钥本身";
}

function fieldOf(name: string): FieldSpec {
    // 只认表里自己的键：`toString` 之类从原型继承来的名字不是字段。
    const field = Object.hasOwn(CONFIG_FIELDS, name) ? CONFIG_FIELDS[name] : undefined;
    if (!field) throw new ConfigEditError(`没有配置字段 ${name}；可用的：${Object.keys(CONFIG_FIELDS).join("、")}`);
    return field;
}

function decode(name: string, field: FieldSpec, text: string): unknown {
    switch (field.kind) {
        case "text":
            return text;
        case "envName": {
            const problem = envNameProblem(text);
            if (problem !== undefined) throw new ConfigEditError(`${name}：${problem}`);
            return text;
        }
        case "integer":
            if (!/^-?\d+$/u.test(text)) throw new ConfigEditError(`${name} 要写整数：${text}`);
            return Number(text);
        case "thinking":
            if (!THINKING_LEVELS.includes(text)) throw new ConfigEditError(`${name} 只能是 ${THINKING_LEVELS.join("、")}：${text}`);
            return text;
        case "json":
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new ConfigEditError(`${name} 要写 JSON，例如 '{"input":1,"output":4,"currency":"USD"}'：${text}`);
            }
    }
}

/** 点路径对应的父对象和键；父对象不存在时（例如还没有 `qa`）建出来。改的是副本。 */
function locate(config: Record<string, unknown>, name: string): {parent: Record<string, unknown>; key: string} {
    const [section, key] = name.split(".") as [string, string];
    const existing = config[section];
    const parent = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {};
    config[section] = parent;
    return {parent, key};
}

/** 改一个字段，返回通过 schema 校验的新配置；`config` 本身不变。校验不过抛 `QaError`（`qa_unconfigured`）。 */
export function setConfigField(config: QaConfig, name: string, text: string, source: string): QaConfig {
    const value = decode(name, fieldOf(name), text);
    const copy = structuredClone(config) as unknown as Record<string, unknown>;
    const {parent, key} = locate(copy, name);
    parent[key] = value;
    return parseQaConfig(copy, source);
}

/** 去掉一个可选字段；`qa` 里没有字段了就整段去掉。 */
export function unsetConfigField(config: QaConfig, name: string, source: string): QaConfig {
    if (fieldOf(name).required) throw new ConfigEditError(`${name} 是必填字段，只能用 config set 改，不能去掉`);
    const copy = structuredClone(config) as unknown as Record<string, unknown>;
    const {parent, key} = locate(copy, name);
    delete parent[key];
    if (name.startsWith("qa.") && Object.keys(parent).length === 0) delete copy.qa;
    return parseQaConfig(copy, source);
}
