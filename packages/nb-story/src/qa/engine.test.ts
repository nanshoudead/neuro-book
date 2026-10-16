/**
 * 内置问答的引擎（docs/specs/story/qa.md 输出 1 到 11、验收 1 到 5 与 7，F3、F4）：真实 harness、真实书库与 100 章
 * 样例书，只把模型输出换成脚本。断言的是模型拿到的工具结果与一问的结果。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {toolCall, type ScriptedInput} from "@notnotype/nb-harness/testing";

import {openTestBook, type TestBook} from "../../testing/api";
import {askScripted, testConfig, toolResults} from "../../testing/qa";
import {smallDataset} from "../../testing/sample";
import {QaRecords} from "../core/qa-records";
import {QaError} from "./errors";

let book: TestBook;
let chapter37Length = 0;

beforeAll(async () => {
    book = await openTestBook("qa-engine");
    chapter37Length = (await book.api.library.readMeta("fox")).paragraphs[36]!;
});

afterAll(async () => {
    await book.close();
});

const P = {chapter: 38, paragraph: 57};

function answer(fields: Record<string, unknown> = {}): ScriptedInput {
    return [toolCall(`a${Math.random()}`, "answer", {conclusion: "结论", conclusionType: "推断", explanation: "说明", evidence: ["38.55"], coverage: "第 38 章", ...fields})];
}

const read = (id: string, from: object, to?: object) => toolCall(id, "read", to === undefined ? {from} : {from, to});

describe("查询工具（输出 2、3）", () => {
    test("模型拿到命令行格式的结果；角色视角、数组筛选与第二页都可用", async () => {
        const {model} = await askScripted(
            book,
            [
                [
                    toolCall("c1", "card", {entity: "苏天晴"}),
                    toolCall("c2", "between", {entity: "苏天晴", other: "南嘉鱼"}),
                    toolCall("c3", "relations", {perspective: "苏天晴", kinds: ["person"]}),
                    toolCall("c4", "find", {query: "魔法少女", limit: 2}),
                ],
                [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
                answer(),
            ],
            {at: P},
        );
        const [card, between, relations, find] = toolResults(model, 1);
        expect(card!.text).toContain("心月狐〔8.48〕");
        expect(between!.text).toContain("南嘉鱼答应和苏天晴交朋友，两人互加了好友。");
        expect(relations!.isError).toBe(false);
        const cursor = /cursor 参数传 "([^"]+)"/u.exec(find!.text)?.[1];
        expect(cursor).toBeDefined();

        const second = await askScripted(book, [[toolCall("c5", "find", {query: "魔法少女", limit: 2, cursor})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()], {at: P});
        const firstIds = find!.text.split("\n").slice(0, 2).map(line => line.split(" ")[0]);
        const secondIds = toolResults(second.model, 1)[0]!.text.split("\n").slice(0, 2).map(line => line.split(" ")[0]);
        expect(secondIds.some(id => firstIds.includes(id))).toBe(false);
    });

    test("参数里写 at 或 book 被拒；查询失败带码与候选，这一问继续", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[toolCall("c1", "card", {entity: "苏天晴", at: {chapter: 100}}), toolCall("c2", "card", {entity: "不存在的人"})], [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})], answer()],
            {at: P},
        );
        const [withAt, missing] = toolResults(model, 1);
        expect(withAt!.isError).toBe(true);
        expect(missing).toMatchObject({isError: true});
        expect(missing!.text).toContain("entity_not_found");
        expect(outcome.record.status).toBe("answered");
    });
});

describe("防剧透（输出 4、验收 1）", () => {
    test("读原文只到 P；P 之后的章是工具错误；引用晚于 P 被退回", async () => {
        const {model, outcome} = await askScripted(
            book,
            [[read("r1", {chapter: 38, paragraph: 50}, {chapter: 38, paragraph: 81}), read("r2", {chapter: 39, paragraph: 1})], answer({evidence: ["38.60"]}), answer({evidence: ["38.55"]})],
            {at: P},
        );
        const [within, beyond] = toolResults(model, 1);
        expect(within!.text.split("\n").map(line => line.split("  ")[0])).toEqual(["38.50", "38.51", "38.52", "38.53", "38.54", "38.55", "38.56", "38.57"]);
        expect(beyond!.isError).toBe(true);
        expect(toolResults(model, 2)[0]!.text).toContain("晚于阅读位置 38.57");
        expect(outcome.record).toMatchObject({status: "answered", rejections: 1, chaptersRead: [38]});
    });
});

describe("章数上限（输出 5、验收 2）", () => {
    const config = testConfig({maxChapters: 2});

    test("读第 3 个新章被拒、不给段落；已读的章照常再读", async () => {
        const {model} = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 2})], [read("r2", {chapter: 2, paragraph: 1}, {chapter: 2, paragraph: 2})], [read("r3", {chapter: 3, paragraph: 1})], [read("r4", {chapter: 1, paragraph: 3}, {chapter: 1, paragraph: 3})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        expect(toolResults(model, 3)[0]).toMatchObject({isError: true});
        expect(toolResults(model, 3)[0]!.text).toContain("最多读 2 个不同的章");
        expect(toolResults(model, 4)[0]!.text.startsWith("1.3  ")).toBe(true);
    });

    test("同一条消息里读两个新章：只有一次成功；跨章请求整次被拒、不计入已读", async () => {
        const batch = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], [read("r2", {chapter: 2, paragraph: 1}, {chapter: 2, paragraph: 1}), read("r3", {chapter: 3, paragraph: 1}, {chapter: 3, paragraph: 1})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        expect(toolResults(batch.model, 2).map(result => result.isError)).toEqual([false, true]);
        expect(batch.outcome.record.chaptersRead).toEqual([1, 2]);

        const span = await askScripted(
            book,
            [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], [read("r2", {chapter: 37, paragraph: chapter37Length - 1}, {chapter: 39, paragraph: 1})], answer({evidence: ["1.1"]})],
            {at: P, config},
        );
        expect(toolResults(span.model, 2)[0]!.isError).toBe(true);
        expect(span.outcome.record.chaptersRead).toEqual([1]);
    });

    test("跨章请求裁到 P：37 章末尾到 39.1 只给到 38.57", async () => {
        const {model} = await askScripted(book, [[read("r1", {chapter: 37, paragraph: chapter37Length}, {chapter: 39, paragraph: 1})], answer({evidence: [`37.${chapter37Length}—38.57`]})], {at: P});
        const refs = toolResults(model, 1)[0]!.text.split("\n").map(line => line.split("  ")[0]);
        expect(refs[0]).toBe(`37.${chapter37Length}`);
        expect(refs.at(-1)).toBe("38.57");
    });
});

describe("作答的校验与退回（输出 7、8、验收 3）", () => {
    test("三处问题一次列出；读了、改了再交即已答", async () => {
        const {model, outcome} = await askScripted(
            book,
            [
                [read("r1", {chapter: 37, paragraph: 8}, {chapter: 37, paragraph: 8})],
                answer({evidence: ["37.8", "37.9"], explanation: "第 38.60 段也提到", knowledge: [{who: "苏天晴", state: "知道", how: "在场", refs: []}]}),
                [read("r2", {chapter: 37, paragraph: 9}, {chapter: 37, paragraph: 9})],
                answer({evidence: ["37.8", "37.9"], knowledge: [{who: "苏天晴", state: "知道", how: "在场", refs: ["37.9"]}]}),
            ],
            {at: P},
        );
        const rejection = toolResults(model, 2)[0]!.text;
        expect(rejection).toContain("37.9");
        expect(rejection).toContain("没读过");
        expect(rejection).toContain("38.60");
        expect(rejection).toContain("knowledge[0]（苏天晴，知道）没有出处");
        expect(outcome.record).toMatchObject({status: "answered", rejections: 1});
        expect(outcome.record.answer?.knowledge?.[0]?.refs).toEqual(["37.9"]);
    });

    test("分两次读完的范围可以整段引用；留一段没读就被退回", async () => {
        const whole = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 20})], [read("r2", {chapter: 38, paragraph: 21}, {chapter: 38, paragraph: 40})], answer({evidence: ["38.1—38.40"]})], {at: P});
        expect(whole.outcome.record.rejections).toBe(0);

        const gap = await askScripted(
            book,
            [[read("r1", {chapter: 38, paragraph: 1}, {chapter: 38, paragraph: 20})], [read("r2", {chapter: 38, paragraph: 22}, {chapter: 38, paragraph: 40})], answer({evidence: ["38.1—38.40"]}), answer({evidence: ["38.1—38.20"]})],
            {at: P},
        );
        expect(toolResults(gap.model, 3)[0]!.text).toContain("38.21");
        expect(gap.outcome.record.rejections).toBe(1);
    });

    test("结论不是“无法确定”却没有依据被退回；“无法确定”可以不带依据", async () => {
        const {model, outcome} = await askScripted(book, [answer({evidence: []}), answer({evidence: [], conclusionType: "无法确定"})], {at: P});
        expect(toolResults(model, 1)[0]!.text).toContain("evidence 至少要有一个出处");
        expect(outcome.record).toMatchObject({status: "answered", chaptersRead: []});
    });

    test("和查询工具混在一批的交卷不算，这一问继续", async () => {
        const {model, outcome} = await askScripted(book, [[read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55}), toolCall("a1", "answer", {conclusion: "x", conclusionType: "推断", explanation: "e", evidence: ["38.55"], coverage: "c"})], answer()], {at: P});
        expect(toolResults(model, 1).map(result => result.isError)).toEqual([false, true]);
        expect(outcome.record.status).toBe("answered");
    });
});

describe("提醒（输出 10、验收 4）与用量（输出 11）", () => {
    test("三次运行都没交卷（其中一次输出到上限）：提醒两次后 no_answer；用量逐次相加", async () => {
        const {model, outcome, progress} = await askScripted(
            book,
            [
                {content: "我想想", usage: {input: 10, output: 2}},
                {content: "还在想", stopReason: "length", usage: {input: 20, output: 3}},
                {content: "不交", usage: {input: 30, output: 4}},
            ],
            {at: P},
        );
        expect(model.requests).toHaveLength(3);
        expect(progress.filter(event => event.kind === "reminder")).toHaveLength(2);
        expect(outcome.record).toMatchObject({status: "failed", answer: null, error: {code: "no_answer"}});
        expect(outcome.record.usage).toEqual({input: 60, output: 9, cacheRead: 0, cacheWrite: 0, cost: null, complete: true});
    });

    test("模型出错不提醒，直接 model_failed", async () => {
        const {model, outcome} = await askScripted(book, [{content: "", error: {message: "上游不可用", status: 503}}], {at: P});
        expect(model.requests).toHaveLength(1);
        expect(outcome.record).toMatchObject({status: "failed", error: {code: "model_failed", kind: "network"}});
    });
});

describe("全读（输出 6、验收 5）", () => {
    test("原文超过上限：不发任何模型请求就以 full_read_unavailable 失败", async () => {
        let error: unknown;
        try {
            await askScripted(book, [], {at: {chapter: 100}, mode: "full", config: testConfig({fullReadMaxChars: 1000})});
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(QaError);
        expect((error as QaError).code).toBe("full_read_unavailable");
    });

    test("第一条消息带 P 以前每一段原文；引用其中任何段落都不因“没读过”被退回", async () => {
        const {model, outcome} = await askScripted(book, [answer({evidence: ["1.1", "20.3—20.5", "38.57"]})], {at: P, mode: "full", question: "全读的问题"});
        const first = model.requests[0]!.messages[0] as {content: string};
        expect(first.content).toContain("\n1.1 ");
        expect(first.content).toContain("\n38.57 ");
        expect(first.content).not.toContain("\n38.58 ");
        expect(first.content.endsWith("问题：全读的问题")).toBe(true);
        expect(outcome.record).toMatchObject({status: "answered", rejections: 0, mode: "full"});
        expect(outcome.record.chaptersRead).toHaveLength(38);
    });
});

describe("运行中删除书（“时序与寿命”、验收 7）", () => {
    async function freshBook(name: string): Promise<TestBook> {
        return openTestBook(name);
    }

    /** 第二次模型请求发出时先做 `during`，再让模型交卷。 */
    function stepsWith(during: () => Promise<void>): ScriptedInput[] {
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        return [
            [read("r1", {chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})],
            {content: answer() as never, onRequest: () => void during().then(release), gate},
        ];
    }

    test("只删除：照常交卷，记录不保存，也不重新造出书目录", async () => {
        const target = await freshBook("qa-remove-only");
        try {
            const {outcome} = await askScripted(target, stepsWith(async () => void (await target.api.call("book.remove", {book: "fox"}))), {at: P});
            expect(outcome.record.status).toBe("answered");
            expect(outcome).toMatchObject({recordSaved: false, notSavedReason: "book_not_found"});
            expect((await readdir(target.library)).filter(name => !name.startsWith(".") && name !== "library.json")).toEqual([]);
        } finally {
            await target.close();
        }
    });

    test("删除后同 id 重新导入；另一问先在新一代写下记录：旧问不保存，新一代只列另一问", async () => {
        const target = await freshBook("qa-remove-reimport");
        try {
            const small = join(target.root, "small.json");
            await writeFile(small, JSON.stringify(await smallDataset(40, "小书")));
            let other = "";
            const {outcome} = await askScripted(
                target,
                stepsWith(async () => {
                    await target.api.call("book.remove", {book: "fox"});
                    await target.api.call("book.import", {file: small, title: "小书", id: "fox"});
                    const another = await askScripted(target, [[read("r1", {chapter: 1, paragraph: 1}, {chapter: 1, paragraph: 1})], answer({evidence: ["1.1"]})], {at: {chapter: 2}});
                    other = another.outcome.record.id;
                }),
                {at: P},
            );
            expect(outcome.record.status).toBe("answered");
            expect(outcome.recordSaved).toBe(false);
            const {generation} = await target.api.library.readMeta("fox");
            expect((await new QaRecords(target.api.library, "fox").list(generation)).map(item => item.id)).toEqual([other]);
        } finally {
            await target.close();
        }
    });
});
