import {open, readdir, stat} from "node:fs/promises";
import {homedir} from "node:os";
import {isAbsolute, join, resolve, sep} from "node:path";
import {systemErrorCode} from "../core/errors.js";

/**
 * 会话页的会话标题（t15 阶段 4 第 3 批，决定点 19）：herdr 不给标题，从本机 Agent 自己的会话文件里读。
 * - Claude Code：`<CLAUDE_CONFIG_DIR 或 ~/.claude>/projects/<项目目录>/<会话 id>.jsonl` 里反复写 `custom-title`（`/rename`）、
 *   `agent-name`、`ai-title`（自动起的，随对话更新）；文件可能几百 MB，只读末尾一段，取各自最后一条，按这个先后选。
 *   一条记录可以比一段还大（读截图的 base64、大文件的工具结果），末尾一段里可能没有标题行：往前加读到 4MB，还没有就沿用上次读到的
 *   （文件只追加；变短了说明换了文件，不沿用），标题不会因为一条大记录来回跳；
 * - Codex：`<CODEX_HOME 或 ~/.codex>/session_index.jsonl` 每行 `{id, thread_name}`，按会话 id 取最后一条；索引只追加、可以很大，
 *   只读末尾 4MB（`CODEX_INDEX_TAIL`），更早的记录读不到，按没有标题处理（记一条诊断）；
 * - omp：会话文件第一行是 `{"type":"title","title":…}`（原地改写的定长头）；herdr 给的会话值是文件路径，不是路径时按 id 找文件。
 * 会话值来自 herdr（本机任何进程都能给一格报会话值），按不可信输入处理：Claude 的 id 只认 uuid 的字符，omp 的路径要在 omp 的会话目录里；
 * 只读普通文件（FIFO 会让读挂住）。只读、按（路径、大小、修改时间）缓存，找不到的文件记 60 秒，不写审计；
 * 读不出（文件系统的错误）就是 null，原因进面板日志，同一个路径的同一种错误只记一次；其它异常照常抛出。
 * t17 起面板不在 GET 时逐个查：`PanelState` 在活动刷新之外另起一个后台任务调 `titlesOf`（带整轮预算），结果并进活动的快照（见 state.ts）。
 * 冷查找的配额（`LOOKUP_PARALLEL`）是整个 resolver 共用的，不按批算：预算到点后还在做的查找照样占着配额，直到它 settle，
 * 下一批的新键只能等配额空出来；否则慢盘上每换一批键就多一批读盘叠上去。
 */
export type SessionTitleSource = "claude-custom" | "claude-agent-name" | "claude-ai-title" | "codex" | "omp";
export type SessionTitle = {text: string; source: SessionTitleSource};
export type SessionTitles = {
    titleOf(agent: string, sessionValue: string): Promise<SessionTitle | null>;
    /**
     * 一批完整会话键的标题：`titles` 只放读到了标题的键（键原样是传入的完整键），`pending` 是到预算用完时还没查完的键。
     * 一批里 Claude 的 `projects/` 目录最多列一次；同一个键正在查时不再另查（单飞，不占配额）；查找要先拿到共用的配额。
     * 给了 `budgetMs` 时到点就回：这一批还在排队的键放弃（不会在配额空出来之后再替这一批开始），已经开始的照常做完，
     * 结果留在缓存与单飞里，下一批再问同一个键时直接用上。
     */
    titlesOf(keys: Iterable<string>, options?: {budgetMs?: number}): Promise<TitleBatch>;
    /**
     * 停止：之后不再开始新的查找，排队等配额的放弃（`titleOf` 回 null，`titlesOf` 立刻回，没查完的进 `pending`），带预算的批次撤掉计时器。
     * 文件系统调用做到一半取消不了：返回的 Promise 在已经开始的查找都 settle 之后完成，调用方据此确认不再有读盘。
     */
    close(): Promise<void>;
};
export type TitleBatch = {titles: Record<string, SessionTitle>; pending: string[]};

/** 会读标题的 Agent；`external:` 这类自报标签的会话没有会话文件。 */
const TITLE_AGENTS = ["claude", "codex", "omp"] as const;
type TitleAgent = (typeof TITLE_AGENTS)[number];

/**
 * 完整会话键拆成 Agent 与会话值（t17）：只按第一个冒号切，omp 的会话值可能是含冒号的绝对路径；
 * Agent 只认 `claude`、`codex`、`omp`，会话值不能为空，其余（`external:`、不认识的 Agent）是 null。
 */
export function sessionKeyParts(key: string): {agent: TitleAgent; value: string} | null {
    const colon = key.indexOf(":");
    if (colon <= 0) return null;
    const agent = key.slice(0, colon);
    const value = key.slice(colon + 1);
    if (value === "" || !(TITLE_AGENTS as readonly string[]).includes(agent)) return null;
    return {agent: agent as TitleAgent, value};
}

/**
 * 整个 resolver 同时进行的查找数（跨批共用）：Claude 的定位要 stat 每个项目目录里的候选文件，不限的话几十个键会一起打满文件系统。
 * 一个查找从开始到 settle 一直占着一份配额，与发起它的批次是否已经到点无关。
 */
const LOOKUP_PARALLEL = 4;

/** Claude Code 的会话文件先读末尾这么多字节；没有标题行时每次往前读到四倍，最多 `CLAUDE_TAIL_MAX`。 */
const CLAUDE_TAIL_BYTES = 256 * 1024;
const CLAUDE_TAIL_MAX = 4 * 1024 * 1024;
/**
 * Codex 的索引只读末尾这么多字节：索引每次改名追加一行、从不压缩，整份解析的 `split` 与逐行 `JSON.parse` 跑在面板的主事件循环上，
 * 几百 MB 时会让 HTTP 与活动的发布停上几秒（t17 服务端实现审查第 3 条）。
 */
const CODEX_INDEX_TAIL = 4 * 1024 * 1024;
const MAX_TITLE = 120;
/** 找不到会话文件的记多久：新会话的文件建在已有的项目子目录里，看目录的修改时间判断不出来，按时间过期最简单。 */
const MISS_TTL_MS = 60_000;

type Cached<T> = {size: number; mtimeMs: number; value: T};
/** Codex 索引末尾一段里各会话的最后一个名字；`complete` 为 false 时文件比 `CODEX_INDEX_TAIL` 大，更早的记录没读。 */
type CodexIndex = {names: Map<string, string>; complete: boolean; size: number};

function cleanTitle(text: unknown): string | null {
    if (typeof text !== "string") return null;
    // 标题来自别的程序写的文件：去掉控制字符、折叠空白，限长。
    const cleaned = text.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
    return cleaned === "" ? null : cleaned.slice(0, MAX_TITLE);
}

function parseLine(line: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(line) as unknown;
        return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch (error) {
        // 末尾一段的第一行多半是被截断的半行，读不出就跳过。
        if (!(error instanceof SyntaxError)) throw error;
        return null;
    }
}

/** 末尾一段里各类标题的最后一条，按 custom、agent-name、ai-title 的先后选。 */
export function claudeTitleFromTail(text: string): SessionTitle | null {
    const found: Partial<Record<"custom-title" | "agent-name" | "ai-title", string>> = {};
    for (const line of text.split("\n").reverse()) {
        if (!line.includes("title") && !line.includes("agent-name")) continue;
        const record = parseLine(line);
        if (!record) continue;
        if (record.type === "custom-title" && found["custom-title"] === undefined) found["custom-title"] = cleanTitle(record.customTitle) ?? undefined;
        if (record.type === "agent-name" && found["agent-name"] === undefined) found["agent-name"] = cleanTitle(record.agentName) ?? undefined;
        if (record.type === "ai-title" && found["ai-title"] === undefined) found["ai-title"] = cleanTitle(record.aiTitle) ?? undefined;
        if (found["custom-title"] !== undefined) break;
    }
    if (found["custom-title"]) return {text: found["custom-title"], source: "claude-custom"};
    if (found["agent-name"]) return {text: found["agent-name"], source: "claude-agent-name"};
    if (found["ai-title"]) return {text: found["ai-title"], source: "claude-ai-title"};
    return null;
}

export function createSessionTitles(env: NodeJS.ProcessEnv, log: (line: string) => void = () => undefined, now: () => number = Date.now): SessionTitles {
    const home = env.HOME ?? homedir();
    const claudeRoot = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
    const codexRoot = env.CODEX_HOME ?? join(home, ".codex");
    const ompRoot = resolve(home, ".omp", "agent", "sessions");
    const cache = new Map<string, Cached<SessionTitle | null>>();
    const codexCache: {entry: Cached<CodexIndex> | null} = {entry: null};
    const located = new Map<string, string>();
    /** 找不到文件的会话：键同 `located`，值是过期的时刻。 */
    const missed = new Map<string, number>();
    const reported = new Set<string>();

    function report(path: string, reason: string, detail: string): void {
        const key = `${path}\0${reason}`;
        if (reported.has(key)) return;
        reported.add(key);
        log(`读不出会话标题 ${path}：${detail}`);
    }
    /** 只把文件系统的错误当成“读不出”，其它异常（编程错误）照常抛出。 */
    function reportFsError(path: string, error: unknown): void {
        const code = systemErrorCode(error);
        if (code === undefined) throw error;
        report(path, code, error instanceof Error ? error.message : code);
    }

    /** 按修改时间与大小缓存一个文件读出的结果；文件不在、不是普通文件时为 null。`read` 拿到上一次缓存的结果。 */
    async function cached<T>(path: string, store: Map<string, Cached<T>> | {entry: Cached<T> | null}, read: (size: number, previous: Cached<T> | null) => Promise<T>): Promise<T | null> {
        let info;
        try {
            info = await stat(path);
        } catch (error) {
            const code = systemErrorCode(error);
            if (code === "ENOENT" || code === "ENOTDIR") return null;
            reportFsError(path, error);
            return null;
        }
        if (!info.isFile()) {
            report(path, "not_regular", "不是普通文件");
            return null;
        }
        const previous = (store instanceof Map ? store.get(path) : store.entry) ?? null;
        if (previous && previous.size === info.size && previous.mtimeMs === info.mtimeMs) return previous.value;
        let value: T;
        try {
            value = await read(info.size, previous);
        } catch (error) {
            reportFsError(path, error);
            return null;
        }
        const entry = {size: info.size, mtimeMs: info.mtimeMs, value};
        if (store instanceof Map) store.set(path, entry);
        else store.entry = entry;
        return value;
    }

    async function readHead(path: string, bytes: number): Promise<string> {
        const handle = await open(path, "r");
        try {
            const buffer = Buffer.alloc(bytes);
            const {bytesRead} = await handle.read(buffer, 0, bytes, 0);
            return buffer.subarray(0, bytesRead).toString("utf8");
        } finally {
            await handle.close();
        }
    }

    async function readTail(path: string, size: number, bytes: number): Promise<string> {
        const handle = await open(path, "r");
        try {
            const length = Math.min(size, bytes);
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, size - length);
            return buffer.toString("utf8");
        } finally {
            await handle.close();
        }
    }

    /** 记住找不到的会话（`MISS_TTL_MS`），过期前不再扫目录。 */
    const isMissed = (key: string) => (missed.get(key) ?? 0) > now();
    const markMissed = (key: string) => void missed.set(key, now() + MISS_TTL_MS);

    /** `projects/` 下的项目目录名；读不出为 null（不是 ENOENT 的原因进日志）。 */
    async function listClaudeProjects(): Promise<string[] | null> {
        try {
            return (await readdir(join(claudeRoot, "projects"), {withFileTypes: true})).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT") reportFsError(join(claudeRoot, "projects"), error);
            return null;
        }
    }
    /** 一次查找（`titleOf` 的一次调用，或 `titlesOf` 的一批）里共用的目录列表：要用时才列，最多列一次。 */
    function claudeProjectsOnce(): () => Promise<string[] | null> {
        let listing: Promise<string[] | null> | null = null;
        return () => (listing ??= listClaudeProjects());
    }

    /** `projects/` 下每个项目目录里找 `<id>.jsonl`；找到一次就记住路径。 */
    async function claudeFile(sessionId: string, projectsOf: () => Promise<string[] | null>): Promise<string | null> {
        if (!/^[0-9a-f-]{8,64}$/iu.test(sessionId)) return null;
        const key = `claude:${sessionId}`;
        const known = located.get(key);
        if (known) return known;
        if (isMissed(key)) return null;
        const projects = await projectsOf();
        if (projects === null) {
            markMissed(key);
            return null;
        }
        for (const project of projects) {
            const path = join(claudeRoot, "projects", project, `${sessionId}.jsonl`);
            try {
                if ((await stat(path)).isFile()) {
                    located.set(key, path);
                    return path;
                }
            } catch (error) {
                if (systemErrorCode(error) !== "ENOENT") reportFsError(path, error);
            }
        }
        markMissed(key);
        return null;
    }

    async function ompFile(value: string): Promise<string | null> {
        if (isAbsolute(value)) {
            // 只认 omp 会话目录里的文件：值可以是任何进程报的。
            const path = resolve(value);
            return path.startsWith(`${ompRoot}${sep}`) && path.endsWith(".jsonl") ? path : null;
        }
        if (!/^[0-9a-z-]{8,64}$/iu.test(value)) return null;
        const key = `omp:${value}`;
        const known = located.get(key);
        if (known) return known;
        if (isMissed(key)) return null;
        let dirs: string[];
        try {
            dirs = (await readdir(ompRoot, {withFileTypes: true})).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT") reportFsError(ompRoot, error);
            markMissed(key);
            return null;
        }
        for (const dir of dirs) {
            let names: string[];
            try {
                names = await readdir(join(ompRoot, dir));
            } catch (error) {
                reportFsError(join(ompRoot, dir), error);
                continue;
            }
            const file = names.find((name) => name.endsWith(`_${value}.jsonl`));
            if (file) {
                located.set(key, join(ompRoot, dir, file));
                return join(ompRoot, dir, file);
            }
        }
        markMissed(key);
        return null;
    }

    /** 末尾一段没有标题行时往前加读；读到 4MB 或整份文件还没有，就沿用上次读到的（文件变短了不沿用）。 */
    async function claudeTitle(path: string, size: number, previous: Cached<SessionTitle | null> | null): Promise<SessionTitle | null> {
        for (let bytes = CLAUDE_TAIL_BYTES; ; bytes *= 4) {
            const title = claudeTitleFromTail(await readTail(path, size, bytes));
            if (title) return title;
            if (bytes >= size || bytes >= CLAUDE_TAIL_MAX) return previous && size >= previous.size ? previous.value : null;
        }
    }

    /** 正在查的键（`agent:会话值`）：并发的两次查找共用一个结果，不各扫一遍目录。只放已经拿到配额、开始了的查找。 */
    const inflight = new Map<string, Promise<SessionTitle | null>>();
    /** `close()` 之后为 true：不再发配额。 */
    let closed = false;
    /** 占着配额的查找数，最多 `LOOKUP_PARALLEL`。 */
    let slotsInUse = 0;
    /** 等配额的调用，按先来后到；`grant(false)` 是放弃（批次到点或已停止），会把自己从这里删掉。 */
    const waiting = new Set<(granted: boolean) => void>();
    /** 还没返回的批次：`close()` 用它们让每一批立刻回。 */
    const batches = new Set<AbortController>();

    /** 拿一份配额；`signal` 中止（批次到点）或已经停止时回 false，排着队的也一样，不会在之后再拿到。 */
    function acquireSlot(signal?: AbortSignal): Promise<boolean> {
        if (closed || signal?.aborted) return Promise.resolve(false);
        if (slotsInUse < LOOKUP_PARALLEL) {
            slotsInUse += 1;
            return Promise.resolve(true);
        }
        return new Promise((resolveSlot) => {
            const grant = (granted: boolean) => {
                waiting.delete(grant);
                signal?.removeEventListener("abort", abandon);
                resolveSlot(granted);
            };
            const abandon = () => grant(false);
            waiting.add(grant);
            signal?.addEventListener("abort", abandon, {once: true});
        });
    }
    /** 查找 settle 时还回配额：有人在等就直接转给排在最前的（计数不变）。 */
    function releaseSlot(): void {
        const next = closed ? undefined : waiting.values().next().value;
        if (next) next(true);
        else slotsInUse -= 1;
    }

    /**
     * 查一个键：同一个键已经在查就等那一次（不占配额）；否则先拿配额，拿不到（批次到点、已停止）回 undefined，表示没有开始。
     * 配额在查找 settle 时才还，等这个结果的批次到点了也不提前还。
     */
    async function lookupShared(agent: string, sessionValue: string, projectsOf: () => Promise<string[] | null>, signal?: AbortSignal): Promise<SessionTitle | null | undefined> {
        const key = `${agent}:${sessionValue}`;
        const running = inflight.get(key);
        if (running) return running;
        if (!await acquireSlot(signal)) return undefined;
        // 拿到配额与这里之间隔着一个微任务：这期间可能已经停止（`close()` 只等它看得见的 `inflight`）、批次到点，或者别人开始查了同一个键。
        const started = inflight.get(key);
        if (closed || signal?.aborted || started) {
            releaseSlot();
            return started;
        }
        const promise = lookup(agent, sessionValue, projectsOf).finally(() => {
            inflight.delete(key);
            releaseSlot();
        });
        inflight.set(key, promise);
        return promise;
    }

    /**
     * Codex 的索引是一份文件：同时有几个键在查时只读一次（索引变了的那一轮，几个键会同时发现缓存过期）。
     * 只读末尾 `CODEX_INDEX_TAIL`，从后往前取各 id 第一次出现的名字，就是它最后一次改的名。
     */
    const codexIndexPath = join(codexRoot, "session_index.jsonl");
    let codexReading: Promise<CodexIndex | null> | null = null;
    function codexIndex(): Promise<CodexIndex | null> {
        codexReading ??= cached(codexIndexPath, codexCache, async (size) => {
            const lines = (await readTail(codexIndexPath, size, CODEX_INDEX_TAIL)).split("\n");
            const complete = size <= CODEX_INDEX_TAIL;
            // 没从文件头读起时，第一行是被截断的半行。
            if (!complete) lines.shift();
            const names = new Map<string, string>();
            for (let index = lines.length - 1; index >= 0; index--) {
                const record = parseLine(lines[index]!);
                if (!record || typeof record.id !== "string" || names.has(record.id)) continue;
                const name = cleanTitle(record.thread_name);
                if (name) names.set(record.id, name);
            }
            return {names, complete, size};
        }).finally(() => {
            codexReading = null;
        });
        return codexReading;
    }

    async function lookup(agent: string, sessionValue: string, projectsOf: () => Promise<string[] | null>): Promise<SessionTitle | null> {
        if (agent === "claude") {
            const path = await claudeFile(sessionValue, projectsOf);
            return path ? cached(path, cache, (size, previous) => claudeTitle(path, size, previous)) : null;
        }
        if (agent === "codex") {
            const index = await codexIndex();
            const text = index?.names.get(sessionValue);
            if (text) return {text, source: "codex"};
            // 同一份索引只记一次：之后读不到的会话都是同一个原因。
            if (index && !index.complete) report(codexIndexPath, "index_tail", `索引有 ${index.size} 字节，只读末尾 ${CODEX_INDEX_TAIL} 字节；更早的记录读不到（例如会话 ${sessionValue}），按没有标题处理`);
            return null;
        }
        if (agent === "omp") {
            const path = await ompFile(sessionValue);
            return path ? cached(path, cache, async () => {
                const first = parseLine((await readHead(path, 4096)).split("\n")[0] ?? "");
                const text = first?.type === "title" ? cleanTitle(first.title) : null;
                return text ? {text, source: "omp" as const} : null;
            }) : null;
        }
        return null;
    }

    return {
        async titleOf(agent, sessionValue) {
            return (await lookupShared(agent, sessionValue, claudeProjectsOnce())) ?? null;
        },
        async titlesOf(keys, options = {}) {
            const queue = [...new Set(keys)].flatMap((key) => {
                const parts = sessionKeyParts(key);
                return parts ? [{key, ...parts}] : [];
            });
            const projectsOf = claudeProjectsOnce();
            const titles: Record<string, SessionTitle> = {};
            const done = new Set<string>();
            // 中止 = 这一批到点（预算用完）或 resolver 停止：不再开始新的查找，排队等配额的放弃。
            const batch = new AbortController();
            batches.add(batch);
            if (closed) batch.abort();
            let next = 0;
            async function worker(): Promise<void> {
                while (!batch.signal.aborted && next < queue.length) {
                    const {key, agent, value} = queue[next++]!;
                    const title = await lookupShared(agent, value, projectsOf, batch.signal);
                    // 没有开始（到点或停止）：这个键留在 pending 里。
                    if (title === undefined) return;
                    if (title) titles[key] = title;
                    done.add(key);
                }
            }
            const all = Promise.all(Array.from({length: Math.min(LOOKUP_PARALLEL, queue.length)}, () => worker()));
            const stopped = new Promise<void>((resolveStopped) => batch.signal.addEventListener("abort", () => resolveStopped(), {once: true}));
            const timer = options.budgetMs === undefined ? undefined : setTimeout(() => batch.abort(), options.budgetMs);
            let cutShort: boolean;
            try {
                await Promise.race([all, stopped]);
                cutShort = batch.signal.aborted;
            } finally {
                clearTimeout(timer);
                batches.delete(batch);
                // 正常查完时也中止一次：让 `stopped` 完成，不留一个永远挂着的监听。
                batch.abort();
            }
            // 到点之后还在做的查找没人等了：它们失败（只会是编程错误，文件系统的错误已在里面记过）时记一条，不成为没人处理的 reject。
            if (cutShort) void all.catch((error: unknown) => log(`预算用完之后，读会话标题的查找失败：${error instanceof Error ? error.message : String(error)}`));
            // 到点时的快照：之后才查完的键不改这一批的结果。
            return {titles: {...titles}, pending: queue.filter((entry) => !done.has(entry.key)).map((entry) => entry.key)};
        },
        async close() {
            closed = true;
            for (const grant of [...waiting]) grant(false);
            for (const batch of batches) batch.abort();
            await Promise.allSettled([...inflight.values()]);
        },
    };
}
