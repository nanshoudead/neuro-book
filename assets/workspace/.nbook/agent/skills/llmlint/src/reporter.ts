import type {Issue, LLMRule} from "./types.ts";

export function formatCheckReport(filePath: string, issues: Issue[]): string {
    const lines: string[] = [filePath, ""];
    if (issues.length === 0) {
        lines.push("✓ No problems found");
        return lines.join("\n");
    }

    const grouped = groupByRule(issues);
    const levelCounts = {high: 0, medium: 0, low: 0};

    for (const ruleIssues of grouped.values()) {
        const rule = ruleIssues[0].rule;
        lines.push(`${rule.id} (${rule.description})`);

        for (const issue of ruleIssues) {
            const linePrefix = `  ${issue.line}:${issue.column}  `;
            lines.push(`${linePrefix}${issue.context.before}${issue.context.current}${issue.context.after}`.trimEnd());
            lines.push(`${" ".repeat(linePrefix.length + issue.context.before.length)}${"^".repeat(Math.max(1, issue.context.current.length))}`);
            lines.push("");
            levelCounts[issue.rule.level]++;
        }

        const occurrenceText = ruleIssues.length === 1 ? "occurrence" : "occurrences";
        lines.push(`  ${ruleIssues.length} ${occurrenceText}. 修复建议：${rule.fixSuggestion}`);
        lines.push("");
    }

    const total = levelCounts.high + levelCounts.medium + levelCounts.low;
    const parts = [];
    if (levelCounts.high > 0) parts.push(`${levelCounts.high} high`);
    if (levelCounts.medium > 0) parts.push(`${levelCounts.medium} medium`);
    if (levelCounts.low > 0) parts.push(`${levelCounts.low} low`);
    lines.push(`✖ ${total} problem${total > 1 ? "s" : ""} (${parts.join(", ")})`);

    return lines.join("\n");
}

export function formatLLMRules(rules: LLMRule[]): string {
    const lines: string[] = [
        "LLM 判断规则",
        "",
        "说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。",
        "",
    ];

    if (rules.length === 0) {
        lines.push("当前没有启用需要全文语义审查的 LLM 规则。");
        return lines.join("\n");
    }

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
        const rule = rules[ruleIndex];
        lines.push(`规则 ${ruleIndex + 1}: ${rule.id} - ${rule.name}`);
        lines.push("");
        lines.push(`级别: ${rule.level}`);
        lines.push("");
        lines.push(`描述: ${rule.description}`);
        lines.push("");
        lines.push(`原因: ${rule.reasoning}`);
        lines.push("");
        lines.push("判断标准:");
        lines.push("");
        lines.push(rule.llmJudgmentPrompt);
        lines.push("");

        if (rule.llmExamples && rule.llmExamples.length > 0) {
            lines.push("判断示例:");
            lines.push("");
            for (let i = 0; i < rule.llmExamples.length; i++) {
                const example = rule.llmExamples[i];
                lines.push(`示例 ${i + 1}:`);
                lines.push("");
                lines.push(`文本: ${example.text}`);
                lines.push("");
                lines.push(`应该标记: ${example.shouldFlag ? "是" : "否"}`);
                lines.push("");
                lines.push(`理由: ${example.reason}`);
                lines.push("");
            }
        }

        lines.push("----");
        lines.push("");
    }

    return lines.join("\n");
}

export function hasHighLevelIssue(issues: Issue[]): boolean {
    return issues.some((issue) => issue.rule.level === "high");
}

function groupByRule(issues: Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();
    for (const issue of issues) {
        const current = grouped.get(issue.rule.id) ?? [];
        current.push(issue);
        grouped.set(issue.rule.id, current);
    }
    return grouped;
}
