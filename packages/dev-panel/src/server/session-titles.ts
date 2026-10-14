import {open, readdir, readFile, stat} from "node:fs/promises";
import {homedir} from "node:os";
import {isAbsolute, join, resolve, sep} from "node:path";
import {systemErrorCode} from "../core/errors.js";

/**
 * 会话页的会话标题（t15 阶段 4 第 3 批，决定点 19）：herdr 不给标题，从本机 Agent 自己的会话文件里读。
 * - Claude Code：`<CLAUDE_CONFIG_DIR 或 ~/.claude>/projects/<项目目录>/<会话 id>.jsonl` 里反复写 `custom-title`（`/rename`）、
 *   `agent-name`、`ai-title`（自动起的，随对话更新）；文件可能几百 MB，只读末尾一段，取各自最后一条，按这个先后选。
 *   一条记录可以比一段还大（读截图的 base64、大文件的工具结果），末尾一段里可能没有标题行：往前加读到 4MB，还没有就沿用上次读到的
 *   （文件只追加；变短了说明换了文件，不沿用），标题不会因为一条大记录来回跳；
 * - Codex：`<CODEX_HOME 或 ~/.codex>/session_index.jsonl` 每行 `{id, thread_name}`，按会话 id 取最后一条；
 * - omp：会话文件第一行是 `{"type":"title","title":…}`（原地改写的定长头）；herdr 给的会话值是文件路径，不是路径时按 id 找文件。
 * 会话值来自 herdr（本机任何进程都能给一格报会话值），按不可信输入处理：Claude 的 id 只认 uuid 的字符，omp 的路径要在 omp 的会话目录里；
 * 只读普通文件（FIFO 会让读挂住）。只读、按（路径、大小、修改时间）缓存，找不到的文件记 60 秒，不写审计；
 * 读不出（文件系统的错误）就是 null，原因进面板日志，同一个路径的同一种错误只记一次；其它异常照常抛出。
 * t17 起面板不在 GET 时逐个查：`PanelState` 的活动刷新一轮调一次 `titlesOf`，结果放进活动的快照（见 state.ts）。
 */
export type SessionTitleSource = "claude-custom" | "claude-agent-name" | "claude-ai-title" | "codex" | "omp";
export type SessionTitle = {text: string; source: SessionTitleSource};
export type SessionTitles = {
    titleOf(agent: string, sessionValue: string): Promise<SessionTitle | null>;
    /**
     * 一批完整会话键的标题，只放读到了标题的键（键原样是传入的完整键）。一批里 Claude 的 `projects/` 目录最多列一次；
     * 同一个键正在查时不再另查（单飞），冷查找最多 `BATCH_PARALLEL` 个同时进行。
     */
    titlesOf(keys: Iterable<string>): Promise<Record<string, SessionTitle>>;
};

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

/** 一批里同时进行的冷查找数：Claude 的定位要 stat 每个项目目录里的候选文件，不限的话一批几十个键会一起打满文件系统。 */
const BATCH_PARALLEL = 4;

/** Claude Code 的会话文件先读末尾这么多字节；没有标题行时每次往前读到四倍，最多 `CLAUDE_TAIL_MAX`。 */
const CLAUDE_TAIL_BYTES = 256 * 1024;
const CLAUDE_TAIL_MAX = 4 * 1024 * 1024;
const MAX_TITLE = 120;
/** 找不到会话文件的记多久：新会话的文件建在已有的项目子目录里，看目录的修改时间判断不出来，按时间过期最简单。 */
const MISS_TTL_MS = 60_000;

type Cached<T> = {size: number; mtimeMs: number; value: T};

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
    const codexCache: {entry: Cached<Map<string, string>> | null} = {entry: null};
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

    /** 正在查的键（`agent:会话值`）：并发的两次查找共用一个结果，不各扫一遍目录。 */
    const inflight = new Map<string, Promise<SessionTitle | null>>();
    function lookupOnce(agent: string, sessionValue: string, projectsOf: () => Promise<string[] | null>): Promise<SessionTitle | null> {
        const key = `${agent}:${sessionValue}`;
        const running = inflight.get(key);
        if (running) return running;
        const promise = lookup(agent, sessionValue, projectsOf).finally(() => inflight.delete(key));
        inflight.set(key, promise);
        return promise;
    }

    /** Codex 的索引是一份文件：同时有几个键在查时只读一次（索引变了的那一轮，几个键会同时发现缓存过期）。 */
    let codexReading: Promise<Map<string, string> | null> | null = null;
    function codexIndex(): Promise<Map<string, string> | null> {
        const path = join(codexRoot, "session_index.jsonl");
        codexReading ??= cached(path, codexCache, async () => {
            const names = new Map<string, string>();
            for (const line of (await readFile(path, "utf8")).split("\n")) {
                const record = parseLine(line);
                const name = cleanTitle(record?.thread_name);
                if (record && typeof record.id === "string" && name) names.set(record.id, name);
            }
            return names;
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
            const text = (await codexIndex())?.get(sessionValue);
            return text ? {text, source: "codex"} : null;
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
        titleOf(agent, sessionValue) {
            return lookupOnce(agent, sessionValue, claudeProjectsOnce());
        },
        async titlesOf(keys) {
            const pending = [...new Set(keys)].flatMap((key) => {
                const parts = sessionKeyParts(key);
                return parts ? [{key, ...parts}] : [];
            });
            const projectsOf = claudeProjectsOnce();
            const titles: Record<string, SessionTitle> = {};
            let next = 0;
            async function worker(): Promise<void> {
                while (next < pending.length) {
                    const {key, agent, value} = pending[next++]!;
                    const title = await lookupOnce(agent, value, projectsOf);
                    if (title) titles[key] = title;
                }
            }
            await Promise.all(Array.from({length: Math.min(BATCH_PARALLEL, pending.length)}, () => worker()));
            return titles;
        },
    };
}
