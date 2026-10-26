/**
 * 命令行的切词与帮助，交给 commander；命令表（commands.ts）仍是命令、选项与解码器的唯一来源。
 *
 * commander 只做三件事：把选项和位置参数分开、认出命令、按命令给 `--help`。用法错误的中文提示和退出码都留在这里
 * 与 `decodeArguments`，所以让 commander 放行它自己会报英文错误的情形：位置参数不在 commander 里声明（个数由
 * `decodeArguments` 检查），未知选项和多余的参数照收，留给这里按“没有选项 --x”报。commander 不退出进程：
 * `exitOverride` 把它的退出变成异常，输出经 `CliIo`。
 *
 * `--library`、`--json` 在根命令和每条命令上都声明，取值时两处都看：commander 默认在命令名之后也认根命令的选项，
 * 值有时记在根命令上、有时记在子命令上，取决于它与命令名、未知选项的先后。
 */

import {Command, CommanderError} from "commander";

import {camelCase, COMMANDS, FLAGS, OPTION_HELP, usage, UsageError} from "./commands";
import type {CommandSpec} from "./commands";
import type {CliIo} from "./main";

/** commander 的否定选项（`--no-ledger`）。 */
const NEGATED = /^no-/u;

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
                // `--no-x` 是 commander 的否定选项：值存在 `x` 下，不传时也有一个缺省的 true。这里把它当成普通开关：
                // 只有命令行上真写了才算给了（不然“没给”与“给了开”分不清）。
                if (NEGATED.test(name)) {
                    if (command.getOptionValueSource(camelCase(name.slice(3))) === "cli") options.set(name, "true");
                    continue;
                }
                const value = command.getOptionValue(camelCase(name)) as string | boolean | undefined;
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
 * 交给 commander 之前，把命令行整理成它能按旧规则解析的样子。换 commander 之前的手写解析器允许两种写法，commander
 * 不认，这里改写过去：
 *
 * - 命令专属的选项写在命令名前（`--at 38 info`）：根命令不认识 `--at`，会把它当成命令名。所以先按旧规则找出命令名
 *   提到最前面：不在 `FLAGS` 里的 `--x` 不带 `=` 时吃掉下一个词作值，第一个既不是选项也不是选项值的词是命令名。
 * - 开关带等号（`--json=false`）：旧版不看等号后面，一律当作打开；commander 的开关不收值，会报未知选项。
 */
function normalizeArgv(argv: readonly string[]): string[] {
    const tokens = argv.map(token => {
        const flag = /^--([^=]+)=/u.exec(token)?.[1];
        return flag !== undefined && FLAGS.has(flag) ? `--${flag}` : token;
    });
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        if (!token.startsWith("--")) {
            if (index > 0) tokens.unshift(...tokens.splice(index, 1));
            break;
        }
        if (!token.includes("=") && !FLAGS.has(token.slice(2))) index += 1;
    }
    return tokens;
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
        program.parse(normalizeArgv(argv), {from: "user"});
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
