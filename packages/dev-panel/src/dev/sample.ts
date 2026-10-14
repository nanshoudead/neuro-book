import {open} from "node:fs/promises";
import {setTimeout as sleep} from "node:timers/promises";
import {createSampleTracker, LineSplitter, sampleUrl, stripAnsi, type SampleOutcome} from "./ready.js";

/**
 * `dev start --sample`（t18）：开发脚本的环境里设 `NBDEV_SAMPLE=1`，应用在服务就绪之后自己准备样例数据，在日志里打
 * `[dev] open-path <同源路径>` 或 `[dev] sample-failed <原因>`。合同见 docs/cli.md 的“开发服务、worktree、查找与截图”。
 *
 * 结果不与 `READY` 绑在一起：应用在就绪之后才在后台准备样例，结果可能比 `READY` 晚到，所以 `READY` 之后接着读日志。
 * 只报“本代”的结果（最后一行 `[dev] backend-ready` 之后的，见 `createSampleTracker`）。
 */

/** 只由 nbdev 设置：带 `--sample` 时为 `1`，不带时从环境里去掉，登记里记的 `sample` 就是应用实际收到的。 */
export const SAMPLE_ENV = "NBDEV_SAMPLE";
export const DEFAULT_SAMPLE_TIMEOUT_MS = 60_000;
/** 复用时只读日志末尾这么多：开发日志可能很大，本代的结果在最后一行 `backend-ready` 之后，不会离末尾太远。 */
export const SAMPLE_TAIL_BYTES = 4 * 1024 * 1024;
export const SAMPLE_SILENT_REASON = "应用没有报告样例结果（不支持 NBDEV_SAMPLE，或还没准备好）";
export const SAMPLE_NOT_SAME_ORIGIN = "open-path 不是同源路径";
const TAIL_INTERVAL_MS = 200;

export type SampleReport = {ok: true; url: string} | {ok: false; reason: string};

export type FollowSampleOptions = {
    /** `READY` 的地址：`open-path` 按它拼，且必须与它同源。 */
    readyUrl: string;
    /** true 时只读日志末尾 `SAMPLE_TAIL_BYTES`（复用别人的服务）；false 从头读（自己刚起的服务，日志从空开始）。 */
    tail: boolean;
    /** 开始读之后这么久，本代还没有结果就报 `SAMPLE_SILENT_REASON`；只对开始时的那一代计时。 */
    timeoutMs: number;
    /** true 时报完一次接着读，之后每一代（后端重启）有结果再报；false 时报一次就返回。 */
    follow: boolean;
    shouldStop: () => boolean | Promise<boolean>;
    emit: (report: SampleReport) => void;
};

function toReport(outcome: SampleOutcome, readyUrl: string): SampleReport {
    if (outcome.kind === "failed") return {ok: false, reason: outcome.reason};
    const url = sampleUrl(outcome.path, readyUrl);
    return url === null ? {ok: false, reason: `${SAMPLE_NOT_SAME_ORIGIN}：${outcome.path}`} : {ok: true, url};
}

/** 读日志、按代报样例结果，直到 `shouldStop`（或 `follow: false` 时报过一次）。每一代至多报一次，超时也算报过。 */
export async function followSample(logPath: string, options: FollowSampleOptions): Promise<void> {
    const handle = await open(logPath, "r");
    try {
        const size = (await handle.stat()).size;
        let offset = options.tail ? Math.max(0, size - SAMPLE_TAIL_BYTES) : 0;
        const buffer = Buffer.alloc(64 * 1024);
        // 从中间读起时第一行多半只有后半截，丢掉；正好落在行首（前一个字节是行尾）时不丢。
        let skipFirst = false;
        if (offset > 0) {
            const {bytesRead} = await handle.read(buffer, 0, 1, offset - 1);
            skipFirst = bytesRead === 1 && buffer[0] !== 0x0a && buffer[0] !== 0x0d;
        }
        const splitter = new LineSplitter();
        const decoder = new TextDecoder();
        const tracker = createSampleTracker();
        const readNew = async (): Promise<void> => {
            for (;;) {
                const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
                if (bytesRead === 0) return;
                offset += bytesRead;
                for (const line of splitter.push(decoder.decode(buffer.subarray(0, bytesRead), {stream: true}))) {
                    if (skipFirst) {
                        skipFirst = false;
                        continue;
                    }
                    tracker.feed(stripAnsi(line));
                }
            }
        };
        const deadline = Date.now() + options.timeoutMs;
        // 已经报过的那一代；null 是一次都还没报。
        let settled: number | null = null;
        while (!await options.shouldStop()) {
            await readNew();
            const {generation, outcome} = tracker.current();
            if (outcome !== null && generation !== settled) {
                settled = generation;
                options.emit(toReport(outcome, options.readyUrl));
                if (!options.follow) return;
            } else if (settled === null && Date.now() >= deadline) {
                // 超时之后这一代的结果再到也不补报：调用方已经按失败处理了。
                settled = generation;
                options.emit({ok: false, reason: SAMPLE_SILENT_REASON});
                if (!options.follow) return;
            }
            await sleep(TAIL_INTERVAL_MS);
        }
    } finally {
        await handle.close();
    }
}
