import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {appendFile, readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createJsonlSessionLog, createMemorySessionLog, parseEntryLine, type JsonValue, type SessionEntry, type SessionEntryInput, type SessionLog} from "../src";

let tmpRoot = "";

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("nb-session", "session-log");
});

afterAll(async () => {
    if (tmpRoot !== "") await rm(tmpRoot, {recursive: true, force: true});
});

const factories: ReadonlyArray<readonly [string, (sessionId: string) => Promise<SessionLog>]> = [
    ["memory", async (sessionId) => createMemorySessionLog({sessionId})],
    ["jsonl", async (sessionId) => createJsonlSessionLog({root: tmpRoot, sessionId})],
];

describe.each(factories)("%s session log", (_name, createLog) => {
    test("append 后 read 按 seq 升序且连续", async () => {
        const log = await createLog(`order-${_name}`);
        const first = await log.append([{kind: "message", role: "user", text: "hello"}]);
        const second = await log.append([
            {kind: "tool_call", callId: "c1", toolName: "read", argsJson: '{"path":"a.txt"}'},
            {kind: "tool_result", callId: "c1", isError: false, text: "alpha"},
            {kind: "message", role: "assistant", text: "done"},
        ]);

        expect(first.map((entry) => entry.seq)).toEqual([1]);
        expect(second.map((entry) => entry.seq)).toEqual([2, 3, 4]);

        const all = await log.read();
        expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
        expect(all.map((entry) => entry.kind)).toEqual(["message", "tool_call", "tool_result", "message"]);
        expect(all.every((entry) => typeof entry.at === "string" && entry.at.length > 0)).toBe(true);
    });

    test("空 log：read 为空、tail 为 null", async () => {
        const log = await createLog(`empty-${_name}`);

        expect(await log.read()).toEqual([]);
        expect(await log.tail()).toBeNull();
    });

    test("tail 返回最后一条", async () => {
        const log = await createLog(`tail-${_name}`);
        await log.append([{kind: "message", role: "user", text: "one"}]);
        await log.append([{kind: "message", role: "assistant", text: "two"}]);

        const last = await log.tail();
        expect(last?.kind).toBe("message");
        expect(last?.seq).toBe(2);
    });

    test("sinceSeq 与 limit 过滤", async () => {
        const log = await createLog(`window-${_name}`);
        await log.append([
            {kind: "message", role: "user", text: "1"},
            {kind: "message", role: "assistant", text: "2"},
            {kind: "message", role: "user", text: "3"},
            {kind: "message", role: "assistant", text: "4"},
        ]);

        expect((await log.read({sinceSeq: 2})).map((entry) => entry.seq)).toEqual([3, 4]);
        expect((await log.read({limit: 2})).map((entry) => entry.seq)).toEqual([1, 2]);
        expect((await log.read({sinceSeq: 1, limit: 1})).map((entry) => entry.seq)).toEqual([2]);
    });

    test("meta 与 compaction 条目可往返", async () => {
        const log = await createLog(`meta-${_name}`);
        await log.append([
            {kind: "meta", key: "title", value: "第一次会话"},
            {kind: "compaction", summary: "早期对话摘要", replacedThroughSeq: 1},
        ]);

        const entries = await log.read();
        expect(entries[0]).toEqual({kind: "meta", seq: 1, at: expect.any(String), key: "title", value: "第一次会话"});
        expect(entries[1]).toMatchObject({kind: "compaction", seq: 2, summary: "早期对话摘要", replacedThroughSeq: 1});
    });

    test("快照、原样消息、用量与运行结束条目可往返", async () => {
        const log = await createLog(`agent-${_name}`);
        const message: JsonValue = {
            role: "assistant",
            content: [
                {type: "thinking", thinking: "先查", thinkingSignature: "sig-1"},
                {type: "toolCall", id: "c1", name: "story_search", arguments: {query: "狐狸"}},
            ],
            stopReason: "toolUse",
        };
        const inputs: SessionEntryInput[] = [
            {kind: "session_snapshot", profile: {key: "story-qa", version: "1"}, initial: {book: "b1", at: {chapter: 38}}, tools: [{id: "story.search", name: "story_search"}]},
            {kind: "agent_message", message},
            {kind: "usage", input: 120, output: 30, cacheRead: 100, cacheWrite: 0, cost: null},
            {kind: "run_end", stopReason: "aborted", error: null},
        ];
        await log.append(inputs);

        const entries = await log.read();
        expect(entries.map(({seq: _seq, at: _at, ...rest}) => rest)).toEqual(inputs);
    });
});

describe("memory session log 从存下的条目开始", () => {
    test("JSONL 逐行读回的条目原样放入，之后追加的接着编号", async () => {
        const first = createMemorySessionLog({sessionId: "s1"});
        await first.append([
            {kind: "message", role: "user", text: "第一问"},
            {kind: "message", role: "assistant", text: "第一答"},
        ]);
        const jsonl = (await first.read()).map((entry) => JSON.stringify(entry)).join("\n");
        const restored = jsonl.split("\n").map(parseEntryLine);
        expect(restored.every((entry) => entry !== null)).toBe(true);

        const log = createMemorySessionLog({sessionId: "s1", entries: restored as SessionEntry[]});
        await log.append([{kind: "message", role: "user", text: "追问"}]);
        const entries = await log.read();
        expect(entries.slice(0, 2)).toEqual([...(await first.read())]);
        expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
        expect(await log.tail()).toMatchObject({seq: 3, text: "追问"});
    });

    test("seq 不从 1 起连续时拒绝", async () => {
        const source = createMemorySessionLog({sessionId: "s2"});
        await source.append([
            {kind: "message", role: "user", text: "a"},
            {kind: "message", role: "user", text: "b"},
        ]);
        const [, second] = await source.read();
        expect(() => createMemorySessionLog({sessionId: "s2", entries: [second!]})).toThrow("seq 不连续");
    });
});

describe("jsonl session log", () => {
    test("文件按行落盘，每行是可解析的条目", async () => {
        const log = await createJsonlSessionLog({root: tmpRoot, sessionId: "lines"});
        await log.append([
            {kind: "message", role: "user", text: "first"},
            {kind: "message", role: "assistant", text: "second"},
        ]);
        await log.append([{kind: "message", role: "user", text: "third"}]);

        const raw = await readFile(join(tmpRoot, "lines.jsonl"), "utf-8");
        const lines = raw.split("\n").filter((line) => line !== "");
        expect(lines).toHaveLength(3);
        expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2, 3]);
        expect(raw.endsWith("\n")).toBe(true);
    });

    test("重开实例后续接 seq（模拟进程重启）", async () => {
        const first = await createJsonlSessionLog({root: tmpRoot, sessionId: "restart"});
        await first.append([{kind: "message", role: "user", text: "before"}]);
        const second = await createJsonlSessionLog({root: tmpRoot, sessionId: "restart"});
        const appended = await second.append([{kind: "message", role: "assistant", text: "after"}]);

        expect(appended.map((entry) => entry.seq)).toEqual([2]);
        expect((await second.read()).map((entry) => (entry.kind === "message" ? entry.text : entry.kind))).toEqual(["before", "after"]);
    });

    test("重开实例后新条目照原样读回", async () => {
        const first = await createJsonlSessionLog({root: tmpRoot, sessionId: "restart-agent"});
        await first.append([
            {kind: "session_snapshot", profile: {key: "p", version: "2"}, initial: {}, tools: []},
            {kind: "agent_message", message: {role: "user", content: "你好"}},
        ]);
        const reopened = await createJsonlSessionLog({root: tmpRoot, sessionId: "restart-agent"});

        expect((await reopened.read()).map((entry) => entry.kind)).toEqual(["session_snapshot", "agent_message"]);
    });

    test("中断尾：read 只返回完好前缀，repair 截掉损坏字节且幂等，修复前 append 拒绝", async () => {
        const sessionId = "interrupted";
        const log = await createJsonlSessionLog({root: tmpRoot, sessionId});
        await log.append([{kind: "message", role: "user", text: "complete"}]);
        const fragment = '{"kind":"message","role":"user","text":"half';
        await appendFile(join(tmpRoot, `${sessionId}.jsonl`), fragment, "utf-8");

        expect((await log.read()).map((entry) => entry.seq)).toEqual([1]);
        await expect(log.append([{kind: "message", role: "user", text: "blocked"}])).rejects.toThrow(/中断尾/u);

        const repaired = await log.repair();
        expect(repaired.droppedBytes).toBe(Buffer.byteLength(fragment, "utf-8"));
        expect(await log.repair()).toEqual({droppedBytes: 0});

        const appended = await log.append([{kind: "message", role: "assistant", text: "resumed"}]);
        expect(appended.map((entry) => entry.seq)).toEqual([2]);
    });

    test("非法会话 id 与不存在的根目录被拒绝", async () => {
        await expect(createJsonlSessionLog({root: tmpRoot, sessionId: "../escape"})).rejects.toThrow(/非法会话 id/u);
        await expect(createJsonlSessionLog({root: tmpRoot, sessionId: ""})).rejects.toThrow(/非法会话 id/u);
        await expect(createJsonlSessionLog({root: join(tmpRoot, "nope"), sessionId: "missing-root"})).rejects.toThrow(/会话根目录/u);
    });
});
