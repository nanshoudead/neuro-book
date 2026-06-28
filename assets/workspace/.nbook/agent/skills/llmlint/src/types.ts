export type RuleLevel = "high" | "medium" | "low";

export type RuleOverride = "off" | "warn" | "error" | RuleLevel;

export type LlmlintOutput = "stylish";

export type LlmlintConfig = {
    /** 启用的规则预设。为空时默认使用 anti-ai-slop。 */
    presets?: string[];
    /** 按规则 ID 覆盖级别；off 表示禁用该规则。 */
    rules?: Record<string, RuleOverride>;
    /** 预留给后续批量 lint 的文件 globs；v1 单文件 check 不主动展开。 */
    files?: string[];
    /** 预留给后续批量 lint 的忽略 globs；v1 单文件 check 不主动展开。 */
    ignores?: string[];
    output?: LlmlintOutput;
};

export type NormalizedLlmlintConfig = {
    presets: string[];
    rules: Record<string, RuleOverride>;
    files: string[];
    ignores: string[];
    output: LlmlintOutput;
};

export interface BaseRule {
    id: string;
    name: string;
    level: RuleLevel;
    description: string;
    reasoning: string;
}

export interface StaticRule extends BaseRule {
    type: "static";
    pattern: string;
    fixSuggestion: string;
}

export interface LLMRule extends BaseRule {
    type: "llm";
    llmJudgmentPrompt: string;
    llmExamples?: Array<{
        text: string;
        shouldFlag: boolean;
        reason: string;
    }>;
}

export type Rule = StaticRule | LLMRule;

export interface Issue {
    rule: StaticRule;
    line: number;
    column: number;
    match: string;
    context: {
        before: string;
        current: string;
        after: string;
    };
}
