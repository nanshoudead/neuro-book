import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {LLMRule, NormalizedLlmlintConfig, RuleLevel, RuleOverride, StaticRule} from "./types.ts";

export type LoadedRules = {
    staticRules: StaticRule[];
    llmRules: LLMRule[];
};

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 按配置加载 preset 规则，并应用规则级别覆盖。
 */
export async function loadRules(config: NormalizedLlmlintConfig): Promise<LoadedRules> {
    const staticRules = new Map<string, StaticRule>();
    const llmRules = new Map<string, LLMRule>();

    for (const preset of config.presets) {
        const presetRoot = resolve(SKILL_ROOT, "presets", preset);
        const presetStaticRules = await readJson<StaticRule[]>(resolve(presetRoot, "static-rules.json"));
        const presetLLMRules = await readJson<LLMRule[]>(resolve(presetRoot, "llm-rules.json"));

        for (const rule of presetStaticRules) {
            staticRules.set(rule.id, rule);
        }
        for (const rule of presetLLMRules) {
            llmRules.set(rule.id, rule);
        }
    }

    return {
        staticRules: applyStaticOverrides([...staticRules.values()], config.rules),
        llmRules: applyLLMOverrides([...llmRules.values()], config.rules),
    };
}

async function readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

function applyStaticOverrides(rules: StaticRule[], overrides: Record<string, RuleOverride>): StaticRule[] {
    return rules.flatMap((rule) => {
        const level = resolveOverride(rule.level, overrides[rule.id]);
        return level ? [{...rule, level}] : [];
    });
}

function applyLLMOverrides(rules: LLMRule[], overrides: Record<string, RuleOverride>): LLMRule[] {
    return rules.flatMap((rule) => {
        const level = resolveOverride(rule.level, overrides[rule.id]);
        return level ? [{...rule, level}] : [];
    });
}

function resolveOverride(defaultLevel: RuleLevel, override: RuleOverride | undefined): RuleLevel | null {
    if (!override) {
        return defaultLevel;
    }
    if (override === "off") {
        return null;
    }
    if (override === "warn") {
        return "medium";
    }
    if (override === "error") {
        return "high";
    }
    return override;
}
