/**
 * 问答记录（docs/specs/story/qa.md 输出 15、16、25，“时序与寿命”“副作用与数据”，F5、F6）与固定一代的书会话。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "./api";
import {StoryError} from "./errors";
import {Library} from "./library";
import {currentPosition, highestPosition, newQaRecordId, QaRecords, type QaConversation, type QaTurn} from "./qa-records";
import {makeSampleRoot, smallDataset} from "../../testing/sample";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

/** 临时书库里导入一本两章的小书，书 id `fox`。 */
async function setup(name: string) {
    const sample = await makeSampleRoot(name);
    roots.push(sample.root);
    const lib = new Library(sample.library);
    const file = join(sample.root, "small.json");
    await writeFile(file, JSON.stringify(await smallDataset(2, "小书")));
    const {generation} = await lib.importBook({file, title: "小书", id: "fox"});
    return {lib, file, generation, records: new QaRecords(lib, "fox")};
}

function turn(overrides: Partial<QaTurn> = {}): QaTurn {
    return {
        question: "谁知道地狱猫是谁？",
        status: "answered",
        answer: {conclusion: "没人知道", conclusionType: "推断", explanation: "……", evidence: ["1.1"], coverage: "第 1 章"},
        reply: null,
        error: null,
        chaptersRead: [1],
        rejections: 0,
        usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null, complete: true},
        ms: 1200,
        model: "test-model",
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}

function record(generation: string, overrides: Partial<Omit<QaConversation, "log">> = {}): Omit<QaConversation, "log"> {
    return {
        id: newQaRecordId(),
        book: "fox",
        generation,
        at: {chapter: 2, paragraph: 3},
        mode: "graph",
        maxChapters: 20,
        read: [[1, 1, 3]],
        turns: [turn()],
        startedAt: new Date().toISOString(),
        ...overrides,
    };
}

/** 这项改动之前的一问一条的记录形状（qa.md 输出 15 的旧条目）。 */
function legacyRecord(generation: string, id: string) {
    const {reply: _reply, ...rest} = turn({question: "旧的一问"});
    return {id, book: "fox", generation, at: {chapter: 2, paragraph: 3}, mode: "graph", ...rest};
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof StoryError) return error.code;
        throw error;
    }
    throw new Error("期望失败，却成功了");
}

describe("问答记录", () => {
    test("保存后能列出、显示，会话日志一起写下；新的在前", async () => {
        const {records, generation} = await setup("qa-save");
        const first = record(generation, {id: newQaRecordId(new Date("2026-10-16T10:00:00Z"))});
        const second = record(generation, {id: newQaRecordId(new Date("2026-10-16T11:00:00Z")), turns: [turn({question: "第二问"})]});
        expect(await records.save(first, '{"seq":1}\n', {expectTurns: 0})).toMatchObject({saved: true});
        expect(await records.save(second, '{"seq":1}\n{"seq":2}\n', {expectTurns: 0})).toMatchObject({saved: true});

        expect((await records.list(generation)).records.map(item => item.turns[0]!.question)).toEqual(["第二问", "谁知道地狱猫是谁？"]);
        const shown = await records.get(first.id, generation);
        expect(shown).toMatchObject(first);
        expect(await records.sessionLog(await records.get(second.id, generation))).toEqual({ok: true, jsonl: '{"seq":1}\n{"seq":2}\n'});
    });

    test("删除对话同时删除它的全部会话日志；之后显示得到 qa_record_not_found（F5）", async () => {
        const {lib, records, generation} = await setup("qa-remove");
        const item = record(generation);
        await records.save(item, "{}\n", {expectTurns: 0});
        // 保存中途留下、没人引用的日志也一并删掉（qa.md 验收 18）。
        await writeFile(join(lib.bookDir("fox"), "qa", `${item.id}.9-abcdef.session.jsonl`), "{}\n");
        await records.remove(item.id, generation);
        expect((await records.list(generation)).records).toEqual([]);
        expect(await readdir(join(lib.bookDir("fox"), "qa"))).toEqual([]);
        expect(await codeOf(records.get(item.id, generation))).toBe("qa_record_not_found");
        expect(await codeOf(records.remove(item.id, generation))).toBe("qa_record_not_found");
    });

    test("不合法的记录 id 不拼进路径", async () => {
        const {records, generation} = await setup("qa-id");
        expect(await codeOf(records.get("../book", generation))).toBe("qa_record_not_found");
        expect(await codeOf(records.remove("../../library", generation))).toBe("qa_record_not_found");
    });

    test("书删除后保存：不保存，也不重新造出书目录", async () => {
        const {lib, records, generation} = await setup("qa-removed");
        await lib.removeBook("fox");
        expect(await records.save(record(generation), "{}\n", {expectTurns: 0})).toEqual({saved: false, reason: "book_not_found"});
        expect((await readdir(lib.root)).filter(name => !name.startsWith(".") && name !== "library.json")).toEqual([]);
    });

    test("删除后同 id 重新导入：旧一代的记录不保存；新一代只列自己的", async () => {
        const {lib, file, records, generation: old} = await setup("qa-reimport");
        const before = record(old);
        await records.save(before, "{}\n", {expectTurns: 0});
        await lib.removeBook("fox");
        const {generation: fresh} = await lib.importBook({file, title: "小书", id: "fox"});
        expect(await records.save(record(old), "{}\n", {expectTurns: 0})).toEqual({saved: false, reason: "book_not_found"});
        const mine = record(fresh, {turns: [turn({question: "新一代"})]});
        await records.save(mine, "{}\n", {expectTurns: 0});
        expect((await records.list(fresh)).records.map(item => item.turns[0]!.question)).toEqual(["新一代"]);
        expect(await codeOf(records.get(before.id, fresh))).toBe("qa_record_not_found");
    });

    test("书的格式版本不认识：保存返回 unsupported_format，删除报 unsupported_format，列出照常", async () => {
        const {lib, records, generation} = await setup("qa-format");
        const item = record(generation);
        await records.save(item, "{}\n", {expectTurns: 0});
        const metaPath = join(lib.bookDir("fox"), "book.json");
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
        await writeFile(metaPath, JSON.stringify({...meta, format: 99}));

        expect(await records.save(record(generation), "{}\n", {expectTurns: 0})).toEqual({saved: false, reason: "unsupported_format"});
        expect(await codeOf(records.remove(item.id, generation))).toBe("unsupported_format");
        expect((await records.list(generation)).records.map(entry => entry.id)).toEqual([item.id]);
    });
});

describe("对话的多轮保存（输出 25，验收 16、18）", () => {
    test("第二轮保存：记录换成两轮、指向新日志，上一轮的日志删掉；只剩这一对", async () => {
        const {lib, records, generation} = await setup("qa-second");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        const two = {...first, turns: [...first.turns, turn({question: "追问"})]};
        const saved = await records.save(two, "第一轮\n第二轮\n", {expectTurns: 1});
        expect(saved).toMatchObject({saved: true});

        const shown = await records.get(first.id, generation);
        expect(shown.turns.map(item => item.question)).toEqual(["谁知道地狱猫是谁？", "追问"]);
        expect(await records.sessionLog(shown)).toEqual({ok: true, jsonl: "第一轮\n第二轮\n"});
        expect((await readdir(join(lib.bookDir("fox"), "qa"))).sort()).toEqual([`${first.id}.json`, shown.log!.file].sort());
    });

    test("两次从同一轮数出发：先保存的写成，后保存的 conflict，记录与它指向的日志都是先保存的那一对，后者的日志被删掉", async () => {
        const {lib, records, generation} = await setup("qa-conflict");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        const a = {...first, turns: [...first.turns, turn({question: "甲的追问"})]};
        const b = {...first, turns: [...first.turns, turn({question: "乙的追问"})]};
        expect(await records.save(a, "甲\n", {expectTurns: 1})).toMatchObject({saved: true});
        expect(await records.save(b, "乙\n", {expectTurns: 1})).toEqual({saved: false, reason: "conflict"});

        const shown = await records.get(first.id, generation);
        expect(shown.turns.at(-1)!.question).toBe("甲的追问");
        expect(await records.sessionLog(shown)).toEqual({ok: true, jsonl: "甲\n"});
        expect(await readdir(join(lib.bookDir("fox"), "qa"))).toHaveLength(2);
        // 新对话的 id 已经有记录时同样不覆盖。
        expect(await records.save(first, "又一次\n", {expectTurns: 0})).toEqual({saved: false, reason: "conflict"});
    });

    test("当前位置与最高位置（t25）：改过位置取 currentAt，没改取最后一轮用的位置，旧记录回落到 at；最高位置不因往回调下降", () => {
        const base = {at: {chapter: 10, paragraph: 1}, turns: [turn()]};
        expect(currentPosition(base)).toEqual({chapter: 10, paragraph: 1});
        expect(currentPosition({...base, turns: [turn({at: {chapter: 12, paragraph: 3}})]})).toEqual({chapter: 12, paragraph: 3});
        expect(currentPosition({...base, turns: [turn({at: {chapter: 12, paragraph: 3}})], currentAt: {chapter: 5, paragraph: 1}})).toEqual({chapter: 5, paragraph: 1});
        // 第 1 轮在 40 章回答，之后位置调回 27：当前位置是 27，整个对话出现过的最高位置仍是 40。
        const back = {at: {chapter: 40, paragraph: 1}, turns: [turn({at: {chapter: 40, paragraph: 1}})], currentAt: {chapter: 27, paragraph: 1}};
        expect(currentPosition(back)).toEqual({chapter: 27, paragraph: 1});
        expect(highestPosition(back)).toEqual({chapter: 40, paragraph: 1});
        expect(highestPosition({at: {chapter: 3, paragraph: 2}, turns: [turn()], currentAt: {chapter: 8, paragraph: 1}})).toEqual({chapter: 8, paragraph: 1});
    });

    test("位置改过：运行中的一轮从旧的改动次数出发保存得到 conflict，不盖掉那次改动；新字段原样读回，旧记录没有它们", async () => {
        const {records, generation} = await setup("qa-position-conflict");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        // 对话里改了位置：轮数不变，改动次数加一，当前位置换了。
        const changed = {...first, currentAt: {chapter: 1, paragraph: 2}, positionChanges: 1};
        expect(await records.save(changed, "改位置\n", {expectTurns: 1, expectChanges: 0})).toMatchObject({saved: true});
        // 同一时刻开始的第二轮（还以为没改过位置）保存：conflict，改位置的那一对保留。
        const stale = {...first, turns: [...first.turns, turn({question: "追问"})]};
        expect(await records.save(stale, "追问\n", {expectTurns: 1, expectChanges: 0})).toEqual({saved: false, reason: "conflict"});
        const shown = await records.get(first.id, generation);
        expect(shown).toMatchObject({currentAt: {chapter: 1, paragraph: 2}, positionChanges: 1});
        expect(shown.turns).toHaveLength(1);
        expect(await records.sessionLog(shown)).toEqual({ok: true, jsonl: "改位置\n"});
        // 知道改过位置的追问（expectChanges: 1）能保存。
        expect(await records.save({...shown, turns: [...shown.turns, turn({question: "再问", at: {chapter: 1, paragraph: 2}})]}, "再问\n", {expectTurns: 1, expectChanges: 1})).toMatchObject({saved: true});
        // 旧记录没有这两个字段：读出来是 undefined，当前位置回落。
        expect(first).not.toHaveProperty("currentAt");
    });

    test("续问期间对话被删：conflict，不重新造出记录", async () => {
        const {records, generation} = await setup("qa-removed-conversation");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        await records.remove(first.id, generation);
        expect(await records.save({...first, turns: [...first.turns, turn()]}, "第二轮\n", {expectTurns: 1})).toEqual({saved: false, reason: "conflict"});
        expect(await codeOf(records.get(first.id, generation))).toBe("qa_record_not_found");
    });

    test("会话日志被改过一个字节或不在了：读不出可续问的日志", async () => {
        const {lib, records, generation} = await setup("qa-tamper");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        const shown = await records.get(first.id, generation);
        const path = join(lib.bookDir("fox"), "qa", shown.log!.file);
        await writeFile(path, "第一轮。\n");
        expect(await records.sessionLog(shown)).toMatchObject({ok: false});
        await rm(path);
        expect(await records.sessionLog(shown)).toMatchObject({ok: false});
    });
});

describe("读写交错（输出 15、25，实现审查 F1、F2、F5）", () => {
    test("日志读不出来（没有读权限）：给出原因，不抛出", async () => {
        const {lib, records, generation} = await setup("qa-unreadable");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        const shown = await records.get(first.id, generation);
        const path = join(lib.bookDir("fox"), "qa", shown.log!.file);
        await chmod(path, 0o000);
        try {
            expect(await records.sessionLog(shown)).toMatchObject({ok: false, problem: expect.stringContaining("EACCES")});
        } finally {
            await chmod(path, 0o644);
        }
    });

    test("读到旧记录之后别处发布了下一轮、删掉旧日志：按新的一对重读，不误报日志丢了", async () => {
        const {lib, records, generation} = await setup("qa-read-race");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        let fired = false;
        // 只在第一次读记录之后插一步：另一处保存第二轮（发布新的一对并删掉第一轮的日志）。
        class RacingRecords extends QaRecords {
            override async get(id: string, gen: string): Promise<QaConversation> {
                const read = await super.get(id, gen);
                if (!fired) {
                    fired = true;
                    await records.save({...first, turns: [...first.turns, turn({question: "别处的追问"})]}, "两轮\n", {expectTurns: 1});
                }
                return read;
            }
        }
        const {conversation, log} = await new RacingRecords(lib, "fox").getWithLog(first.id, generation);
        expect(conversation.turns.map(item => item.question)).toEqual(["谁知道地狱猫是谁？", "别处的追问"]);
        expect(log).toEqual({ok: true, jsonl: "两轮\n"});
    });

    test("发布前日志被删除对话扫掉：撤回刚发布的记录、按冲突返回，不留下没有日志的记录", async () => {
        const sample = await makeSampleRoot("qa-remove-during-save");
        roots.push(sample.root);
        const file = join(sample.root, "small.json");
        await writeFile(file, JSON.stringify(await smallDataset(2, "小书")));
        let removeLogs = false;
        // 记录改名之后、保存复查代号时，模拟 remove 已经扫掉了这个对话的日志（它在第一次删记录之后、改名之前扫过）。
        class RemovingLibrary extends Library {
            override async readMeta(id: string) {
                // 写门禁也读代号：等第二轮的日志已经写下（发布之后的那次复查）才动手。
                const dir = join(this.bookDir(id), "qa");
                const names = removeLogs ? await readdir(dir).catch(() => [] as string[]) : [];
                if (names.some(name => /\.2-[0-9a-z]{6}\.session\.jsonl$/u.test(name))) {
                    removeLogs = false;
                    for (const name of names) if (name.endsWith(".session.jsonl")) await rm(join(dir, name));
                }
                return super.readMeta(id);
            }
        }
        const lib = new RemovingLibrary(sample.library);
        const {generation} = await lib.importBook({file, title: "小书", id: "fox"});
        const records = new QaRecords(lib, "fox");
        const first = record(generation);
        await records.save(first, "第一轮\n", {expectTurns: 0});
        removeLogs = true;
        expect(await records.save({...first, turns: [...first.turns, turn()]}, "两轮\n", {expectTurns: 1})).toEqual({saved: false, reason: "conflict"});
        expect(await readdir(join(lib.bookDir("fox"), "qa"))).toEqual([]);
    });
});

describe("旧的一问一条的记录（输出 16，验收 15）", () => {
    test("按一轮的对话列出与显示，会话日志按旧名字读、不核对摘要", async () => {
        const {lib, records, generation} = await setup("qa-legacy");
        const id = newQaRecordId(new Date("2026-10-16T10:00:00Z"));
        const dir = join(lib.bookDir("fox"), "qa");
        await mkdir(dir);
        await writeFile(join(dir, `${id}.json`), JSON.stringify(legacyRecord(generation, id)));
        await writeFile(join(dir, `${id}.session.jsonl`), "旧日志\n");

        const shown = await records.get(id, generation);
        expect(shown.log).toBeNull();
        expect(shown.turns).toHaveLength(1);
        expect(shown.turns[0]).toMatchObject({question: "旧的一问", reply: null, status: "answered"});
        expect((await records.list(generation)).records.map(item => item.id)).toEqual([id]);
        expect(await records.sessionLog(shown)).toEqual({ok: true, jsonl: "旧日志\n"});
        await records.remove(id, generation);
        expect(await readdir(dir)).toEqual([]);
    });
});

describe("损坏的记录与换代的窗口（F6、“时序与寿命”）", () => {
    test("一份损坏的记录：列表照常列出其余记录并标出它；显示报 qa_record_broken；可以删除", async () => {
        const {lib, records, generation} = await setup("qa-broken");
        const good = record(generation);
        await records.save(good, "{}\n", {expectTurns: 0});
        const badId = newQaRecordId(new Date("2026-01-01T00:00:00Z"));
        await writeFile(join(lib.bookDir("fox"), "qa", `${badId}.json`), "{");
        // 形状合法、内容自相矛盾：已答的一轮既没有答案也没有文字回复。
        const oddId = newQaRecordId(new Date("2026-01-02T00:00:00Z"));
        const odd = {...record(generation, {id: oddId, turns: [turn({answer: null})]}), log: {file: `${oddId}.1-abcdef.session.jsonl`, sha256: "x"}};
        await writeFile(join(lib.bookDir("fox"), "qa", `${oddId}.json`), JSON.stringify(odd));

        const listed = await records.list(generation);
        expect(listed.records.map(item => item.id)).toEqual([good.id]);
        expect(listed.broken.map(item => item.id)).toEqual([oddId, badId]);
        expect(await codeOf(records.get(badId, generation))).toBe("qa_record_broken");
        expect(await codeOf(records.get(oddId, generation))).toBe("qa_record_broken");
        await records.remove(badId, generation);
        await records.remove(oddId, generation);
        expect((await records.list(generation)).broken).toEqual([]);
    });

    test("写门禁通过之后书被删除又同 id 导入：不保存，新一代目录里也不留下旧问的文件", async () => {
        const sample = await makeSampleRoot("qa-race");
        roots.push(sample.root);
        const file = join(sample.root, "small.json");
        await writeFile(file, JSON.stringify(await smallDataset(2, "小书")));
        // 只在写门禁返回之后插一步：删除并重新导入，落在 save 本来就有的 await 窗口里。
        class SwappingLibrary extends Library {
            override async writableBook(id: string, generation: string): Promise<string> {
                const dir = await super.writableBook(id, generation);
                await this.removeBook(id);
                await this.importBook({file, title: "小书", id});
                return dir;
            }
        }
        const lib = new SwappingLibrary(sample.library);
        const {generation} = await lib.importBook({file, title: "小书", id: "fox"});
        const records = new QaRecords(lib, "fox");

        expect(await records.save(record(generation), "{}\n", {expectTurns: 0})).toEqual({saved: false, reason: "book_not_found"});
        expect(await readdir(join(lib.bookDir("fox"), "qa"))).toEqual([]);
    });
});

describe("固定一代的书会话", () => {
    test("删除并同 id 重新导入之后，已打开的会话仍查旧的一代", async () => {
        const sample = await makeSampleRoot("qa-open-book");
        roots.push(sample.root);
        const api = createStoryApi({library: sample.library});
        const oldFile = join(sample.root, "old.json");
        const newFile = join(sample.root, "new.json");
        await writeFile(oldFile, JSON.stringify(await smallDataset(2, "旧书")));
        await writeFile(newFile, JSON.stringify(await smallDataset(1, "新书")));
        await api.call("book.import", {file: oldFile, title: "旧", id: "fox"});

        const session = await api.openBook("fox");
        await api.call("book.remove", {book: "fox"});
        await api.call("book.import", {file: newFile, title: "新", id: "fox"});

        const pinned = await session.call("book.info", {});
        const current = await api.call("book.info", {book: "fox"});
        expect(pinned.ok && pinned.value.chapters).toBe(2);
        expect(current.ok && current.value.chapters).toBe(1);
        expect(session.generation).not.toBe((await api.library.readMeta("fox")).generation);
    });

    test("只接受书级方法", async () => {
        const sample = await makeSampleRoot("qa-open-book-method");
        roots.push(sample.root);
        const api = createStoryApi({library: sample.library});
        await api.call("book.import", {file: sample.file, title: "样例", id: "fox"});
        const session = await api.openBook(undefined);
        const outcome = await session.call("book.remove", {book: "fox"});
        expect(!outcome.ok && outcome.error.code).toBe("invalid_params");
        expect((await api.library.listBooks()).map(book => book.id)).toEqual(["fox"]);
    });
});
