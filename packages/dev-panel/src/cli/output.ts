import {isNbdevError, NbdevError, type ExitCode, type Warning} from "../core/errors.js";

export type Writable = {write(chunk: string): unknown};
/** 命令行的输入输出；`env` 是调用者的环境变量（认会话、找 herdr 都从这里取，核心函数不读 `process.env`）。 */
export type CliIo = {cwd: string; env: NodeJS.ProcessEnv; stdout: Writable; stderr: Writable};

/** 一条命令的结果：`error` 为空即成功（可以带警告）。 */
export type CommandOutcome = {
    schema: string;
    data: unknown;
    warnings: Warning[];
    error: NbdevError | null;
    /** 不加 `--json` 时打印到 stdout 的摘要。 */
    human: string[];
    /**
     * 长命令（`dev start`）已经边跑边按行输出了事件：成功时不再打一次性的外壳，退出码取 `exitCode`；警告照常写 stderr。
     * 起来之前就失败的仍按普通命令输出错误外壳。
     */
    streamed?: {exitCode: ExitCode};
};

export type ErrorEntry = {code: string; message: string; details?: Record<string, unknown>};

/** 把任意异常收成 nbdev 的错误条目；不是 NbdevError 的视为内部错误，并把堆栈写到 stderr 便于诊断。 */
export function toNbdevError(error: unknown, io: CliIo): NbdevError {
    if (isNbdevError(error)) return error;
    io.stderr.write(`nbdev 内部错误：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return new NbdevError("internal", error instanceof Error ? error.message : String(error), {cause: error});
}

function errorEntry(error: NbdevError): ErrorEntry {
    return error.details === undefined ? {code: error.code, message: error.message} : {code: error.code, message: error.message, details: error.details};
}

/** 普通输出里每条错误、警告之后最多列几条明细；`--json` 不受限。 */
const DETAIL_LIMIT = 20;

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
    return typeof value === "number" ? value : null;
}

/** `invalid_questions` 的一处：页面标记的前面带 `page:line:column`；`message` 自己写明了是哪道题（`题 <题号>…`），这里不再加。 */
function problemLine(value: unknown): string | null {
    const problem = record(value);
    if (problem === null) return null;
    const message = text(problem.message);
    const code = text(problem.code);
    if (message === null || code === null) return null;
    const page = text(problem.page);
    const line = count(problem.line);
    const column = count(problem.column);
    const where = page === null ? "" : `${[page, line, line === null ? null : column].filter((part) => part !== null).join(":")} `;
    return `${where}${message} [${code}]`;
}

/** 引用类警告的一处：`page:line target`，没有行号时只写页面。 */
function referenceLine(value: unknown): string | null {
    const reference = record(value);
    if (reference === null) return null;
    const page = text(reference.page);
    const target = text(reference.target);
    if (page === null || target === null) return null;
    const line = count(reference.line);
    return `${line === null ? page : `${page}:${line}`} ${target}`;
}

function listOf(details: Record<string, unknown> | undefined, key: string, format: (value: unknown) => string | null): string[] {
    const list = details?.[key];
    if (!Array.isArray(list)) return [];
    return list.map(format).filter((line): line is string => line !== null);
}

/**
 * 普通输出在错误、警告那一行之后列出的明细：只给只看消息里的数量就没法动手改的几种（docs/cli.md 的“--json 外壳”）。
 * 明细取自 `details`；形状对不上的条目跳过，不让输出本身失败（`--json` 里仍有原样的 `details`）。
 */
export function detailLines(entry: {code: string; details?: Record<string, unknown>}): string[] {
    switch (entry.code) {
    case "invalid_questions":
        return listOf(entry.details, "problems", problemLine);
    case "unreferenced_files_not_committed":
        return listOf(entry.details, "paths", text);
    case "missing_reference":
    case "reference_outside_artifact":
        return listOf(entry.details, "references", referenceLine);
    default:
        return [];
    }
}

function writeEntry(io: CliIo, label: string, entry: {code: string; message: string; details?: Record<string, unknown>}): void {
    io.stderr.write(`${label} [${entry.code}] ${entry.message}\n`);
    const lines = detailLines(entry);
    for (const line of lines.slice(0, DETAIL_LIMIT)) io.stderr.write(`  ${line}\n`);
    if (lines.length > DETAIL_LIMIT) io.stderr.write(`  另有 ${lines.length - DETAIL_LIMIT} 条，加 --json 看全部\n`);
}

/**
 * 输出并返回退出码。`--json` 时 stdout 只有 `{schema, ok, data, warnings, errors}` 一个对象；
 * 否则 stdout 打印摘要，警告与错误走 stderr。
 */
export function emit(outcome: CommandOutcome, json: boolean, io: CliIo): ExitCode {
    if (outcome.streamed && !outcome.error) {
        for (const warning of outcome.warnings) {
            if (json) io.stderr.write(`${JSON.stringify({warning})}\n`);
            else writeEntry(io, "警告", warning);
        }
        return outcome.streamed.exitCode;
    }
    const errors = outcome.error ? [errorEntry(outcome.error)] : [];
    if (json) {
        io.stdout.write(`${JSON.stringify({schema: outcome.schema, ok: outcome.error === null, data: outcome.data ?? null, warnings: outcome.warnings, errors}, null, 2)}\n`);
    } else {
        for (const line of outcome.human) io.stdout.write(`${line}\n`);
        for (const warning of outcome.warnings) writeEntry(io, "警告", warning);
        if (outcome.error) writeEntry(io, "错误", errorEntry(outcome.error));
    }
    return outcome.error ? outcome.error.exitCode : 0;
}
