/**
 * `nbstory ask`（docs/specs/story/qa.md 输出 12 到 14、26）：进度写标准错误，答案或文字回复写标准输出；`--continue`
 * 在已有对话里追问。由 main.ts 动态导入，只有这条命令才加载 OMP。
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
import {EFFORTS} from "../contract/config-schema";
import {defaultConfigPath, loadQaConfig, type Effort} from "../qa/config";
import {askQuestion, type QaOutcome, type QaProgress} from "../qa/engine";
import {QaError} from "../qa/errors";
import {turnText} from "../qa/format";
import {NEXT_STEP, type CliIo} from "./main";

export const EXIT_QA_FAILED = 4;
export const EXIT_INTERRUPTED = 130;

function progressLine(event: QaProgress): string {
    switch (event.kind) {
        case "tool":
            return `· ${event.text}`;
        case "rejected":
            return `· 作答被退回：${event.text.replace(/^答案没有通过校验，改了再交：\n/u, "").replace(/\n/gu, " ")}`;
        case "recheck":
            return `· 出处检查：${event.refs.join("、")} 没读过，已让模型重写`;
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

    const continueFrom = params.continue as string | undefined;
    if (continueFrom !== undefined && (params.at !== undefined || params.mode !== undefined || params.structured === true)) {
        io.stderr("用法错误：--continue 追问时阅读位置、做法与作答方式取对话开始时的，不能再写 --at、--mode 或 --structured");
        return 2;
    }
    if (params.thinking !== undefined && !(EFFORTS as readonly string[]).includes(params.thinking as string)) {
        io.stderr(`用法错误：--thinking 只能是 ${EFFORTS.join("、")}`);
        return 2;
    }

    let outcome: QaOutcome;
    try {
        const {configCatalog} = await import("../qa/harness-model");
        const config = await loadQaConfig(typeof params.config === "string" ? params.config : defaultConfigPath(), configCatalog());
        // 只对这一问：模型要在候选里，推理档按模型夹（同网页，qa.md 的 qa.start）。
        if (typeof params.model === "string" && !config.models.includes(params.model)) {
            io.stderr(`用法错误：--model ${params.model} 不在配置的候选模型里（nbstory config show 看候选）`);
            return 2;
        }
        outcome = await askQuestion({
            api: createStoryApi(options.library === undefined ? {} : {library: options.library}),
            ...(typeof params.book === "string" ? {book: params.book} : {}),
            ...(params.at === undefined ? {} : {at: params.at as PositionInput}),
            ...(params.mode === undefined ? {} : {mode: params.mode as QaMode}),
            ...(continueFrom === undefined ? {} : {continueFrom}),
            question: params.question as string,
            config,
            ...(params.model === undefined && params.thinking === undefined ? {} : {model: {...(typeof params.model === "string" ? {model: params.model} : {}), ...(typeof params.thinking === "string" ? {thinking: params.thinking as Effort} : {})}}),
            ...(params.structured === true ? {answer: "structured" as const} : {}),
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

    const {result} = outcome;
    if (!outcome.recordSaved) {
        const {notSaved} = outcome;
        const why =
            notSaved.reason === "unsupported_format"
                ? "书库或这本书的格式版本不认识，只读"
                : notSaved.reason === "write_failed"
                  ? `写盘失败：${notSaved.message}`
                  : notSaved.reason === "conflict"
                    ? "这个对话在这一轮期间被别处追问或删除了"
                    : "这本书在问答期间被删除或重新导入了";
        io.stderr(`· 记录没有保存：${why}`);
    }
    const where = `对话 ${result.id} 第 ${result.turn} 轮`;
    if (result.status === "interrupted") return fail("cancelled", `已取消，${where}标为中断`, EXIT_INTERRUPTED);
    if (result.status === "failed") return fail(result.error!.code, `${result.error!.message}（${where}）`, EXIT_QA_FAILED, result.error!.kind);
    io.stdout(json ? JSON.stringify({ok: true, data: {...result, recordSaved: outcome.recordSaved, ...(outcome.recordSaved ? {} : {notSaved: outcome.notSaved})}}) : turnText(result));
    return 0;
}
