/**
 * 没抽完的书（w00024 t30，docs/specs/story/qa.md 输出 42）：阅读位置可以落在还没抽取的尾部章里，那几章只能用 read 读原文，
 * 图工具只回答到抽取进度。真实 harness 与真实书库；书库里 `.ingest/fox/source.json` 写入全本原文，已提交的只有前 20 章。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {toolCall} from "@notnotype/nb-harness/testing";

import {openTestBook, type TestBook} from "../../testing/api";
import {askScripted, toolResults} from "../../testing/qa";
import {sampleDataset, smallDataset} from "../../testing/sample";
import {QaRecords} from "../core/qa-records";
import {changePosition} from "./engine";

const COMMITTED = 20;
const TOTAL = 25;
let book: TestBook;
let chapters: {chapter: number; title: string; paragraphs: string[]; sha256: string}[];

async function writeSource(root: TestBook, mutate?: (list: typeof chapters) => unknown): Promise<void> {
    const dir = root.api.library.ingestDir("fox");
    await mkdir(dir, {recursive: true});
    const list = chapters.map(chapter => ({...chapter, paragraphs: [...chapter.paragraphs]}));
    await writeFile(join(dir, "source.json"), JSON.stringify({id: "fox", title: "t", chapters: mutate ? mutate(list) ?? list : list, preambleChars: 0, volumeLines: 0, createdAt: "2026-10-27T00:00:00.000Z"}));
}

beforeAll(async () => {
    chapters = (await sampleDataset()).sources.filter(chapter => chapter.chapter <= TOTAL);
    book = await openTestBook("qa-reach", await smallDataset(COMMITTED, "reach"));
    await writeSource(book);
});

afterAll(async () => {
    await book.close();
});

const read = (id: string, from: object, to?: object) => toolCall(id, "read", to === undefined ? {from} : {from, to});
const answer = (evidence: string[]) => [toolCall("a", "answer", {conclusion: "结论", conclusionType: "推断", explanation: "说明", evidence, coverage: "尾部", })];

describe("book.info 的未抽取尾部", () => {
    test("给出尾部各章的段数，toc 里列出尾部各章（标题 null）；段数表和章数仍只含已提交的章", async () => {
        const info = await book.ok("book.info", {});
        expect(info.chapters).toBe(COMMITTED);
        expect(info.unextracted).toEqual(chapters.slice(COMMITTED).map(chapter => chapter.paragraphs.length));
        expect(info.toc.slice(COMMITTED)).toEqual(chapters.slice(COMMITTED).map(chapter => ({chapter: chapter.chapter, title: null})));
    });

    test("前缀段数与这一代对不上（别的书）或结构不对：尾部为空；没有抽取记录同样为空", async () => {
        const other = await openTestBook("qa-reach-other", await smallDataset(COMMITTED, "other"));
        try {
            expect((await other.ok("book.info", {})).unextracted).toEqual([]);
            await writeSource(other, list => {
                list[3]!.paragraphs.pop();
                return list;
            });
            expect((await other.ok("book.info", {})).unextracted).toEqual([]);
            await writeSource(other, () => ({not: "an array"}));
            expect((await other.ok("book.info", {})).unextracted).toEqual([]);
            expect(await other.fail("book.info", {at: {chapter: 22}})).toBe("position_out_of_range");
        } finally {
            await other.close();
        }
    });
});

describe("问答读尾部（输出 42）", () => {
    test("阅读位置在尾部章：read 能读尾部和跨过抽取进度的范围，出处通过校验；图工具回答到抽取进度并带提示，chapter 与 para 指向尾部章时说只能读原文", async () => {
        const {model, outcome} = await askScripted(
            book,
            [
                [
                    read("r1", {chapter: 20, paragraph: 88}, {chapter: 22, paragraph: 2}),
                    toolCall("c1", "card", {entity: "苏天晴"}),
                    toolCall("c2", "chapter", {chapter: 22}),
                    toolCall("c3", "para", {chapter: 22, paragraph: 1}),
                    toolCall("c4", "search", {query: "苏天晴", kinds: ["source"]}),
                ],
                answer(["22.1"]),
            ],
            {at: {chapter: 23}},
        );
        expect(outcome.result).toMatchObject({status: "answered", at: {chapter: 23}});
        const [readResult, card, chapter, para, search] = toolResults(model, 1);
        expect(readResult!.isError).toBe(false);
        expect(readResult!.text).toContain(`22.2  ${chapters[21]!.paragraphs[1]}`);
        expect(readResult!.text).toContain(`20.89  `);
        expect(readResult!.text).toContain(`21.3  `);
        for (const result of [card, chapter, para, search]) expect(result!.text).toContain("图只抽到第 20 章；第 21 章到第 23 章的内容只能用 read 读原文");
        expect(chapter).toMatchObject({isError: false});
        expect(chapter!.text).toContain("只能用 read 读原文");
        expect(para).toMatchObject({isError: false});
    });

    test("位置在抽取进度之内时不带提示；位置超出尾部是 position_out_of_range", async () => {
        const {model} = await askScripted(book, [[toolCall("c1", "card", {entity: "苏天晴"}), read("r1", {chapter: 19, paragraph: 1}, {chapter: 19, paragraph: 2})], answer(["19.1"])], {at: {chapter: 20}});
        expect(toolResults(model, 1)[0]!.text).not.toContain("图只抽到");
        await expect(askScripted(book, [], {at: {chapter: TOTAL + 1}})).rejects.toMatchObject({code: "position_out_of_range"});
    });

    test("读尾部之后往回调到抽取进度之内：尾部章读不了，提醒写“第 N 章”并说明图只到抽取进度", async () => {
        const first = await askScripted(book, [[read("r1", {chapter: 22, paragraph: 1}, {chapter: 22, paragraph: 1})], answer(["22.1"])], {at: {chapter: 22}});
        const id = first.outcome.result.id;
        const back = await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 20}});
        expect(back.changed).toBe(true);
        const forward = await changePosition({api: book.api, book: undefined, conversation: id, at: {chapter: 24}});
        expect(forward.conversation.currentAt).toMatchObject({chapter: 24});
        const stored = await new QaRecords(book.api.library, "fox").getWithLog(id, (await book.api.library.readMeta("fox")).generation);
        expect((stored.log as {jsonl: string}).jsonl).toContain("阅读位置从第 20 章改为第 24 章。你可以访问第 24 章及之前的内容了。图只抽到第 20 章，第 21 章之后只能用 read 读原文。");
        const next = await askScripted(book, [[read("r1", {chapter: 24, paragraph: 1}, {chapter: 24, paragraph: 1})], answer(["24.1"])], {continueFrom: id, question: "再问"});
        expect(next.outcome.result.status).toBe("answered");
    });

    test("全读对话把尾部原文一起交给模型", async () => {
        const {model} = await askScripted(book, [[toolCall("c1", "info", {})], answer(["21.1"])], {at: {chapter: 21}, mode: "full"});
        const first = model.requests[0]!.messages[0] as {content: unknown};
        expect(JSON.stringify(first.content)).toContain(chapters[20]!.paragraphs[0]!.slice(0, 10));
    });
});
