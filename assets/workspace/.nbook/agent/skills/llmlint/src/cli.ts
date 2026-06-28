import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Command} from "commander";
import {loadConfig} from "./config.ts";
import {loadRules} from "./rules.ts";
import {scanText} from "./scanner.ts";
import {formatCheckReport, formatLLMRules, hasHighLevelIssue} from "./reporter.ts";

type GlobalOptions = {
    config?: string;
};

/**
 * llmlint 命令行入口。业务逻辑保持在模块里，方便后续 Web / 编辑器复用。
 */
export async function runCli(argv: string[]): Promise<void> {
    const program = new Command();

    program
        .name("llmlint")
        .description("检查 LLM 输出中的套路化表达、AI 写作痕迹和中文文本节奏问题")
        .version("0.1.0")
        .option("-c, --config <path>", "指定 llmlint.config.ts 路径");

    program
        .command("check")
        .description("检查文件中的 static rule 候选问题")
        .argument("<file>", "要检查的 UTF-8 文本文件")
        .action(async (file: string) => {
            try {
                const options = program.opts<GlobalOptions>();
                await checkFile(file, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("show-llm-rules")
        .description("显示需要 Agent 主动全文审查的 LLM 规则")
        .action(async () => {
            try {
                const options = program.opts<GlobalOptions>();
                await showLLMRules(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .argument("[file]", "兼容旧用法：等同于 check <file>")
        .action(async (file: string | undefined) => {
            if (!file) {
                program.help();
                return;
            }
            try {
                const options = program.opts<GlobalOptions>();
                await checkFile(file, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    await program.parseAsync(argv);
}

async function checkFile(file: string, options: GlobalOptions): Promise<void> {
    const {config} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const {staticRules} = await loadRules(config);
    const filePath = resolve(process.cwd(), file);
    const issues = scanText(readFileSync(filePath, "utf-8"), staticRules);
    console.log(formatCheckReport(filePath, issues));
    if (hasHighLevelIssue(issues)) {
        process.exitCode = 1;
    }
}

async function showLLMRules(options: GlobalOptions): Promise<void> {
    const {config} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const {llmRules} = await loadRules(config);
    console.log(formatLLMRules(llmRules));
}
