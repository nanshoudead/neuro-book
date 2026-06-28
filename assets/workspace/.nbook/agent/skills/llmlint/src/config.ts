import {existsSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {dirname, isAbsolute, join, resolve} from "node:path";
import type {LlmlintConfig, NormalizedLlmlintConfig, RuleOverride} from "./types.ts";

const DEFAULT_CONFIG: NormalizedLlmlintConfig = {
    presets: ["anti-ai-slop"],
    rules: {},
    files: [],
    ignores: [],
    output: "stylish",
};

const VALID_RULE_OVERRIDES = new Set<RuleOverride>(["off", "warn", "error", "high", "medium", "low"]);

export type LoadedConfig = {
    config: NormalizedLlmlintConfig;
    configPath: string | null;
};

/**
 * 加载 llmlint 配置。显式 --config 缺失时报错；未显式配置时使用默认配置。
 */
export async function loadConfig(options: {cwd: string; configPath?: string}): Promise<LoadedConfig> {
    const explicitPath = options.configPath?.trim();
    const configPath = explicitPath
        ? resolve(options.cwd, explicitPath)
        : findConfigPath(options.cwd);

    if (!configPath) {
        return {config: DEFAULT_CONFIG, configPath: null};
    }

    if (!existsSync(configPath)) {
        throw new Error(`配置文件不存在: ${configPath}`);
    }

    const imported = await import(pathToFileURL(configPath).href);
    const rawConfig = imported.default ?? imported.config;
    if (!isConfigObject(rawConfig)) {
        throw new Error(`配置文件必须 default export 一个对象: ${configPath}`);
    }

    return {
        config: normalizeConfig(rawConfig),
        configPath,
    };
}

function findConfigPath(cwd: string): string | null {
    let current = resolve(cwd);
    while (true) {
        const candidate = join(current, "llmlint.config.ts");
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = dirname(current);
        if (parent === current || !isAbsolute(parent)) {
            return null;
        }
        current = parent;
    }
}

function normalizeConfig(config: LlmlintConfig): NormalizedLlmlintConfig {
    const rules = normalizeRules(config.rules);
    return {
        presets: normalizeStringArray(config.presets, DEFAULT_CONFIG.presets, "presets"),
        rules,
        files: normalizeStringArray(config.files, DEFAULT_CONFIG.files, "files"),
        ignores: normalizeStringArray(config.ignores, DEFAULT_CONFIG.ignores, "ignores"),
        output: config.output ?? DEFAULT_CONFIG.output,
    };
}

function normalizeRules(rules: LlmlintConfig["rules"]): Record<string, RuleOverride> {
    if (rules === undefined) {
        return {};
    }
    if (!isConfigObject(rules)) {
        throw new Error("配置 rules 必须是对象。");
    }

    const normalized: Record<string, RuleOverride> = {};
    for (const [ruleId, override] of Object.entries(rules)) {
        if (!VALID_RULE_OVERRIDES.has(override as RuleOverride)) {
            throw new Error(`规则 ${ruleId} 的覆盖值无效: ${String(override)}`);
        }
        normalized[ruleId] = override as RuleOverride;
    }
    return normalized;
}

function normalizeStringArray(value: string[] | undefined, fallback: string[], fieldName: string): string[] {
    if (value === undefined) {
        return [...fallback];
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`配置 ${fieldName} 必须是字符串数组。`);
    }
    return [...value];
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
