/**
 * “已有记录”（docs/specs/story/ingest.md 输出 4）。
 *
 * 不传本章（整理用）时与验证过质量的抽取管线逐字一致：抽取质量是用当时发给模型的这段文字验证的。对照的是 w00005 t34
 * 抽样例书时第 2 到 10 章请求里实际发出去的那一段。传本章时只详列与本章相关的行，用一本 25 章的小书逐节看选法。
 */

import {describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {sampleDataset} from "../../testing/sample";
import {compile, sourceChapter} from "./compile";
import {renderContext} from "./context";

const FIXTURES = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest");

async function gunzipJson<T>(name: string): Promise<T> {
    return JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as T;
}

describe("已有记录", () => {
    test("截至第 1 到 9 章的已有记录与 t34 当时发给模型的逐字相同", async () => {
        const sample = await sampleDataset();
        const final = await gunzipJson<{drafts: {chapter: number}[]; consolidations: {through: number}[]}>("run-med-100-final.json.gz");
        const recorded = await gunzipJson<Record<string, string>>("recorded-context-ch002-010.json.gz");
        for (let chapter = 2; chapter <= 10; chapter++) {
            const before = chapter - 1;
            const {dataset} = compile(
                sample.book,
                sample.sources.filter(source => source.chapter <= before),
                final.drafts.filter(draft => draft.chapter <= before),
                final.consolidations.filter(item => item.through <= before),
            );
            expect({chapter, context: renderContext(dataset, before)}).toEqual({chapter, context: recorded[String(chapter)]!});
        }
    }, 60_000);
});

/**
 * 25 章的小书。第 1 章登记六个对象：林晚、北斗星、医学院（称呼是“蓉城最好的医学院”）、两个都叫“守护之星”的对象、
 * 一个没有称呼的“神秘人”；三个秘密：一个关于医学院、一个关于林晚、一个关于医学院但林晚知道它的说法；两个量各挂在
 * 林晚与医学院上；疑问四个：第 1 章提出后再没提起、第 2 章提出第 10 章再提起、第 22 章提出、第 21 章提出第 23 章解答。
 * 每章一个时间点。北斗星与神秘人（只被叫作“那人”）第 23 章出现过；第 25 章原文只写到林晚与守护之星。
 */
function longBook() {
    const bodies: Record<number, string> = {1: "林晚来到蓉城最好的医学院，北斗星在天边，守护之星亮了。", 23: "北斗星又出现了，那人走远了。", 25: "林晚抬头看见守护之星。"};
    const sources = Array.from({length: 25}, (_, index) => sourceChapter(index + 1, `第${index + 1}章`, [`第${index + 1}章`, bodies[index + 1] ?? `平静的一天，第${index + 1}章。`]));
    const drafts = sources.map(({chapter}) => ({
        chapter,
        times: [chapter === 1 ? {id: "t1-1", label: "第一天", day: 1, at: ["1.2"]} : {id: `t${chapter}-1`, label: `又过一天（${chapter}）`, rel: [{type: "after", to: `t${chapter - 1}-1`, days: 1}], at: [`${chapter}.2`]}],
        beats: [{id: `b${chapter}-1`, from: 1, to: 2, gist: `第 ${chapter} 章。`, time: `t${chapter}-1`}],
        ...(chapter === 1
            ? {
                  entities: [
                      {id: "e1-1", kind: "person", label: "赶路的女子", at: "1.2", names: [{text: "林晚", at: "1.2", primary: true}]},
                      {id: "e1-2", kind: "item", label: "天边的星", at: "1.2", names: [{text: "北斗星", at: "1.2", primary: true}]},
                      {id: "e1-3", kind: "place", label: "苏天晴就读的医学院", at: "1.2", names: [{text: "蓉城最好的医学院", at: "1.2", primary: true}]},
                      {id: "e1-4", kind: "person", label: "天上的守护者", at: "1.2", names: [{text: "守护之星", at: "1.2", primary: true}]},
                      {id: "e1-5", kind: "item", label: "守护之星挂坠", at: "1.2", names: [{text: "守护之星", at: "1.2", primary: true}]},
                      {id: "e1-6", kind: "person", label: "神秘人", at: "1.2", names: []},
                  ],
                  statements: [
                      {id: "s1-1", text: "书中人物都是虚构的", family: "rule", about: [], src: {at: ["1.1"], ch: "author"}},
                      {id: "s1-2", text: "林晚来到医学院", family: "event", about: ["e1-1", "e1-3"], src: {at: ["1.2"], ch: "narrator"}},
                      {id: "s1-3", text: "医学院有一间暗室", family: "location", about: ["e1-3"], src: {at: ["1.2"], ch: "narrator"}},
                  ],
                  secrets: [
                      {id: "x1-1", title: "医学院的地下室", about: ["e1-3"]},
                      {id: "x1-2", title: "林晚的来历", about: ["e1-1"]},
                      {id: "x1-3", title: "医学院的暗室", about: ["e1-3"], statements: ["s1-3"]},
                  ],
                  // 林晚的知情指向秘密列的说法，不是秘密本身。
                  knowledge: [{id: "k1-1", who: "e1-1", about: "s1-3", state: "knows", at: ["1.2"]}],
                  ledger: [
                      {id: "l1-1", owner: "e1-3", track: "经费", op: "set", value: 100, reason: "开学", at: ["1.2"]},
                      {id: "l1-2", owner: "e1-1", track: "神典石", op: "set", value: 3, reason: "随身带着", at: ["1.2"]},
                  ],
                  questions: [{id: "q1-1", text: "北斗星从哪来？", at: ["1.2"], about: ["e1-2"]}],
              }
            : {}),
        ...(chapter === 2 ? {questions: [{id: "q2-1", text: "医学院为什么招她？", at: ["2.2"], about: ["e1-3"]}]} : {}),
        ...(chapter === 10 ? {questionUpdates: [{q: "q2-1", type: "raised", at: ["10.2"]}]} : {}),
        ...(chapter === 21 ? {questions: [{id: "q21-1", text: "谁在敲门？", at: ["21.2"], about: []}]} : {}),
        ...(chapter === 22 ? {questions: [{id: "q22-1", text: "明天会怎样？", at: ["22.2"], about: []}]} : {}),
        ...(chapter === 23 ? {
                  mentions: [{entity: "e1-6", text: "那人", at: "23.2"}],
                  statements: [{id: "s23-1", text: "敲门的是那人", family: "event", about: ["e1-6"], src: {at: ["23.2"], ch: "narrator"}}],
                  questionUpdates: [{q: "q21-1", type: "answered", at: ["23.2"], answer: "s23-1"}],
              } : {}),
    }));
    const {dataset, issues} = compile({id: "long", title: "小书"}, sources, drafts);
    expect(issues.filter(issue => issue.level === "error")).toEqual([]);
    return dataset;
}

/** 按“## ”切成节，取一节里的行。 */
const section = (text: string, title: string) => text.split("\n## ").find(part => part.startsWith(`${title}\n`))?.split("\n") ?? [];

describe("抽普通章时只详列相关的行", () => {
    test("本章出现与最近 3 章出现过的对象详列，其余进“其他对象”并带标签；秘密、状态跟着相关对象；疑问、时间点按窗口；不针对对象的说法留着", () => {
        const dataset = longBook();
        const chapter25 = dataset.sources.find(source => source.chapter === 25)!.paragraphs.join("\n");
        const text = renderContext(dataset, 24, {text: chapter25});
        const ids = (title: string) => section(text, title).map(line => /^([a-z]\d+-\d+)[｜　]/u.exec(line)?.[1]).filter(id => id !== undefined);

        // 同一称呼“守护之星”属于两个对象，两个都详列；北斗星与只被叫作“那人”的神秘人是第 23 章出现过的。
        expect(ids("对象名册").sort()).toEqual(["e1-1", "e1-2", "e1-4", "e1-5", "e1-6"]);
        expect(section(text, "其他对象")).toContain("e1-3｜地点｜蓉城最好的医学院｜苏天晴就读的医学院");
        // 医学院的暗室：林晚知道它列的说法，也算有相关对象的知情记录。
        expect(ids("秘密与知情")).toEqual(["x1-2", "x1-3"]);
        expect(section(text, "当前状态").join("\n")).toContain("神典石");
        expect(section(text, "当前状态").join("\n")).not.toContain("经费");
        expect(ids("未解的疑问").sort()).toEqual(["q2-1", "q22-1"]);
        expect(ids("时间点")).toEqual(Array.from({length: 20}, (_, index) => `t${index + 5}-1`));
        expect(ids("已有的说法")).toContain("s1-1");

        // 不传本章（整理）时照旧全列。
        const full = renderContext(dataset, 24);
        expect(section(full, "其他对象")).toEqual([]);
        expect(section(full, "对象名册").filter(line => /^e\d/u.test(line))).toHaveLength(6);
        expect(section(full, "未解的疑问").join("\n")).toContain("q1-1");
    });

    test("书关掉了数值或秘密时，普通章与整理的已有记录都不列对应的一节（ingest.md 输出 18）", () => {
        const dataset = longBook();
        const chapter25 = dataset.sources.find(source => source.chapter === 25)!.paragraphs.join("\n");
        const titles = (features: {ledger: boolean; secrets: boolean}) => {
            const book = {...dataset, book: {...dataset.book, features}};
            return [renderContext(book, 24, {text: chapter25}), renderContext(book, 24)].map(text => ({secrets: text.includes("## 秘密与知情"), ledger: text.includes("## 当前状态")}));
        };
        expect(titles({ledger: true, secrets: true})).toEqual([{secrets: true, ledger: true}, {secrets: true, ledger: true}]);
        expect(titles({ledger: false, secrets: true})).toEqual([{secrets: true, ledger: false}, {secrets: true, ledger: false}]);
        expect(titles({ledger: true, secrets: false})).toEqual([{secrets: false, ledger: true}, {secrets: false, ledger: true}]);
    });

    test("说法按规则缩减：样例书第 98 章不超过上限，挂在列出的秘密上的与作者声明都在", async () => {
        const sample = await sampleDataset();
        const chapter99 = sample.sources.find(source => source.chapter === 99)!.paragraphs.join("\n");
        const text = renderContext(sample, 98, {text: chapter99});
        const lines = section(text, "已有的说法").filter(line => /^s\d+-\d+　/u.test(line));
        expect(lines.reduce((sum, line) => sum + line.length + 1, 0)).toBeLessThanOrEqual(8000);
        const listed = new Set(lines.map(line => line.split("　")[0]));
        const secrets = section(text, "秘密与知情").map(line => /^(x\d+-\d+)　/u.exec(line)?.[1]).filter(id => id !== undefined);
        expect(secrets.length).toBeGreaterThan(0);
        for (const id of secrets) for (const statement of sample.secrets.find(secret => secret.id === id)!.statements) expect({secret: id, statement, listed: listed.has(statement)}).toEqual({secret: id, statement, listed: true});
        expect(listed.has("s1-1")).toBe(true);
    }, 30_000);
});
