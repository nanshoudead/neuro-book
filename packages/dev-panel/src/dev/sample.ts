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
    /**
     * true（复用别人的服务）：先重放历史，只读开始时日志末尾的 `SAMPLE_TAIL_BYTES`，读到开始时的长度为止，按其中最后一代立刻
     * 结算；之后读新写入的。false（自己刚起的服务，日志从空开始）：从头读，每一代都结算。
     */
    tail: boolean;
    /**
     * 本代还没有结果时等多久，从开始读算起。`follow: true` 时只对开始读时（重放完历史后）的那一代计时，那一代换了代就不再计时，
     * 之后各代有结果才报；`follow: false` 时是等这一行结果的总时限。
     */
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

/**
 * 读日志、按代报样例结果，直到 `shouldStop`（或 `follow: false` 时报过一次）。每一代至多报一次，超时也算报过。
 *
 * 一次读一块（`buffer` 的大小），块与块之间查 `shouldStop` 与截止，所以日志写得比读得快时也照样能停、能超时。新写入的内容逐行
 * 结算：一块里有几代的结果，每一代都报，不会被后一代的 `backend-ready` 冲掉。
 */
export async function followSample(logPath: string, options: FollowSampleOptions): Promise<void> {
    const deadline = Date.now() + options.timeoutMs;
    const handle = await open(logPath, "r");
    try {
        // 历史重放读到这里为止：之后写进来的不算历史，按新写入的逐行结算。
        const replayEnd = (await handle.stat()).size;
        let offset = options.tail ? Math.max(0, replayEnd - SAMPLE_TAIL_BYTES) : 0;
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
        // 已经报过的最后一代；null 是一次都还没报。代号只增不减，所以每一代至多报一次。
        let settled: number | null = null;
        let done = false;
        const settle = (): void => {
            const {generation, outcome} = tracker.current();
            if (outcome === null || generation === settled) return;
            settled = generation;
            options.emit(toReport(outcome, options.readyUrl));
            if (!options.follow) done = true;
        };
        /** 读一块（至多 `limit` 字节）喂给 `tracker`；`perLine` 时每行之后结算。返回读到的字节数，0 是到了文件末尾。 */
        const readChunk = async (limit: number, perLine: boolean): Promise<number> => {
            const {bytesRead} = await handle.read(buffer, 0, limit, offset);
            offset += bytesRead;
            for (const line of splitter.push(decoder.decode(buffer.subarray(0, bytesRead), {stream: true}))) {
                if (skipFirst) {
                    skipFirst = false;
                    continue;
                }
                tracker.feed(stripAnsi(line));
                if (perLine) {
                    settle();
                    if (done) break;
                }
            }
            return bytesRead;
        };

        // 历史重放：复用时只折叠到最后一代，读完立刻结算；自己起的服务逐行结算。
        while (offset < replayEnd) {
            if (await options.shouldStop()) return;
            // 读到 0 是日志被截短了：剩下的历史已经不在。
            if (await readChunk(Math.min(buffer.length, replayEnd - offset), !options.tail) === 0) break;
            if (done) return;
        }
        if (options.tail) {
            settle();
            if (done) return;
        }
        // 计时的那一代：重放完历史时的这一代。
        const timed = tracker.current().generation;

        while (!await options.shouldStop()) {
            const bytesRead = await readChunk(buffer.length, true);
            if (done) return;
            const {generation} = tracker.current();
            const counting = options.follow ? generation === timed && settled !== timed : true;
            if (counting && Date.now() >= deadline) {
                // 超时之后这一代的结果再到也不补报：调用方已经按失败处理了。换了代之后不再计时，不会封掉后来那一代。
                settled = generation;
                options.emit({ok: false, reason: SAMPLE_SILENT_REASON});
                if (!options.follow) return;
            }
            if (bytesRead === 0) await sleep(TAIL_INTERVAL_MS);
        }
    } finally {
        await handle.close();
    }
}
