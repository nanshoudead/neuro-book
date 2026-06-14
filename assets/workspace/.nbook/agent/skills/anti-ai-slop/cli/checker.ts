#!/usr/bin/env bun
import {Command} from "commander";
import {readFileSync} from "node:fs";
import {resolve, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

// 类型定义
interface BaseRule {
    id: string;
    name: string;
    level: "high" | "medium" | "low";  // 规则级别
    description: string;
    reasoning: string;
}

interface StaticRule extends BaseRule {
    type: "static";
    pattern: string;
    description: string;  // 简短描述，用于显示在规则 ID 后
    fixSuggestion: string;  // 修复建议
}

interface LLMRule extends BaseRule {
    type: "llm";
    llmJudgmentPrompt: string;
    llmExamples?: Array<{
        text: string;
        shouldFlag: boolean;
        reason: string;
    }>;
}

type Rule = StaticRule | LLMRule;

interface Issue {
    rule: Rule;
    line: number;
    column: number;
    match: string;
    context: {
        before: string;
        current: string;
        after: string;
    };
}

interface CategorySuggestion {
    fixSuggestion: string;
    examples: Array<{
        bad: string;
        good: string;
        explanation: string;
    }>;
}

// 获取脚本目录 (使用 bun 的 import.meta.dir)
const SCRIPT_DIR = import.meta.dir;

// 加载规则（只加载 static rules）
async function loadRules() {
    const staticRulesPath = resolve(SCRIPT_DIR, "rules/static-rules.json");

    try {
        const staticRules: StaticRule[] = await Bun.file(staticRulesPath).json();
        return {staticRules};
    } catch (error) {
        console.error("加载规则文件失败:");
        console.error("  staticRulesPath:", staticRulesPath);
        throw error;
    }
}

// 类型守卫
function isStaticRule(rule: Rule): rule is StaticRule {
    return rule.type === "static";
}

function isLLMRule(rule: Rule): rule is LLMRule {
    return rule.type === "llm";
}

// 扫描文本
function scanText(content: string, rules: StaticRule[]): Issue[] {
    const lineStarts = buildLineStarts(content);
    const issues: Issue[] = [];

    for (const rule of rules) {
        const regex = new RegExp(rule.pattern, "g");
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const position = locatePosition(lineStarts, match.index);
            const context = extractContext(content, match.index, match[0].length);

            issues.push({
                rule,
                line: position.line,
                column: position.column,
                match: match[0],
                context,
            });

            // 防止空匹配规则导致死循环。
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }

    return issues;
}

// 构建每一行在全文中的起始位置，便于全文扫描后反算行列。
function buildLineStarts(content: string): number[] {
    const lineStarts = [0];

    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            lineStarts.push(index + 1);
        }
    }

    return lineStarts;
}

// 将全文索引转换成 1-based 行列号。
function locatePosition(lineStarts: number[], index: number): {line: number; column: number} {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);

        if (lineStarts[middle] <= index) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    const lineIndex = Math.max(0, high);
    return {
        line: lineIndex + 1,
        column: index - lineStarts[lineIndex] + 1,
    };
}

// 提取上下文；跨行命中用可见转义展示，避免报告布局被换行打断。
function extractContext(
    content: string,
    matchIndex: number,
    matchLength: number
): {before: string; current: string; after: string} {
    const matchEnd = matchIndex + matchLength;
    const lineStart = content.lastIndexOf("\n", Math.max(0, matchIndex - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", matchEnd);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;

    const before = renderInline(content.substring(Math.max(lineStart, matchIndex - 20), matchIndex));
    const current = renderInline(content.substring(matchIndex, matchEnd));
    const after = renderInline(content.substring(matchEnd, Math.min(lineEnd, matchEnd + 20)));

    return {before, current, after};
}

// 将不可见换行转成报告中的普通字符。
function renderInline(text: string): string {
    return text
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

// 按规则 ID 分组
function groupByRule(issues: Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();

    for (const issue of issues) {
        const ruleId = issue.rule.id;
        if (!grouped.has(ruleId)) {
            grouped.set(ruleId, []);
        }
        grouped.get(ruleId)!.push(issue);
    }

    return grouped;
}

// 格式化输出（按规则分组）
function printReport(filePath: string, grouped: Map<string, Issue[]>) {
    console.log(filePath);
    console.log();

    const levelCounts = {high: 0, medium: 0, low: 0};

    // 按规则 ID 遍历
    for (const [ruleId, issues] of grouped) {
        const rule = issues[0].rule;  // 同一规则的所有 issue 共享同一个 rule 对象

        // 输出规则标题
        console.log(`${rule.id} (${rule.description})`);

        // 输出该规则的所有命中
        for (const issue of issues) {
            const level = issue.rule.level;

            // 行号:列号（无填充）+ 上下文
            console.log(`  ${issue.line}:${issue.column}  ${issue.context.before}${issue.context.current}${issue.context.after}`.trimEnd());

            // 输出指示符
            const beforeLen = issue.context.before.length;
            const currentLen = issue.context.current.length;
            const linePrefix = `  ${issue.line}:${issue.column}  `;
            const pointer = " ".repeat(linePrefix.length + beforeLen) + "^".repeat(Math.max(1, currentLen));
            console.log(pointer);

            console.log();

            // 统计
            levelCounts[level]++;
        }

        // 输出统计和修复建议
        const count = issues.length;
        const occurrenceText = count === 1 ? "occurrence" : "occurrences";
        console.log(`  ${count} ${occurrenceText}. 修复建议：${rule.fixSuggestion}`);
        console.log();
    }

    // 输出总体统计
    const total = levelCounts.high + levelCounts.medium + levelCounts.low;
    const parts = [];
    if (levelCounts.high > 0) parts.push(`${levelCounts.high} high`);
    if (levelCounts.medium > 0) parts.push(`${levelCounts.medium} medium`);
    if (levelCounts.low > 0) parts.push(`${levelCounts.low} low`);

    if (total > 0) {
        console.log(`✖ ${total} problem${total > 1 ? "s" : ""} (${parts.join(", ")})`);
    }
}

// 主函数
async function main() {
    const program = new Command();

    program
        .name("anti-ai-slop-checker")
        .description("检查中文文本中的 AI 味道")
        .version("1.0.0");

    // check 命令：检查文件
    program
        .command("check")
        .description("检查文件中的 AI 味道")
        .argument("<file>", "要检查的文件路径")
        .option("--verbose", "显示详细上下文")
        .action(async (file: string, options: {verbose?: boolean}) => {
            try {
                // 读取文件
                const filePath = resolve(process.cwd(), file);
                const content = readFileSync(filePath, "utf-8");

                // 加载规则
                const {staticRules} = await loadRules();

                // 扫描文本
                const issues = scanText(content, staticRules);

                // 按规则分组
                const grouped = groupByRule(issues);

                // 输出报告
                if (grouped.size === 0) {
                    console.log(filePath);
                    console.log();
                    console.log("✓ No problems found");
                } else {
                    printReport(filePath, grouped);
                }

                // 设置退出码
                const hasHighLevel = Array.from(grouped.values())
                    .flat()
                    .some((i) => i.rule.level === "high");
                if (hasHighLevel) {
                    process.exitCode = 1;
                }
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    // show-llm-rules 命令：显示 LLM 规则
    program
        .command("show-llm-rules")
        .description("显示需要 Agent 主动全文审查的 LLM 规则")
        .action(async () => {
            try {
                const llmRulesPath = resolve(SCRIPT_DIR, "rules/llm-rules.json");
                const llmRules: LLMRule[] = await Bun.file(llmRulesPath).json();

                console.log("LLM 判断规则");
                console.log();
                console.log("说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。");
                console.log();

                if (llmRules.length === 0) {
                    console.log("当前没有启用需要全文语义审查的 LLM 规则。");
                    return;
                }

                for (let ruleIndex = 0; ruleIndex < llmRules.length; ruleIndex++) {
                    const rule = llmRules[ruleIndex];
                    console.log(`规则 ${ruleIndex + 1}: ${rule.id} - ${rule.name}`);
                    console.log();
                    console.log(`级别: ${rule.level}`);
                    console.log();
                    console.log(`描述: ${rule.description}`);
                    console.log();
                    console.log(`原因: ${rule.reasoning}`);
                    console.log();
                    console.log("判断标准:");
                    console.log();
                    console.log(rule.llmJudgmentPrompt);
                    console.log();

                    if (rule.llmExamples && rule.llmExamples.length > 0) {
                        console.log("判断示例:");
                        console.log();

                        for (let i = 0; i < rule.llmExamples.length; i++) {
                            const example = rule.llmExamples[i];
                            console.log(`示例 ${i + 1}:`);
                            console.log();
                            console.log(`文本: ${example.text}`);
                            console.log();
                            console.log(`应该标记: ${example.shouldFlag ? "是" : "否"}`);
                            console.log();
                            console.log(`理由: ${example.reason}`);
                            console.log();
                        }
                    }

                    console.log("----");
                    console.log();
                }
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    // 默认命令：check（兼容旧用法）
    program
        .argument("[file]", "要检查的文件路径")
        .option("--verbose", "显示详细上下文")
        .action(async (file: string | undefined, options: {verbose?: boolean}) => {
            if (!file) {
                program.help();
                return;
            }

            // 调用 check 命令
            await program.parseAsync(["node", "checker.ts", "check", file, ...(options.verbose ? ["--verbose"] : [])]);
        });

    await program.parseAsync(process.argv);
}

main();
