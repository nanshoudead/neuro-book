/**
 * 开发服务的就绪识别（t14）：从日志里认出地址与“就绪”。合同见 docs/cli.md 的“dev”。
 * - 切行时 `\r` 与 `\n` 都算行尾（Nuxt、Vite 的进度输出会用 `\r` 原地改写），没写完的末行留到下一次再拼；
 * - 去掉 ANSI 的 CSI 与 OSC 转义（listhen 给地址上色、加超链接）；
 * - 内置两种就绪行：w00017 一系的 `[dev] page-ready <url>`（就绪以随后的 `[dev] backend-ready` 为准），
 *   listhen 的 `➜ Local: <url>`（master、nb-ui 与 Lab 的 Nuxt）；`--ready-pattern` 给了就只认它，第一个捕获组是地址。
 * 认出地址之后还要 HTTP 探测（见 `probeStatus` 的调用方）：listhen 那一行出现时 Nuxt 只是开始监听。
 * 样例结果行（`[dev] open-path`、`[dev] sample-failed`，t18）也在这里认，读日志与发事件见 `sample.ts`。
 */

const CSI = /\u001b\[[0-9;?<=>!]*[ -/]*[@-~]/gu;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const OTHER_ESCAPE = /\u001b[@-Z\\-_]/gu;

export function stripAnsi(text: string): string {
    return text.replace(OSC, "").replace(CSI, "").replace(OTHER_ESCAPE, "");
}

/** 按 `\r`、`\n` 切行；没写完的末行留着，下次 `push` 时接上。 */
export class LineSplitter {
    private rest = "";

    push(chunk: string): string[] {
        const parts = (this.rest + chunk).split(/\r\n|\r|\n/u);
        this.rest = parts.pop() ?? "";
        return parts;
    }
}

const NBOOK_PAGE = /^\[dev\] page-ready (\S+)/u;
const NBOOK_BACKEND = /^\[dev\] backend-ready\b/u;
const LISTHEN = /➜\s+Local:\s+(https?:\/\/\S+)/u;

export type ReadyProgress = {url: string | null; ready: boolean};

/**
 * 逐行喂入（已去 ANSI），返回目前认出的地址与是否“行级就绪”。w00017 式先给地址、等 `backend-ready` 才算就绪，
 * listhen 式与自定义的规则认出地址即就绪。
 */
export function createReadyMatcher(custom: RegExp | null): {feed(line: string): ReadyProgress; progress(): ReadyProgress} {
    let url: string | null = null;
    let ready = false;
    let waitingBackend = false;
    const progress = (): ReadyProgress => ({url, ready});
    return {
        progress,
        feed(line) {
            if (ready) return progress();
            if (custom) {
                const match = custom.exec(line);
                if (match) {
                    url = match[1] ?? match[0];
                    ready = true;
                }
                return progress();
            }
            const page = NBOOK_PAGE.exec(line);
            if (page && url === null) {
                url = page[1]!;
                waitingBackend = true;
                return progress();
            }
            if (waitingBackend) {
                if (NBOOK_BACKEND.test(line)) ready = true;
                return progress();
            }
            const listhen = LISTHEN.exec(line);
            if (listhen && url === null) {
                url = listhen[1]!;
                ready = true;
            }
            return progress();
        },
    };
}

const SAMPLE_OPEN_PATH = /^\[dev\] open-path (\S+)/u;
const SAMPLE_FAILED = /^\[dev\] sample-failed(?:\s+(.*))?$/u;

/** 应用报告的样例结果（`dev start --sample`，t18）：打开样例的同源路径，或失败原因。 */
export type SampleOutcome = {kind: "open-path"; path: string} | {kind: "failed"; reason: string};

/**
 * 按“代”记样例结果（t18）：每行 `[dev] backend-ready` 开始新的一代，本代只认第一行结果；
 * 读到的部分里还没有 `backend-ready` 时，从读起的位置算第 0 代（listhen 式等不打 `backend-ready` 的应用，以及只读日志末尾一段时）。
 */
export function createSampleTracker(): {feed(line: string): void; current(): {generation: number; outcome: SampleOutcome | null}} {
    let generation = 0;
    let outcome: SampleOutcome | null = null;
    return {
        current: () => ({generation, outcome}),
        feed(line) {
            if (NBOOK_BACKEND.test(line)) {
                generation += 1;
                outcome = null;
                return;
            }
            if (outcome !== null) return;
            const open = SAMPLE_OPEN_PATH.exec(line);
            if (open) {
                outcome = {kind: "open-path", path: open[1]!};
                return;
            }
            const failed = SAMPLE_FAILED.exec(line);
            if (failed) outcome = {kind: "failed", reason: failed[1]?.trim() || "（应用没有写原因）"};
        },
    };
}

/**
 * 把 `open-path` 拼成地址：先排除绝对 URL、`//` 开头与含反斜杠的，再核对拼出来的地址与就绪地址同源。
 * nbdev 不知道应用的路由，只做这一步。
 */
export function sampleUrl(path: string, readyUrl: string): string | null {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(path) || path.startsWith("//") || path.includes("\\")) return null;
    const url = new URL(path, readyUrl);
    return url.origin === new URL(readyUrl).origin ? url.href : null;
}

/** `--ready-pattern` 的正则：写错报用法错误；没有捕获组时整个匹配当地址。 */
export function compileReadyPattern(source: string): RegExp {
    return new RegExp(source, "u");
}

/** 探测的 HTTP 状态是否算就绪：2xx、3xx、4xx 算；5xx（nuxi 构建失败时对每个请求回 500）不算。 */
export function readyStatus(status: number): boolean {
    return status >= 200 && status < 500;
}
