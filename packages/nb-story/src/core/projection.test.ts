/**
 * 深投影（docs/specs/story/queries.md 输出 1）：父记录可见、子项或引用不可见时，子项与引用不出现。
 * 这些子项的可见性由视图统一保证，各查询直接用视图的结果，所以在视图上测一次。
 */

import {beforeAll, describe, expect, test} from "bun:test";

import {sampleDataset, smallDataset} from "../../testing/sample";
import {buildBookIndex} from "./book-index";
import type {BookIndex} from "./book-index";
import type {BookMeta} from "./library";
import {BookView} from "./projection";

const META = {id: "fox", generation: "g"} as BookMeta;
let index: BookIndex;

beforeAll(async () => {
    index = buildBookIndex(META, await sampleDataset());
});

describe("自带位置的子项按自己的位置过滤", () => {
    test("对象的称呼：第 7 章时苏天晴没有第 8 章才有的“心月狐”", () => {
        const names = new BookView(index, {chapter: 7, paragraph: 1}).entity("e1-1")!.names.map(name => name.text);
        expect(names).not.toContain("心月狐");
        expect(new BookView(index, {chapter: 9, paragraph: 1}).entity("e1-1")!.names.map(name => name.text)).toContain("心月狐");
    });

    test("悬念进展：只到阅读位置为止", () => {
        const at20 = new BookView(index, {chapter: 20, paragraph: 1}).questions.find(question => question.id === "q8-2")!;
        expect(at20.updates.every(update => update.at.chapter <= 20)).toBe(true);
        const at30 = new BookView(index, {chapter: 30, paragraph: 1}).questions.find(question => question.id === "q8-2")!;
        expect(at30.updates.length).toBeGreaterThan(at20.updates.length);
    });

    test("情节连接：两端都已可见、连接本身后来才补上时，补上之前不出现", () => {
        const links = (paragraph: number) => new BookView(index, {chapter: 37, paragraph}).episode("p37-1")!.links.map(link => link.type);
        expect(links(60)).toEqual(["continues"]);
        expect(links(114)).toEqual(["continues", "after"]);
    });

    test("时间点的钟点比时间点交代得晚时，交代之前不出现", async () => {
        const dataset = await smallDataset(3, "clock");
        const time = dataset.times.find(item => item.at.chapter === 3)!;
        time.clock = "21:00";
        time.clockAt = {chapter: 3, paragraph: time.at.paragraph + 1};
        const small = buildBookIndex(META, dataset);
        expect(new BookView(small, time.at).time(time.id)!.clock).toBeUndefined();
        expect(new BookView(small, time.clockAt).time(time.id)!.clock).toBe("21:00");
    });
});

describe("指向不可见记录的引用整项省略", () => {
    test("知情记录所指的说法还不可见时整条不给", () => {
        const view = new BookView(index, {chapter: 38, paragraph: 57});
        expect(view.knowledge.every(item => view.statement(item.about) !== undefined || view.secret(item.about) !== undefined)).toBe(true);
    });

    test("秘密名下只列已可见的说法", () => {
        const view = new BookView(index, {chapter: 30, paragraph: 61});
        expect(view.secret("x30-1")!.statements).toEqual(["s30-13"]);
    });

    test("主线只取最近一批，所含情节只留可见的", () => {
        const view = new BookView(index, {chapter: 38, paragraph: 57});
        expect(view.arcs.through).toBe(35);
        expect(view.arcs.arcs.every(arc => arc.through === 35)).toBe(true);
        expect(view.arcs.arcs.flatMap(arc => arc.episodes).every(id => view.episode(id) !== undefined)).toBe(true);
    });
});
