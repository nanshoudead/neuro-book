import {spawn, type ChildProcess} from "node:child_process";
import {NbdevError} from "./errors.js";
import {gitEnvironment, gitOutput, splitNul} from "./git.js";
import {isSafeRelativePath} from "./paths.js";
import type {ProjectRecords} from "./status.js";

/**
 * 面板的跨 checkout 搜索：文件名与内容。只读（`--no-optional-locks`），子进程可随时结束。
 * Git 的调用不走 `runGit`：排除规则要用 pathspec 魔法（`:(exclude,glob)`），而核心给 Git 设了 `GIT_LITERAL_PATHSPECS`；
 * 这里的 pathspec 全由本模块写死，用户输入只经 `-e` 进入，以 `-` 开头的 q 也不会被当成选项。
 */

export const SEARCH_LIMIT_PER_CHECKOUT = 200;
export const SEARCH_TIMEOUT_MS = 5_000;
const MIN_QUERY = 2;
const MAX_QUERY = 200;
/** 不进搜索的目录：证据与实验（w00005 的一个 worktree 里有十几万个文件）、依赖。 */
const EXCLUDES = [":(exclude,glob)**/evidences/**", ":(exclude,glob)**/experiments/**", ":(exclude,glob)**/node_modules/**"];

export type SearchHit = {checkout: string; kind: "name" | "content"; path: string; line: number | null; text: string | null};
export type SearchCheckout = {key: string; root: string; head: string};
export type CheckoutSearchDone = {checkout: string; count: number; truncated: boolean; elapsedMs: number; error: string | null};

export type RecordMatch =
    | {kind: "work"; workId: string; title: string | null}
    | {kind: "task"; workId: string; taskId: string; title: string | null}
    | {kind: "artifact"; workId: string; taskId: string | null; artifactId: string; title: string | null};

/** 记录里 Work、Task、产物的编号与标题的匹配（不分大小写，纯函数）：面板的搜索与 `nbdev find` 共用（t14 设计审查 S11）。 */
export function matchRecords(records: Pick<ProjectRecords, "works">, q: string): RecordMatch[] {
    const lower = q.toLowerCase();
    const has = (text: string | null | undefined) => typeof text === "string" && text.toLowerCase().includes(lower);
    const matches: RecordMatch[] = [];
    for (const work of records.works) {
        if (has(work.workId) || has(work.title)) matches.push({kind: "work", workId: work.workId, title: work.title});
        for (const task of work.tasks) {
            if (has(task.taskId) || has(task.title)) matches.push({kind: "task", workId: work.workId, taskId: task.taskId, title: task.title});
            for (const artifact of task.artifacts) if (has(artifact.artifactId) || has(artifact.title)) matches.push({kind: "artifact", workId: work.workId, taskId: task.taskId, artifactId: artifact.artifactId, title: artifact.title});
        }
        for (const artifact of work.artifacts) if (has(artifact.artifactId) || has(artifact.title)) matches.push({kind: "artifact", workId: work.workId, taskId: null, artifactId: artifact.artifactId, title: artifact.title});
    }
    return matches;
}

/** 面板搜索里能排序的一条记录类命中：`matchRecords` 的结果，加上面板另找的会话（`key` 与 `label`）。 */
export type RankableRecord = {kind: string; workId?: string; taskId?: string | null; artifactId?: string; key?: string; title?: string | null; label?: string | null};

const KIND_ORDER: Record<string, number> = {work: 0, task: 1, artifact: 2, session: 3};

/**
 * 一条记录类命中与搜索词的相关度，越小越相关（t15 阶段 4 第 5 批）：标题或编号与搜索词相同（编号也认 `w00022`、`t15` 这样的短号）、
 * 标题以它开头、编号以它开头、标题包含它、编号包含它。不分大小写。
 */
export function recordRelevance(match: RankableRecord, q: string): number {
    const lower = q.toLowerCase();
    const title = (match.title ?? match.label ?? "").toLowerCase();
    const id = (match.kind === "work" ? match.workId : match.kind === "task" ? match.taskId : match.kind === "artifact" ? match.artifactId : match.key ?? "")?.toLowerCase() ?? "";
    // 短号只给 Work 与 Task（`w00022`、`t15`）。产物编号可以长得像（`t15-review`、`w00022-report`），按种类判断，不按形状。
    const shortId = match.kind === "work" || match.kind === "task" ? /^(?:w\d{5}|t\d{2,3})-/u.exec(id)?.[0].slice(0, -1) ?? null : null;
    if (title === lower || id === lower || shortId === lower) return 0;
    if (title.startsWith(lower)) return 1;
    if (id.startsWith(lower)) return 2;
    if (title.includes(lower)) return 3;
    return 4;
}

/** 面板搜索最多送这么多条记录类命中。 */
export const RECORD_MATCH_LIMIT = 50;

/** 先按相关度排、再截前 `limit` 条：命中多时截掉的是最不相关的（t15 阶段 4 第 5 批）。 */
export function topRecordMatches<T extends RankableRecord>(matches: readonly T[], q: string, limit = RECORD_MATCH_LIMIT): T[] {
    return rankRecordMatches(matches, q).slice(0, limit);
}

/** 按相关度排记录类命中，同分时 Work、Task、产物、会话依次在前，再保持原来的顺序（稳定排序）。返回新数组。 */
export function rankRecordMatches<T extends RankableRecord>(matches: readonly T[], q: string): T[] {
    return matches.map((match, index) => ({match, index, score: recordRelevance(match, q)}))
        .sort((left, right) => left.score - right.score || (KIND_ORDER[left.match.kind] ?? 9) - (KIND_ORDER[right.match.kind] ?? 9) || left.index - right.index)
        .map((entry) => entry.match);
}

/** 去掉首尾空白后：非空、不含控制字符、长度 2 到 200；不合格报 `usage`。 */
export function validateSearchQuery(raw: string): string {
    const q = raw.trim();
    if (q.length < MIN_QUERY || q.length > MAX_QUERY) throw new NbdevError("usage", `搜索词要 ${MIN_QUERY} 到 ${MAX_QUERY} 个字`, {details: {length: q.length}});
    if (/[\u0000-\u001f\u007f]/u.test(q)) throw new NbdevError("usage", "搜索词不能含换行或控制字符");
    return q;
}

/** 文件名搜索用的 `ls-files` 结果，按 checkout 的根与 HEAD 缓存（未跟踪的新文件要等 HEAD 变或缓存被清掉才出现）。 */
export type NameIndexCache = Map<string, Promise<string[]>>;

export function createNameIndexCache(): NameIndexCache {
    return new Map();
}

function excludedSegment(path: string): boolean {
    return path.split("/").some((segment) => segment === "evidences" || segment === "experiments" || segment === "node_modules");
}

function listNames(cache: NameIndexCache, checkout: SearchCheckout): Promise<string[]> {
    const key = `${checkout.root}\0${checkout.head}`;
    let cached = cache.get(key);
    if (!cached) {
        cached = gitOutput(checkout.root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {readOnly: true})
            .then((output) => [...new Set(splitNul(output))].filter((path) => !excludedSegment(path)));
        // 失败的不留在缓存里，下次重试。
        cached.catch(() => cache.delete(key));
        for (const old of cache.keys()) if (old.startsWith(`${checkout.root}\0`) && old !== key) cache.delete(old);
        cache.set(key, cached);
    }
    return cached;
}

/** 内容搜索：读满 `limit` 行、超时或被打断就结束子进程。 */
function grepCheckout(checkout: SearchCheckout, q: string, limit: number, signal: AbortSignal, deadline: number, onHit: (hit: SearchHit) => void): Promise<{count: number; truncated: boolean; error: string | null}> {
    return new Promise((resolvePromise) => {
        const args = ["--no-optional-locks", "-C", checkout.root, "grep", "-I", "-n", "-i", "-F", "-z", "--untracked", "--exclude-standard", "-e", q, "--", ".", ...EXCLUDES];
        const child: ChildProcess = spawn("git", args, {env: gitEnvironment({literalPathspecs: false}), stdio: ["ignore", "pipe", "pipe"]});
        let count = 0;
        let truncated = false;
        let buffer = "";
        let stderr = "";
        let settled = false;
        const stop = () => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        };
        const finish = (error: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            stop();
            resolvePromise({count, truncated, error});
        };
        const onAbort = () => {
            truncated = true;
            finish(null);
        };
        const timer = setTimeout(() => {
            truncated = true;
            finish(null);
        }, Math.max(0, deadline - Date.now()));
        signal.addEventListener("abort", onAbort, {once: true});
        child.stdout!.setEncoding("utf8");
        child.stdout!.on("data", (chunk: string) => {
            if (settled) return;
            buffer += chunk;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const [path = "", lineNumber = "", ...rest] = line.split("\0");
                if (isSafeRelativePath(path)) {
                    onHit({checkout: checkout.key, kind: "content", path, line: Number(lineNumber) || null, text: rest.join("\0").slice(0, 400)});
                    count += 1;
                    if (count >= limit) {
                        truncated = true;
                        finish(null);
                        return;
                    }
                }
                newline = buffer.indexOf("\n");
            }
        });
        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) => finish(`无法启动 git：${error.message}`));
        // git grep 没有匹配时以 1 退出，不算失败。
        child.on("close", (code) => finish(code === 0 || code === 1 || code === null ? null : `git grep 以 ${code} 退出：${stderr.trim().slice(0, 300)}`));
    });
}

/**
 * 在几个 checkout 上并发搜索，逐条回调结果；每个 checkout 做完回调一次（先做完的先送，慢的后送）。
 * 文件名的匹配先于内容；每个 checkout 文件名与内容各最多 `limit` 条。
 */
/** `namesOnly`：只找文件名，不跑内容搜索（`nbdev find --name`），数与截断也只算文件名。 */
export async function searchCheckouts(options: {q: string; checkouts: readonly SearchCheckout[]; names: NameIndexCache; signal: AbortSignal; limit?: number; timeoutMs?: number; namesOnly?: boolean; onHit: (hit: SearchHit) => void; onCheckoutDone: (done: CheckoutSearchDone) => void}): Promise<void> {
    const q = validateSearchQuery(options.q);
    const limit = options.limit ?? SEARCH_LIMIT_PER_CHECKOUT;
    const started = Date.now();
    const deadline = started + (options.timeoutMs ?? SEARCH_TIMEOUT_MS);
    const lower = q.toLowerCase();
    await Promise.all(options.checkouts.map(async (checkout) => {
        let error: string | null = null;
        let nameCount = 0;
        let nameTruncated = false;
        try {
            const names = await listNames(options.names, checkout);
            for (const path of names) {
                if (options.signal.aborted) break;
                if (!path.toLowerCase().includes(lower) || !isSafeRelativePath(path)) continue;
                if (nameCount >= limit) {
                    nameTruncated = true;
                    break;
                }
                options.onHit({checkout: checkout.key, kind: "name", path, line: null, text: null});
                nameCount += 1;
            }
        } catch (caught) {
            if (!(caught instanceof NbdevError)) throw caught;
            error = caught.message;
        }
        const content = options.namesOnly ? {count: 0, truncated: false, error: null}
            : options.signal.aborted ? {count: 0, truncated: true, error: null}
            : await grepCheckout(checkout, q, limit, options.signal, deadline, options.onHit);
        options.onCheckoutDone({checkout: checkout.key, count: nameCount + content.count, truncated: nameTruncated || content.truncated, elapsedMs: Date.now() - started, error: error ?? content.error});
    }));
}
