/**
 * `nbstory ask`（docs/specs/story/qa.md 输出 12 到 14）：进度写标准错误，答案写标准输出。由 main.ts 动态导入，
 * 只有这条命令才加载 OMP。
 *
 * 中断信号（Ctrl-C）只中止这一问：引擎收尾、写下“中断”的记录后才以 130 退出。OMP 一被导入就装上自己的 SIGINT
 * 处理（跑完登记的清理就以 130 退出），所以收尾经 nb-harness 的 onProcessInterrupt 登记：回调中止这一问，
 * 等这条命令把记录写完、输出写完再返回，OMP 随后退出。
 */

import {onProcessInterrupt} from "@notnotype/nb-harness";

import {createStoryApi} from "../core/api";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";
import type {QaMode} from "../core/qa-records";
import {loadQaConfig} from "../qa/config";
import {askQuestion, type QaOutcome, type QaProgress} from "../qa/engine";
import {QaError} from "../qa/errors";
import {recordText} from "../qa/format";
import {NEXT_STEP, type CliIo} from "./main";

export const EXIT_QA_FAILED = 4;
export const EXIT_INTERRUPTED = 130;

function progressLine(event: QaProgress): string {
    switch (event.kind) {
        case "tool":
            return `· ${event.text}`;
        case "rejected":
            return `· 作答被退回：${event.text.replace(/^答案没有通过校验，改了再交：\n/u, "").replace(/\n/gu, " ")}`;
        case "reminder":
            return "· 没有交卷，提醒一次";
        case "answered":
            return "· 已交卷";
    }
}

interface AskOptions {
    library: string | undefined;
    params: Record<string, unknown>;
    json: boolean;
}

/** 跑 `run`，期间收到中断信号就取消它的 `signal`，并等它收尾后才让 OMP 的退出继续。 */
export async function runInterruptible<T>(io: CliIo, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const finished = Promise.withResolvers<void>();
    const unregister = onProcessInterrupt(async () => {
        io.stderr("· 收到中断信号，正在取消");
        controller.abort();
        await finished.promise;
    });
    try {
        return await run(controller.signal);
    } finally {
        unregister();
        finished.resolve();
    }
}

export const askCommand = (options: AskOptions, io: CliIo): Promise<number> => runInterruptible(io, signal => ask(options, io, signal));

async function ask(options: AskOptions, io: CliIo, signal: AbortSignal): Promise<number> {
    const {params, json} = options;
    const fail = (code: string, message: string, exit: number, kind?: string): number => {
        if (json) io.stdout(JSON.stringify({ok: false, error: {code, message, ...(kind === undefined ? {} : {kind})}}));
        else io.stderr(`错误（${code}${kind ? `，${kind}` : ""}）：${message}`);
        return exit;
    };

    let outcome: QaOutcome;
    try {
        const config = await loadQaConfig(...(typeof params.config === "string" ? [params.config] : []));
        outcome = await askQuestion({
            api: createStoryApi(options.library === undefined ? {} : {library: options.library}),
            ...(typeof params.book === "string" ? {book: params.book} : {}),
            ...(params.at === undefined ? {} : {at: params.at as PositionInput}),
            mode: (params.mode as QaMode | undefined) ?? "graph",
            question: params.question as string,
            config,
            signal,
            onProgress: event => io.stderr(progressLine(event)),
        });
    } catch (error) {
        if (error instanceof StoryError) {
            const next = NEXT_STEP[error.code];
            return fail(error.code, `${error.message}${next && !json ? `\n下一步：${next}` : ""}`, 1);
        }
        if (error instanceof QaError) return fail(error.code, error.message, EXIT_QA_FAILED);
        throw error;
    }

    const {record} = outcome;
    if (!outcome.recordSaved) {
        const {notSaved} = outcome;
        const why = notSaved.reason === "unsupported_format" ? "书库或这本书的格式版本不认识，只读" : notSaved.reason === "write_failed" ? `写盘失败：${notSaved.message}` : "这本书在问答期间被删除或重新导入了";
        io.stderr(`· 记录没有保存：${why}`);
    }
    if (record.status === "interrupted") return fail("cancelled", `已取消，记录 ${record.id} 标为中断`, EXIT_INTERRUPTED);
    if (record.status === "failed") return fail(record.error!.code, `${record.error!.message}（记录 ${record.id}）`, EXIT_QA_FAILED, record.error!.kind);
    io.stdout(json ? JSON.stringify({ok: true, data: {...record, recordSaved: outcome.recordSaved, ...(outcome.recordSaved ? {} : {notSaved: outcome.notSaved})}}) : recordText(record));
    return 0;
}
