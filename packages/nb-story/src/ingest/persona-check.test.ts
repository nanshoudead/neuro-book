/**
 * 马甲核对的选择、请求与写入（docs/specs/story/ingest.md 输出 20）。数据用样例书截到第 k 章（只留 k 章及之前成立的记录与称呼），
 * 与抽取时“加上本章草稿编出的书”的样子相同。
 */

import {describe, expect, test} from "bun:test";

import {sampleDataset} from "../../testing/sample";
import type {Dataset, Entity} from "../core/dataset";
import {EMPTY_HISTORY, nextStatementId, parseVerdict, PERSONA_LIMIT, personaRequest, pickPersonas, toStatement, type Verdict} from "./persona-check";

/** 截到第 k 章：顶层记录按位置，称呼也按位置。 */
function upTo(dataset: Dataset, chapter: number): Dataset {
    const keep = <T extends {at: {chapter: number}}>(items: T[]) => items.filter(item => item.at.chapter <= chapter);
    return {
        ...dataset,
        sources: dataset.sources.filter(source => source.chapter <= chapter),
        entities: keep(dataset.entities).map(entity => ({...entity, names: entity.names.filter(name => name.at.chapter <= chapter)})),
        statements: keep(dataset.statements),
        secrets: keep(dataset.secrets),
        episodes: keep(dataset.episodes),
        knowledge: keep(dataset.knowledge),
    };
}

const persona = (id: string, chapter: number, names: string[]): Entity => ({id, kind: "persona", label: `测试马甲 ${id}`, at: {chapter, paragraph: 1}, names: names.map(text => ({text, at: {chapter, paragraph: 1}, primary: true}))}) as Entity;
const same = (entity: string, current: string[]): Verdict => ({verdict: "same", entity, current, reason: "测试"});

describe("选哪些马甲（输出 20）", () => {
    test("本章新建的马甲、还没连上任何人：问；同一个马甲在揭示身份的那章之后已经有身份说法：不再问", async () => {
        const sample = await sampleDataset();
        const third = upTo(sample, 3);
        expect(pickPersonas(third, 3, third.sources[2]!.paragraphs, EMPTY_HISTORY).map(entity => entity.id)).toContain("e3-2");
        // 第 4 章写下“风信子的真名是南小风”（s4-1）。
        const fourth = upTo(sample, 4);
        expect(pickPersonas(fourth, 4, fourth.sources[3]!.paragraphs, EMPTY_HISTORY).map(entity => entity.id)).not.toContain("e3-2");
    });

    test("称呼全是泛称（含“志愿者学姐”这类复合泛称）、答过不是马甲的：不问；泛称出现在原文里不算触发", async () => {
        const sample = upTo(await sampleDataset(), 3);
        // 第 3 章没有新建对象的情形：去掉本章新建的人物与马甲，只看称呼触发。
        const quiet: Dataset = {...sample, entities: [...sample.entities.filter(entity => entity.at.chapter < 3), persona("e2-90", 2, ["志愿者学姐", "学姐"]), persona("e2-91", 2, ["风信子"])]};
        const paragraphs = ["那位志愿者学姐又来了。", "学姐说风信子今天也在。"];
        expect(pickPersonas(quiet, 3, paragraphs, EMPTY_HISTORY).map(entity => entity.id)).toEqual(["e2-91"]);
        expect(pickPersonas(quiet, 3, paragraphs, {lastAsked: new Map(), notPersona: new Set(["e2-91"])})).toEqual([]);
        expect(pickPersonas(quiet, 3, ["学姐来了。"], EMPTY_HISTORY)).toEqual([]);
    });

    test("一章至多问 5 个；上次被问得早的（没问过的最前）先问，轮得到后面的", async () => {
        const sample = upTo(await sampleDataset(), 3);
        const many = Array.from({length: 7}, (_, index) => persona(`e2-${80 + index}`, 2, [`代号${index}号`]));
        const crowded: Dataset = {...sample, entities: [...sample.entities.filter(entity => entity.at.chapter < 3), ...many]};
        const text = many.map((_, index) => `代号${index}号出场。`);
        const first = pickPersonas(crowded, 3, text, EMPTY_HISTORY).map(entity => entity.id);
        expect(first).toEqual(["e2-80", "e2-81", "e2-82", "e2-83", "e2-84"]);
        expect(first.length).toBe(PERSONA_LIMIT);
        const asked = new Map(first.map(id => [id, 3]));
        expect(pickPersonas(crowded, 4, text, {lastAsked: asked, notPersona: new Set()}).map(entity => entity.id).slice(0, 2)).toEqual(["e2-85", "e2-86"]);
    });
});

describe("请求与回复", () => {
    test("材料只到本章：没有后面章节的段落；带本章原文全文与候选", async () => {
        const sample = upTo(await sampleDataset(), 3);
        const target = sample.entities.find(entity => entity.id === "e3-2")!;
        const user = personaRequest(sample, target, 3);
        expect(user).toContain("【第 3 章原文】");
        expect(user).toContain(`3.1 ${sample.sources[2]!.paragraphs[0]}`);
        expect([...user.matchAll(/(?:^|[^\d.])(\d+)\.\d+ /gmu)].map(match => Number(match[1])).every(chapter => chapter <= 3)).toBe(true);
        expect(user).toContain("e1-1｜person");
    });

    test("本章才成立的称呼不拿去找前文：同样的字碰巧出现在前面的章里，不算它此前的出场", async () => {
        const sample = upTo(await sampleDataset(), 3);
        const coincidence = sample.sources[0]!.paragraphs[1]!.slice(0, 6);
        const target = sample.entities.find(entity => entity.id === "e3-2")!;
        const renamed = {...target, names: [...target.names, {text: coincidence, at: {chapter: 3, paragraph: 1}, primary: false}]} as Entity;
        const user = personaRequest({...sample, entities: sample.entities.map(entity => (entity.id === "e3-2" ? renamed : entity))}, renamed, 3);
        const history = user.slice(user.indexOf("【第 3 章之前提到它的段落】"), user.indexOf("【第 3 章原文】"));
        expect(history).not.toContain(coincidence);
    });

    test("不成形：不是对象、verdict 不是三者之一；其余字段缺了按空处理", () => {
        expect(parseVerdict("same")).toBeNull();
        expect(parseVerdict({verdict: "maybe"})).toBeNull();
        expect(parseVerdict({verdict: "same", entity: "e1-1"})).toEqual({verdict: "same", entity: "e1-1", current: [], reason: ""});
    });
});

describe("写进草稿的说法", () => {
    test("候选身份说法：两个对象、本章的依据、文字用依据位置的称呼", async () => {
        const sample = upTo(await sampleDataset(), 3);
        const target = sample.entities.find(entity => entity.id === "e3-2")!;
        const last = sample.sources[2]!.paragraphs.length;
        const made = toStatement(sample, target, same("e1-1", [`3.${last}`, "2.5"]), 3, last, "s3-99");
        expect("draft" in made).toBe(true);
        const draft = (made as {draft: Record<string, unknown>}).draft;
        expect(draft).toMatchObject({id: "s3-99", family: "identity", about: ["e3-2", "e1-1"], certainty: "candidate", kind: "fact", basis: "inferred", src: {at: [`3.${last}`], ch: "narrator", by: null}});
        expect(draft.text).toBe("风信子可能就是苏天晴。");
    });

    test("不写：没有本章依据、对象不在候选、依据早于对象出现、对方是同名马甲", async () => {
        const sample = upTo(await sampleDataset(), 3);
        const target = sample.entities.find(entity => entity.id === "e3-2")!;
        const last = sample.sources[2]!.paragraphs.length;
        expect("skip" in toStatement(sample, target, same("e1-1", ["2.5"]), 3, last, "s3-99")).toBe(true);
        expect("skip" in toStatement(sample, target, same("e1-1", [`3.${last + 5}`]), 3, last, "s3-99")).toBe(true);
        expect("skip" in toStatement(sample, target, same("e99-1", [`3.${last}`]), 3, last, "s3-99")).toBe(true);
        // 依据在马甲建立之前：e3-2 在第 3 章某段才出现。
        expect("skip" in toStatement(sample, target, same("e1-1", ["3.1"]), 3, last, "s3-99")).toBe(target.at.paragraph > 1);
        const twin = {...persona("e3-98", 3, ["风信子"]), at: {chapter: 3, paragraph: 1}};
        const withTwin: Dataset = {...sample, entities: [...sample.entities, twin]};
        expect("skip" in toStatement(withTwin, target, same("e3-98", [`3.${last}`]), 3, last, "s3-99")).toBe(true);
    });

    test("编号接着本章已有的说法", () => {
        expect(nextStatementId([{id: "s3-1"}, {id: "s3-7"}, {id: "s2-9"}, {}], 3)).toBe("s3-8");
        expect(nextStatementId([], 4)).toBe("s4-1");
    });
});
