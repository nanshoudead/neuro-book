/**
 * 命令行的切词与帮助，交给 commander；命令表（commands.ts）仍是命令、选项与解码器的唯一来源。
 *
 * commander 只做三件事：把选项和位置参数分开、认出命令、按命令给 `--help`。用法错误的中文提示和退出码都留在这里
 * 与 `decodeArguments`，所以让 commander 放行它自己会报英文错误的情形：位置参数不在 commander 里声明（个数由
 * `decodeArguments` 检查），未知选项和多余的参数照收，留给这里按“没有选项 --x”报。commander 不退出进程：
 * `exitOverride` 把它的退出变成异常，输出经 `CliIo`。
 *
 * 每条命令和根命令都声明 `--library`、`--json`：commander 在遇到根命令不认识的选项（例如 `--at`）之后，把剩下的
 * 全部交给子命令，所以写在后面的 `--library` 只有子命令认得。
 */

import {Command, CommanderError} from "commander";

import {COMMANDS, FLAGS, OPTION_HELP, usage, UsageError} from "./commands";
import type {CommandSpec} from "./commands";
import type {CliIo} from "./main";

/** 命令行解析的结果：要执行的命令与未解码的参数。 */
export interface ParsedCommandLine {
    spec: CommandSpec;
    positionals: string[];
    options: Map<string, string>;
    library: string | undefined;
    json: boolean;
}

/** 解析没有产出命令：已经输出了帮助或用法，`exit` 是该用的退出码。 */
export interface ParseStopped {
    exit: number;
}

function declareOptions(command: Command, spec: CommandSpec | null): void {
    command.option("--library <目录>", OPTION_HELP.library).option("--json", OPTION_HELP.json);
    if (spec) for (const name of Object.keys(spec.options)) command.option(FLAGS.has(name) ? `--${name}` : `--${name} <值>`, OPTION_HELP[name] ?? "");
}

/** 终端里的显示宽度：中文字符占两格。 */
function displayWidth(text: string): number {
    return [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
}

function subcommandHelp(command: Command, spec: CommandSpec): string {
    const args = spec.positionals.map(item => (item.optional ? `[${item.name}]` : `<${item.name}>`)).join(" ");
    const rows = command.options.map(option => ({term: option.flags, text: option.description}));
    const width = Math.max(...rows.map(row => displayWidth(row.term)), "--help".length);
    const pad = (term: string): string => term + " ".repeat(width - displayWidth(term));
    return [
        `用法：nbstory ${spec.name}${args ? ` ${args}` : ""} [选项]`,
        "",
        spec.summary,
        "",
        "选项：",
        ...rows.map(row => `  ${pad(row.term)}  ${row.text}`),
        `  ${pad("--help")}  ${OPTION_HELP.help}`,
    ].join("\n");
}

function buildProgram(io: CliIo, picked: {value: ParsedCommandLine | null}, unknownCommand: {name: string | null}): Command {
    const trim = (text: string): string => text.replace(/\n$/u, "");
    const program = new Command("nbstory")
        .exitOverride()
        .configureOutput({writeOut: text => io.stdout(trim(text)), writeErr: text => io.stderr(trim(text)), outputError: () => undefined})
        .helpCommand(false)
        .helpOption("--help", OPTION_HELP.help)
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument("[命令]")
        .configureHelp({formatHelp: () => usage()});
    declareOptions(program, null);
    program.action((name: string | undefined) => {
        unknownCommand.name = name ?? null;
    });

    for (const spec of COMMANDS) {
        const command = program
            .command(spec.name)
            .summary(spec.summary)
            .helpOption("--help", OPTION_HELP.help)
            .allowUnknownOption(true)
            .allowExcessArguments(true);
        command.configureHelp({formatHelp: () => subcommandHelp(command, spec)});
        declareOptions(command, spec);
        command.action(() => {
            const options = new Map<string, string>();
            for (const name of Object.keys(spec.options)) {
                const value = command.getOptionValue(name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase())) as string | boolean | undefined;
                if (value !== undefined) options.set(name, value === true ? "true" : String(value));
            }
            const unknown = command.args.find(token => token.startsWith("--"));
            if (unknown !== undefined) throw new UsageError(`${spec.name} 没有选项 ${unknown.split("=")[0]}`);
            const root = program.opts<{library?: string; json?: boolean}>();
            const own = command.opts<{library?: string; json?: boolean}>();
            picked.value = {spec, positionals: [...command.args], options, library: own.library ?? root.library, json: (own.json ?? root.json) === true};
        });
    }
    return program;
}

/**
 * 解析命令行。用法错误（未知命令或选项、缺少值）输出提示和用法，返回退出码 2；`--help` 输出帮助，返回 0；不给命令
 * 输出用法，返回 2。参数个数与取值的检查在 `decodeArguments`，由调用方继续。
 */
export function parseCommandLine(argv: readonly string[], io: CliIo): ParsedCommandLine | ParseStopped {
    const picked: {value: ParsedCommandLine | null} = {value: null};
    const unknownCommand: {name: string | null} = {name: null};
    const program = buildProgram(io, picked, unknownCommand);
    try {
        program.parse(argv as string[], {from: "user"});
    } catch (error) {
        if (error instanceof CommanderError) {
            if (error.code === "commander.helpDisplayed") return {exit: 0};
            io.stderr(`${error.code === "commander.optionMissingArgument" ? "选项缺少值：" : ""}${error.message.replace(/^error: /u, "")}\n\n${usage()}`);
            return {exit: 2};
        }
        if (error instanceof UsageError) {
            io.stderr(`${error.message}\n\n${usage()}`);
            return {exit: 2};
        }
        throw error;
    }
    if (picked.value) return picked.value;
    if (unknownCommand.name !== null) {
        io.stderr(`没有命令 ${unknownCommand.name}\n\n${usage()}`);
        return {exit: 2};
    }
    io.stdout(usage());
    return {exit: 2};
}
