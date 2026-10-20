/**
 * 草稿编译（docs/specs/story/ingest.md 输出 5、8，验收 7）。
 *
 * 迁移对照：样例书就是 w00005 t34 用原编译程序编出来的；用同一批最终草稿与整理稿重新编译，结果应与样例书相同，只在
 * 编译程序有意改动的地方不同（称呼不跨章前移、回补的秘密与知情的成立位置），而且只往“更晚可见”的方向变。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {openTestBook, type TestBook} from "../../testing/api";
import {sampleDataset} from "../../testing/sample";
import type {Dataset, Position} from "../core/dataset";
import {comparePosition} from "../core/position";
import {compile, sourceChapter} from "./compile";

const FINAL = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest", "run-med-100-final.json.gz");

const atText = (at: Position) => `${at.chapter}.${at.paragraph}`;

describe("迁移对照：100 章最终草稿重新编译", () => {
    test("只在称呼位置、称呼出现、回补的秘密位置上不同，而且都只会更晚", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: unknown[]};
        const {dataset, issues} = compile(sample.book, sample.sources, final.drafts, final.consolidations);

        // 样例书本来就带着这一处全图时间矛盾（审查记录），重新编译照样报出来，没有新增别的错误。
        expect(issues.filter(issue => issue.level === "error").map(issue => issue.code)).toEqual(["time"]);

        const unchanged: (keyof Dataset)[] = ["schema", "book", "through", "sources", "times", "beats", "statements", "episodes", "knowledge", "ledger", "questions", "summaries", "arcs"];
        for (const key of unchanged) expect({key, value: dataset[key]}).toEqual({key, value: sample[key]});

        // 对象：除了称呼的位置都相同；称呼只会从前面的章挪回模型标注的那一章。
        const withoutNameAt = (data: Dataset) => data.entities.map(entity => ({...entity, names: entity.names.map(({at: _at, ...name}) => name)}));
        expect(withoutNameAt(dataset)).toEqual(withoutNameAt(sample));
        let moved = 0;
        for (const entity of sample.entities) {
            const now = dataset.entities.find(item => item.id === entity.id)!;
            for (const name of entity.names) {
                const after = now.names.find(item => item.text === name.text)!.at;
                if (comparePosition(after, name.at) === 0) continue;
                moved += 1;
                expect({name: name.text, later: comparePosition(after, name.at) > 0, crossChapter: after.chapter > name.at.chapter}).toEqual({name: name.text, later: true, crossChapter: true});
            }
        }
        expect(moved).toBeGreaterThan(0);

        // 称呼出现：少掉的都在那个称呼新的成立位置之前；多出来的是别的称呼，补上少掉的那些空出来的字（“魔法少女风信子”
        // 推后之后，同一处由“魔法少女”“风信子”匹配；“桃桃同学”推后之后，“夏桃桃同学”里的“夏桃桃”匹配上）。
        type Mention = Dataset["mentions"][number];
        const key = (mention: Mention) => `${mention.entity}|${mention.text}|${atText(mention.at)}|${mention.start}`;
        const before = new Set(sample.mentions.map(key));
        const now = new Set(dataset.mentions.map(key));
        const nameAt = new Map(dataset.entities.flatMap(entity => entity.names.map(name => [`${entity.id}|${name.text}`, name.at] as const)));
        const removed = sample.mentions.filter(item => !now.has(key(item)));
        for (const mention of removed) {
            const established = nameAt.get(`${mention.entity}|${mention.text}`);
            expect({mention: key(mention), beforeEstablished: established !== undefined && comparePosition(mention.at, established) < 0}).toEqual({mention: key(mention), beforeEstablished: true});
        }
        for (const mention of dataset.mentions.filter(item => !before.has(key(item)))) {
            const overlaps = removed.some(item => comparePosition(item.at, mention.at) === 0 && item.start < mention.end && mention.start < item.end);
            expect({mention: key(mention), fillsFreedText: overlaps}).toEqual({mention: key(mention), fillsFreedText: true});
        }

        // 秘密：只有成立位置可能变晚。
        expect(dataset.secrets.map(({at: _at, ...secret}) => secret)).toEqual(sample.secrets.map(({at: _at, ...secret}) => secret));
        for (const secret of sample.secrets) expect(comparePosition(dataset.secrets.find(item => item.id === secret.id)!.at, secret.at)).toBeGreaterThanOrEqual(0);
    }, 30_000);

    // 抽取每提交一章要把已抽的部分整本编译三四次。100 章原来一次二三十秒（每段对每个称呼都扫一遍），改后一秒以内；
    // 上限给机器负载留足余量，只挡住每段的工作又随称呼总数增长的写法（t09）。
    test("一次编译在 5 秒内", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: unknown[]};
        const started = performance.now();
        compile(sample.book, sample.sources, final.drafts, final.consolidations);
        expect(performance.now() - started).toBeLessThan(5000);
    }, 30_000);
});

/** 三章的小书：第 1 章出现“北斗星”这个字串，第 2 章才交代它是林晚的代号；第 3 章建秘密，补记第 1 章就知情的人。 */
function miniBook(): Dataset {
    const sources = [
        sourceChapter(1, "第1章 夜路", ["第1章 夜路", "林晚独自赶路。", "北斗星在天边闪烁。"]),
        sourceChapter(2, "第2章 代号", ["第2章 代号", "林晚的秘密代号是北斗星。"]),
        sourceChapter(3, "第3章 往事", ["第3章 往事", "林晚想起了往事。", "她没有说出口。"]),
    ];
    const drafts = [
        {
            chapter: 1,
            beats: [{id: "b1-1", from: 1, to: 3, gist: "林晚赶路。", time: null}],
            entities: [{id: "e1-1", kind: "person", label: "赶路的女子", at: "1.2", names: [{text: "林晚", at: "1.2", primary: true}]}],
            statements: [{id: "s1-1", text: "林晚独自在夜里赶路", family: "event", about: ["e1-1"], src: {at: ["1.2"], ch: "narrator"}}],
        },
        {chapter: 2, beats: [{id: "b2-1", from: 1, to: 2, gist: "交代代号。", time: null}], names: [{entity: "e1-1", text: "北斗星", at: "2.2"}]},
        {
            chapter: 3,
            beats: [{id: "b3-1", from: 1, to: 3, gist: "林晚回想。", time: null}],
            secrets: [{id: "x3-1", title: "林晚夜里赶路的事", about: ["e1-1"], statements: ["s1-1"]}],
            knowledge: [
                {id: "k3-1", who: "e1-1", about: "x3-1", state: "knows", at: ["1.2"]},
                // 回补的知情说的是前面的一条说法（不是秘密）：说法本身第 1 章就可见，挡住它的只有知情自己的成立位置。
                {id: "k3-2", who: "e1-1", about: "s1-1", state: "knows", at: ["1.2"]},
            ],
        },
    ];
    const {dataset, issues} = compile({id: "mini", title: "小书"}, sources, drafts);
    expect(issues.filter(issue => issue.level === "error")).toEqual([]);
    return dataset;
}

describe("可见位置（输出 5、8，验收 7）", () => {
    let book: TestBook;
    afterAll(async () => {
        await book?.close();
    });

    test("称呼从模型标注的那一章起可见；回补的秘密与知情读完写下它的那一章才可见", async () => {
        book = await openTestBook("ingest-visibility", miniBook());
        const names = async (chapter: number) => (await book.ok("entity.card", {book: "fox", entity: "e1-1", at: {chapter}})).names.map(name => name.text);
        expect(await names(1)).toEqual(["林晚"]);
        expect(await names(2)).toEqual(["林晚", "北斗星"]);

        const chapterOne = await book.ok("source.read", {book: "fox", at: {chapter: 1}, from: {chapter: 1, paragraph: 1}, to: {chapter: 1, paragraph: 3}});
        expect(chapterOne.paragraphs.flatMap(paragraph => paragraph.names.map(name => name.text))).toEqual(["林晚"]);
        expect((await book.ok("search", {book: "fox", at: {chapter: 1}, query: "北斗星", kinds: ["entity"]})).total).toBe(0);

        const secretRows = async (at: Position | {chapter: number}) => (await book.ok("secrets.matrix", {book: "fox", at})).rows.map(row => row.id);
        const knowledgeIds = async (at: Position | {chapter: number}) => (await book.ok("entity.knowledge", {book: "fox", entity: "e1-1", at})).items.map(item => item.id);
        for (const at of [{chapter: 2}, {chapter: 3, paragraph: 2}]) {
            expect(await secretRows(at)).toEqual([]);
            expect(await knowledgeIds(at)).not.toContain("k3-1");
            expect(await knowledgeIds(at)).not.toContain("k3-2");
        }
        expect(await secretRows({chapter: 3})).toEqual(["x3-1"]);
        expect(await knowledgeIds({chapter: 3})).toEqual(expect.arrayContaining(["k3-1", "k3-2"]));
    });
});

describe("时间点的先后矛盾", () => {
    test("错误只列出环上的时间点，排在环后面的不算", () => {
        const sources = [sourceChapter(1, "第1章", ["第1章", "正午。"]), sourceChapter(2, "第2章", ["第2章", "早晨。", "晚上。"])];
        const drafts = [
            {chapter: 1, times: [{id: "t1-1", label: "第一天正午", day: 1, part: "noon", at: ["1.2"]}], beats: [{id: "b1-1", from: 1, to: 2, gist: "正午。", time: "t1-1"}]},
            {
                chapter: 2,
                times: [
                    // 写成第一天早晨，又说在 t1-1（第一天正午）之后：自相矛盾。
                    {id: "t2-1", label: "第一天早晨", day: 1, part: "morning", rel: [{type: "after", to: "t1-1"}], at: ["2.2"]},
                    {id: "t2-2", label: "那天晚上", rel: [{type: "after", to: "t2-1"}], at: ["2.3"]},
                ],
                beats: [{id: "b2-1", from: 1, to: 2, gist: "早晨。", time: "t2-1"}, {id: "b2-2", from: 3, to: 3, gist: "晚上。", time: "t2-2"}],
            },
        ];
        const {issues} = compile({id: "t", title: "t"}, sources, drafts);
        const cycle = issues.filter(issue => issue.level === "error" && issue.code === "time");
        expect(cycle.map(issue => [issue.chapter, issue.records])).toEqual([[null, ["t1-1", "t2-1"]]]);
    });
});
