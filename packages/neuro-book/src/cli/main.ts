#!/usr/bin/env bun
/**
 * `nbook` 命令行入口（docs/specs/runtime/cli.md）：给用户与 Agent 用，随应用的 npm 包发布，打包成 `dist/server/nbook.js`。
 * 不给子命令等于 `start`。
 *
 * commander 的错误不让它自己打印（英文、退出码 1），统一在这里按错误码换成中文、以 2 退出；它的帮助标题也换成中文。
 */

import {homedir} from "node:os";

import {Command, CommanderError} from "commander";

import {BUN_ENGINE, PRODUCT_VERSION} from "nbook/shared/product";

import {CliFailure, createOutput} from "./output";
import {start} from "./start";
import {defaultStateRoot, resolveStateRoot} from "./state-root";

const TITLES: Readonly<Record<string, string>> = {"Usage:": "用法：", "Arguments:": "参数：", "Options:": "选项：", "Commands:": "命令：", "Global Options:": "全局选项："};

function versionText(): string {
    return `NeuroBook ${PRODUCT_VERSION}\nBun ${Bun.version}\n缺省状态根 ${defaultStateRoot(process.platform, process.env, homedir())}`;
}

function portOption(value: string): number {
    const port = Number(value);
    if (!/^\d+$/u.test(value) || port > 65535) throw new CliFailure("usage", `端口必须是 0 到 65535 的整数，收到 ${value}`, 2);
    return port;
}

interface GlobalOptions {
    readonly stateRoot?: string;
    readonly json?: boolean;
}

function program(): Command {
    const nbook = new Command("nbook")
        .description("NeuroBook：本地优先的长篇写作工作区")
        .usage("[选项] [命令]")
        .option("--state-root <目录>", "状态根（缺省是平台的数据目录，或环境变量 NBOOK_STATE_ROOT）")
        .option("--json", "结果以一个 JSON 对象写到标准输出")
        .helpOption("-h, --help", "显示帮助")
        .helpCommand("help [命令]", "显示命令的帮助")
        .version(versionText(), "-v, --version", "显示版本")
        .configureHelp({styleTitle: (title) => TITLES[title] ?? title})
        .configureOutput({outputError: () => undefined})
        .exitOverride();
    nbook
        .command("start", {isDefault: true})
        .description("启动 NeuroBook（前台运行，Ctrl-C 停止）；状态根上已有实例时打开它")
        .usage("[选项]")
        .option("--port <端口>", "HTTP 端口（缺省 4217，被占用时顺延）", portOption)
        .option("--rpc-port <端口>", "内核 RPC 端口（缺省跟着 --port 加 1，都不给时是 4218）", portOption)
        .option("--no-open", "不打开浏览器")
        .option("--safe-mode", "安全模式：不加载第三方插件")
        // 拼错的子命令会被当成缺省的 start 的参数：收下它们，在下面报“不认识的命令”。
        .allowExcessArguments()
        .action(async (options: {port?: number; rpcPort?: number; open: boolean; safeMode?: boolean}, command: Command) => {
            const [unknown] = command.args;
            if (unknown !== undefined) throw new CliFailure("usage", `不认识的命令 ${unknown}；可用的命令：start（nbook --help 查看用法）`, 2);
            const globals = command.optsWithGlobals<GlobalOptions>();
            await start(
                {stateRoot: stateRootOf(globals), output: createOutput(globals.json === true), env: process.env, cwd: process.cwd()},
                {port: options.port, rpcPort: options.rpcPort, open: options.open, safeMode: options.safeMode === true},
            );
        });
    return nbook;
}

function stateRootOf(globals: GlobalOptions): string {
    return resolveStateRoot({option: globals.stateRoot, env: process.env, platform: process.platform, home: homedir(), cwd: process.cwd()});
}

/** commander 的错误码对应的中文说明；帮助与版本是正常结束。 */
function usageFailure(error: CommanderError): CliFailure | null {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") return null;
    const detail = error.message.replace(/^error: /u, "");
    switch (error.code) {
        case "commander.unknownOption":
            return new CliFailure("usage", `不认识的选项（${detail}）；nbook --help 查看用法`, 2);
        case "commander.unknownCommand":
            return new CliFailure("usage", `不认识的命令（${detail}）；nbook --help 查看用法`, 2);
        case "commander.missingArgument":
        case "commander.optionMissingArgument":
            return new CliFailure("usage", `缺少参数（${detail}）；nbook --help 查看用法`, 2);
        default:
            return new CliFailure("usage", `用法错误（${detail}）；nbook --help 查看用法`, 2);
    }
}

async function main(argv: readonly string[]): Promise<number> {
    const json = argv.includes("--json");
    const output = createOutput(json);
    if (!Bun.semver.satisfies(Bun.version, BUN_ENGINE)) {
        output.failure(new CliFailure("bun-too-old", `NeuroBook 需要 Bun ${BUN_ENGINE}，当前是 ${Bun.version}；运行 bun upgrade 后再试`, 2));
        return 2;
    }
    try {
        await program().parseAsync(argv, {from: "user"});
        return 0;
    } catch (error) {
        // portOption 在 commander 解析参数时抛出，commander 把它原样往外抛。
        const failure = error instanceof CommanderError ? usageFailure(error) : error instanceof CliFailure ? error : null;
        if (error instanceof CommanderError && failure === null) return 0;
        if (failure === null) throw error;
        output.failure(failure);
        return failure.exitCode;
    }
}

process.exit(await main(process.argv.slice(2)));
