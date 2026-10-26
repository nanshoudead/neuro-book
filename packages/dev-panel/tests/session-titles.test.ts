import {afterEach, describe, expect, test} from "bun:test";
import {appendFile, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {claudeTitleFromTail, createSessionTitles} from "../src/server/session-titles.js";
import {holdFileLeases} from "./file-lease.js";
import {cleanupFixtures, createFixture} from "./git-fixture.js";

/** 会话页的会话标题（t15 阶段 4 第 3 批，决定点 19）：从本机 Agent 的会话文件里读，只读、带缓存。 */
afterEach(async () => {
    await cleanupFixtures();
});

const CLAUDE_ID = "c38df555-3a36-49c9-bf4f-4027b5da6d32";
const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;

describe("Claude Code 的标题", () => {
    test("取末尾一段里各类标题的最后一条：custom-title 先于 agent-name，再先于 ai-title；截断的半行跳过；控制字符去掉", () => {
        const tail = `"type":"user","message":"半行\n${line({type: "ai-title", aiTitle: "旧的自动标题"})}${line({type: "user", message: "x"})}${line({type: "ai-title", aiTitle: "新的\u001b[31m自动标题"})}`;
        expect(claudeTitleFromTail(tail)).toEqual({text: "新的 [31m自动标题", source: "claude-ai-title"});
        expect(claudeTitleFromTail(`${tail}${line({type: "agent-name", agentName: "k1-kernel"})}`)).toEqual({text: "k1-kernel", source: "claude-agent-name"});
        expect(claudeTitleFromTail(`${line({type: "custom-title", customTitle: "我起的名"})}${tail}${line({type: "agent-name", agentName: "k1-kernel"})}`)).toEqual({text: "我起的名", source: "claude-custom"});
        expect(claudeTitleFromTail(line({type: "user", message: "没有标题"}))).toBeNull();
    });
});

describe("按 Agent 找会话文件", () => {
    test("Claude 在任一项目目录里按会话 id 找到文件；Codex 按 session_index 的最后一条；omp 读文件第一行；文件变了重读，找不到为 null", async () => {
        const fixture = await createFixture("session-titles");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-home-x-repo");
        await mkdir(project, {recursive: true});
        const claudeFile = join(project, `${CLAUDE_ID}.jsonl`);
        await writeFile(claudeFile, `${line({type: "user", message: "开始"})}${line({type: "ai-title", aiTitle: "会话页重做"})}`);
        await mkdir(join(home, ".codex"), {recursive: true});
        await writeFile(join(home, ".codex", "session_index.jsonl"), `${line({id: "codex-1", thread_name: "旧名字"})}${line({id: "codex-1", thread_name: "V9 评测"})}${line({id: "codex-2", thread_name: ""})}`);
        const ompDir = join(home, ".omp", "agent", "sessions", "-repo");
        await mkdir(ompDir, {recursive: true});
        const ompFile = join(ompDir, "2026-10-14T01-00-00-000Z_01a12dd3-661a-706f-93f5-1e6f5ac5d513.jsonl");
        await writeFile(ompFile, `${line({type: "title", v: 1, title: "面板界面打磨", source: "auto"})}${line({type: "session", id: "01a12dd3-661a-706f-93f5-1e6f5ac5d513"})}`);
        const logs: string[] = [];
        const titles = createSessionTitles({HOME: home}, (entry) => void logs.push(entry));

        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做", source: "claude-ai-title"});
        await appendFile(claudeFile, line({type: "ai-title", aiTitle: "会话页重做：两栏"}));
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做：两栏", source: "claude-ai-title"});
        expect(await titles.titleOf("claude", "00000000-0000-4000-8000-000000000000")).toBeNull();
        expect(await titles.titleOf("codex", "codex-1")).toEqual({text: "V9 评测", source: "codex"});
        expect(await titles.titleOf("codex", "codex-2")).toBeNull();
        expect(await titles.titleOf("omp", ompFile)).toEqual({text: "面板界面打磨", source: "omp"});
        expect(await titles.titleOf("omp", "01a12dd3-661a-706f-93f5-1e6f5ac5d513")).toEqual({text: "面板界面打磨", source: "omp"});
        expect(await titles.titleOf("shell", "x")).toBeNull();
        // 不像会话 id 的值不拿去拼路径。
        expect(await titles.titleOf("claude", "../../etc/passwd")).toBeNull();
        expect(logs).toEqual([]);
    });
});

describe("第 3 批实现审查的建议 7 到 9", () => {
    test("末尾一段里只有一条大记录：往前读到标题；超出能读的范围时沿用上次读到的，文件变短了不沿用", async () => {
        const fixture = await createFixture("session-titles-big");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-repo");
        await mkdir(project, {recursive: true});
        const file = join(project, `${CLAUDE_ID}.jsonl`);
        await writeFile(file, line({type: "ai-title", aiTitle: "会话页重做"}));
        const titles = createSessionTitles({HOME: home});
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做", source: "claude-ai-title"});
        // 一条 300KB 的图片记录：末尾 256KB 里没有标题行，往前加读能读到。
        await appendFile(file, line({type: "user", image: "x".repeat(300 * 1024)}));
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做", source: "claude-ai-title"});
        // 再来一条 5MB 的：超出 4MB 的加读范围，沿用上次读到的标题，不退回 null。
        await appendFile(file, line({type: "user", image: "y".repeat(5 * 1024 * 1024)}));
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "会话页重做", source: "claude-ai-title"});
        // 换成一份更短、没有标题的文件：不沿用。
        await writeFile(file, line({type: "user", message: "新会话"}));
        expect(await titles.titleOf("claude", CLAUDE_ID)).toBeNull();
    });

    test("找不到的会话文件记 60 秒：期间新建的文件不会被扫到，过期后找得到", async () => {
        const fixture = await createFixture("session-titles-miss");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-repo");
        await mkdir(project, {recursive: true});
        let clock = 1_000_000;
        const titles = createSessionTitles({HOME: home}, () => undefined, () => clock);
        expect(await titles.titleOf("claude", CLAUDE_ID)).toBeNull();
        await writeFile(join(project, `${CLAUDE_ID}.jsonl`), line({type: "ai-title", aiTitle: "后来建的"}));
        clock += 59_000;
        expect(await titles.titleOf("claude", CLAUDE_ID)).toBeNull();
        clock += 2_000;
        expect(await titles.titleOf("claude", CLAUDE_ID)).toEqual({text: "后来建的", source: "claude-ai-title"});
    });

    test("omp 的会话值是绝对路径：只认 omp 会话目录里的普通文件，目录外、带 .. 越出去的、FIFO 都是 null", async () => {
        const fixture = await createFixture("session-titles-omp-bounds");
        const home = join(fixture.root, "home");
        const sessions = join(home, ".omp", "agent", "sessions", "-repo");
        await mkdir(sessions, {recursive: true});
        const titleLine = line({type: "title", v: 1, title: "不该读到", source: "auto"});
        const outside = join(fixture.root, "elsewhere.jsonl");
        await writeFile(outside, titleLine);
        const fifo = join(sessions, "2026-10-14T01-00-00-000Z_fifo.jsonl");
        const made = Bun.spawnSync(["mkfifo", fifo]);
        expect(made.exitCode).toBe(0);
        const logs: string[] = [];
        const titles = createSessionTitles({HOME: home}, (entry) => void logs.push(entry));
        expect(await titles.titleOf("omp", outside)).toBeNull();
        expect(await titles.titleOf("omp", `${sessions}/../../../../../elsewhere.jsonl`)).toBeNull();
        expect(await titles.titleOf("omp", fifo)).toBeNull();
        expect(logs).toEqual([`读不出会话标题 ${fifo}：不是普通文件`]);
    });
});

describe("一批完整会话键的标题（t17）", () => {
    test("按第一个冒号拆键：Claude、Codex、omp 的绝对路径（目录名含冒号）与 omp 的 id 都读到，键原样是完整键；external、不认识的 Agent、没有文件的不在结果里", async () => {
        const fixture = await createFixture("session-titles-batch");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-home-x-repo");
        await mkdir(project, {recursive: true});
        await writeFile(join(project, `${CLAUDE_ID}.jsonl`), line({type: "custom-title", customTitle: "Claude 的名字"}));
        await mkdir(join(home, ".codex"), {recursive: true});
        await writeFile(join(home, ".codex", "session_index.jsonl"), line({id: "codex-1", thread_name: "Codex 的名字"}));
        // omp 的会话值是文件路径，目录名可以带冒号：只能按第一个冒号拆。
        const ompDir = join(home, ".omp", "agent", "sessions", "-repo:with:colons");
        await mkdir(ompDir, {recursive: true});
        const ompId = "01a12dd3-661a-706f-93f5-1e6f5ac5d513";
        const ompFile = join(ompDir, `2026-10-14T01-00-00-000Z_${ompId}.jsonl`);
        await writeFile(ompFile, line({type: "title", v: 1, title: "omp 的名字", source: "auto"}));
        const otherOmp = join(home, ".omp", "agent", "sessions", "-repo2");
        await mkdir(otherOmp, {recursive: true});
        await writeFile(join(otherOmp, "2026-10-14T02-00-00-000Z_0b0b0b0b-0000-4000-8000-000000000000.jsonl"), line({type: "title", v: 1, title: "按 id 找到的", source: "auto"}));
        const logs: string[] = [];
        const titles = createSessionTitles({HOME: home}, (entry) => void logs.push(entry));

        const keys = [
            `claude:${CLAUDE_ID}`,
            "codex:codex-1",
            `omp:${ompFile}`,
            "omp:0b0b0b0b-0000-4000-8000-000000000000",
            "external:bob",
            "shell:x",
            "claude:",
            "claude:00000000-0000-4000-8000-000000000000",
            `claude:${CLAUDE_ID}`,
        ];
        expect(await titles.titlesOf(keys)).toEqual({titles: {
            [`claude:${CLAUDE_ID}`]: {text: "Claude 的名字", source: "claude-custom"},
            "codex:codex-1": {text: "Codex 的名字", source: "codex"},
            [`omp:${ompFile}`]: {text: "omp 的名字", source: "omp"},
            "omp:0b0b0b0b-0000-4000-8000-000000000000": {text: "按 id 找到的", source: "omp"},
        }, pending: []});
        expect(await titles.titlesOf([])).toEqual({titles: {}, pending: []});
        expect(logs).toEqual([]);
    });

    test("文件改名、删掉、重新出现：每一批读到的都是文件此刻的标题", async () => {
        const fixture = await createFixture("session-titles-batch-change");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-repo");
        await mkdir(project, {recursive: true});
        const file = join(project, `${CLAUDE_ID}.jsonl`);
        await writeFile(file, line({type: "ai-title", aiTitle: "第一版"}));
        const titles = createSessionTitles({HOME: home});
        const key = `claude:${CLAUDE_ID}`;
        // 面板带整轮预算调用（state.ts）：预算够时与不带预算一样，全部查完、pending 为空。
        const batch = () => titles.titlesOf([key], {budgetMs: 30_000});
        expect(await batch()).toEqual({titles: {[key]: {text: "第一版", source: "claude-ai-title"}}, pending: []});
        await appendFile(file, line({type: "custom-title", customTitle: "改过的名"}));
        expect(await batch()).toEqual({titles: {[key]: {text: "改过的名", source: "claude-custom"}}, pending: []});
        await rm(file);
        expect(await batch()).toEqual({titles: {}, pending: []});
        await writeFile(file, line({type: "ai-title", aiTitle: "又回来了"}));
        expect(await batch()).toEqual({titles: {[key]: {text: "又回来了", source: "claude-ai-title"}}, pending: []});
    });
});

describe("冷查找的配额（t17 服务端实现审查第 1 条）", () => {
    test("整个 resolver 最多 4 个查找同时进行：上一批到点后还在读的占着配额，下一批的新键一个也不开始；到点的批次排着队的键，配额空出来之后也不再替它开始", async () => {
        const fixture = await createFixture("session-titles-quota");
        const home = join(fixture.root, "home");
        const project = join(home, ".claude", "projects", "-repo");
        await mkdir(project, {recursive: true});
        const ids = Array.from({length: 8}, (_, n) => `bbbbbbbb-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
        const paths = ids.map((id) => join(project, `${id}.jsonl`));
        for (const [n, path] of paths.entries()) await writeFile(path, line({type: "ai-title", aiTitle: `标题 ${n + 1}`}));
        const keys = ids.map((id) => `claude:${id}`);
        const titleOf = (n: number) => ({[keys[n]!]: {text: `标题 ${n + 1}`, source: "claude-ai-title" as const}});
        // 八个文件都挂上租约：读它们的 open() 卡在内核里，直到测试放掉（stat 照常）。
        const leases = await holdFileLeases(paths);
        try {
            const titles = createSessionTitles({HOME: home});
            const first = keys.slice(0, 4);
            const second = keys.slice(4);
            const opening = async () => (await leases.states()).flatMap((state, n) => (state === "breaking" ? [n] : []));

            // 第一批：4 个查找都卡在打开文件上，到点回来，全部没查完。
            expect(await titles.titlesOf(first, {budgetMs: 200})).toEqual({titles: {}, pending: first});
            await waitUntil("前 4 个文件的打开都卡住", async () => (await opening()).length === 4);
            // 第二批：配额被上一批还在读的 4 个占着，新键一个也开始不了。
            expect(await titles.titlesOf(second, {budgetMs: 300})).toEqual({titles: {}, pending: second});
            expect(await opening()).toEqual([0, 1, 2, 3]);

            // 放掉前 4 个：它们读完、还回配额；第二批已经到点，它排着队的键不再开始。
            for (let n = 0; n < 4; n++) await leases.release(n);
            expect(await titles.titlesOf(first)).toEqual({titles: {...titleOf(0), ...titleOf(1), ...titleOf(2), ...titleOf(3)}, pending: []});
            expect(await opening()).toEqual([]);

            // 新的一批问后 4 个：拿到配额才开始读。
            const third = titles.titlesOf(second);
            await waitUntil("后 4 个文件开始读", async () => (await opening()).length === 4);
            for (let n = 4; n < 8; n++) await leases.release(n);
            expect(await third).toEqual({titles: {...titleOf(4), ...titleOf(5), ...titleOf(6), ...titleOf(7)}, pending: []});
        } finally {
            await leases.close();
        }
    }, 30_000);
});

describe("Codex 的索引（t17 服务端实现审查第 3 条）", () => {
    test("只读索引末尾 4MB：取末尾里各会话的最后一个名字；只在更早位置的会话按没有标题处理，记一条诊断", async () => {
        const fixture = await createFixture("session-titles-codex-tail");
        const home = join(fixture.root, "home");
        await mkdir(join(home, ".codex"), {recursive: true});
        const index = join(home, ".codex", "session_index.jsonl");
        // 末尾 4MB 之前：只出现在这里的会话，和后来又改过名的会话。
        const filler = Array.from({length: 100_000}, (_, n) => line({id: `filler-${n}`, thread_name: `填充 ${n}`})).join("");
        expect(filler.length).toBeGreaterThan(4 * 1024 * 1024);
        await writeFile(index, `${line({id: "codex-old", thread_name: "很早的会话"})}${line({id: "codex-1", thread_name: "旧名字"})}${filler}${line({id: "codex-1", thread_name: "新名字"})}${line({id: "codex-1", thread_name: ""})}${line({id: "codex-2", thread_name: "末尾里的"})}`);
        const logs: string[] = [];
        const titles = createSessionTitles({HOME: home}, (entry) => void logs.push(entry));

        expect(await titles.titleOf("codex", "codex-1")).toEqual({text: "新名字", source: "codex"});
        expect(await titles.titleOf("codex", "codex-2")).toEqual({text: "末尾里的", source: "codex"});
        expect(await titles.titleOf("codex", "filler-99999")).toEqual({text: "填充 99999", source: "codex"});
        expect(logs).toEqual([]);
        expect(await titles.titleOf("codex", "codex-old")).toBeNull();
        expect(await titles.titleOf("codex", "codex-absent")).toBeNull();
        expect(logs.length).toBe(1);
        expect(logs[0]).toContain(index);
    });
});
