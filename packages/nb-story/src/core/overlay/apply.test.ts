/**
 * 套用修订（docs/specs/story/revisions.md 输出 1 到 6、11）。数据是样例书：第 30 章末有一条候选身份说法 s30-13
 * （深蓝猫娘可能就是南嘉鱼的反派身份），e3-2 是第 3 章起的马甲“风信子”。
 */

import {beforeAll, describe, expect, test} from "bun:test";

import {sampleDataset} from "../../../testing/sample";
import {buildBookIndex} from "../book-index";
import type {BookIndex} from "../book-index";
import type {Dataset, Position} from "../dataset";
import type {BookMeta} from "../library";
import {BookView} from "../projection";
import {entityAnchor, resolveEntityAnchor, statementAnchor} from "./anchor";
import {applyOverlay} from "./apply";
import type {OverlayFile, Revision} from "./schema";

const META = {id: "fox", generation: "g"} as BookMeta;
let sample: Dataset;
beforeAll(async () => {
    sample = await sampleDataset();
});

const at = (chapter: number, paragraph: number): Position => ({chapter, paragraph});
const NOW = "2026-10-28T00:00:00.000Z";
let counter = 0;
function make(partial: Omit<Revision, "id" | "state" | "source" | "by" | "createdAt" | "decidedAt" | "history"> & Partial<Pick<Revision, "id" | "state" | "source">>): Revision {
    counter += 1;
    return {id: `r${counter}`, state: "adopted", source: "user", by: "user", createdAt: NOW, decidedAt: NOW, history: [], ...partial} as Revision;
}
const file = (...items: Revision[]): OverlayFile => ({format: 1, generation: "g", version: 1, items});
const entity = (id: string) => sample.entities.find(item => item.id === id)!;
const statement = (id: string) => sample.statements.find(item => item.id === id)!;
const confirm = (id: string) => make({op: "identity.confirm", params: {statement: id}, evidence: statement(id).at, anchors: [statementAnchor(statement(id))]});
const reject = (id: string) => make({op: "identity.reject", state: "rejected", params: {statement: id}, evidence: statement(id).at, anchors: [statementAnchor(statement(id))]});
const view = (index: BookIndex, chapter: number, paragraph: number) => new BookView(index, at(chapter, paragraph));

describe("没有修订", () => {
    test("原样返回同一个数据集，结果与没有这一层时相同", () => {
        expect(applyOverlay(sample, null).dataset).toBe(sample);
        expect(applyOverlay(sample, file()).dataset).toBe(sample);
        expect(applyOverlay(sample, file(make({op: "identity.confirm", state: "withdrawn", params: {statement: "s30-13"}, evidence: at(30, 61), anchors: [statementAnchor(statement("s30-13"))]}))).dataset).toBe(sample);
    });
});

describe("确认与驳回候选身份", () => {
    test("确认：说法变成确定，身份连接按确定算；原数据不被改动；位置不变所以之前的阅读位置看不到它", () => {
        const index = buildBookIndex(META, sample, file(confirm("s30-13")));
        const link = index.identityLinks.find(item => item.statement.id === "s30-13")!;
        expect(link.certain).toBe(true);
        expect(view(index, 30, 61).statement("s30-13")!.certainty).toBe("certain");
        expect(view(index, 30, 61).statement("s30-13")!.revision).toBeDefined();
        expect(view(index, 30, 60).statement("s30-13")).toBeUndefined();
        expect(statement("s30-13").certainty).toBe("candidate");
        expect(buildBookIndex(META, sample).identityLinks.find(item => item.statement.id === "s30-13")!.certain).toBe(false);
    });

    test("已经是确定的说法：确认没有可改的，记为 inactive", () => {
        const certain = sample.statements.find(item => item.family === "identity" && item.certainty === "certain")!;
        const result = applyOverlay(sample, file(make({op: "identity.confirm", params: {statement: certain.id}, evidence: certain.at, anchors: [statementAnchor(certain)]})));
        expect([...result.resolved.values()]).toEqual(["inactive"]);
    });

    test("驳回：说法在所有查询里不存在，别的记录对它的引用一起清掉", () => {
        const withRefs: Dataset = {
            ...sample,
            statements: sample.statements.map(item => (item.id === "s30-14" ? {...item, premises: [...item.premises, "s30-13"], rel: [...item.rel, {type: "confirms" as const, to: "s30-13"}]} : item)),
            knowledge: [...sample.knowledge, {id: "kx-1", who: "e1-1", about: "s30-13", state: "knows", evidence: [], basis: "inferred", at: at(30, 61), derived: false}],
            secrets: sample.secrets.map((secret, i) => (i === 0 ? {...secret, statements: [...secret.statements, "s30-13"]} : secret)),
            questions: sample.questions.map((question, i) => (i === 0 ? {...question, updates: [...question.updates, {type: "answered" as const, evidence: [], answer: "s30-13", at: at(30, 61)}]} : question)),
        };
        const result = applyOverlay(withRefs, file(reject("s30-13")));
        const ds = result.dataset;
        const ids = new Set(ds.statements.map(item => item.id));
        expect(ids.has("s30-13")).toBe(false);
        expect(ds.statements.flatMap(item => [...item.premises, ...item.rel.map(rel => rel.to)])).not.toContain("s30-13");
        expect(ds.secrets.flatMap(secret => secret.statements)).not.toContain("s30-13");
        expect(ds.knowledge.map(item => item.about)).not.toContain("s30-13");
        expect(ds.questions.flatMap(question => question.updates.map(update => update.answer))).not.toContain("s30-13");
        const index = buildBookIndex(META, withRefs, file(reject("s30-13")));
        expect(index.identityLinks.some(item => item.statement.id === "s30-13")).toBe(false);
        expect(view(index, 40, 1).statement("s30-13")).toBeUndefined();
    });
});

describe("手动连两个对象", () => {
    test("新写一条身份说法：位置是依据位置，之前的阅读位置看不到；文字用依据位置上的显示名", () => {
        const a = entity("e3-2"), b = entity("e1-1");
        const revision = make({op: "identity.link", params: {a: a.id, b: b.id, certainty: "certain", statement: "u1"}, evidence: at(10, 1), anchors: [entityAnchor(a), entityAnchor(b)]});
        const index = buildBookIndex(META, sample, file(revision));
        expect(view(index, 9, 1).statement("u1")).toBeUndefined();
        const made = view(index, 10, 1).statement("u1")!;
        expect(made.family).toBe("identity");
        expect(made.certainty).toBe("certain");
        expect(made.about).toEqual(["e3-2", "e1-1"]);
        expect(made.text).toMatch(/就是/u);
        expect(made.revision).toBe(revision.id);
        expect(index.identityLinks.find(item => item.statement.id === "u1")!.certain).toBe(true);
    });
});

describe("改对象种类", () => {
    test("依据位置之前仍是原来的种类，依据位置及之后是新种类", () => {
        const target = entity("e3-2");
        expect(target.kind).toBe("persona");
        const index = buildBookIndex(META, sample, file(make({op: "kind.set", params: {entity: "e3-2", kind: "person"}, evidence: at(10, 1), anchors: [entityAnchor(target)]})));
        expect(view(index, 9, 50).entity("e3-2")!.kind).toBe("persona");
        expect(view(index, 10, 1).entity("e3-2")!.kind).toBe("person");
        expect(view(index, 40, 1).entity("e3-2")!.kind).toBe("person");
        expect(index.dataset.entities.find(item => item.id === "e3-2")!.kindFrom).toEqual([{at: at(10, 1), kind: "person"}]);
    });
});

describe("挪称呼", () => {
    test("依据位置之前的出现不变，之后的出现与称呼归 to；from 去掉不早于依据位置的称呼记录", () => {
        const from = entity("e1-1"), to = entity("e3-2");
        const evidence = at(20, 1);
        const text = [...new Set(sample.mentions.filter(mention => mention.entity === from.id).map(mention => mention.text))].find(candidate => {
            const own = sample.mentions.filter(mention => mention.entity === from.id && mention.text === candidate);
            return own.some(mention => mention.at.chapter < 20) && own.some(mention => mention.at.chapter >= 20);
        })!;
        expect(text).toBeDefined();
        const revision = make({op: "name.move", params: {text, from: from.id, to: to.id}, evidence, anchors: [entityAnchor(from), entityAnchor(to)]});
        const result = applyOverlay(sample, file(revision)).dataset;
        const before = sample.mentions.filter(mention => mention.entity === from.id && mention.text === text);
        for (const mention of before) {
            const now = result.mentions.find(item => item.at.chapter === mention.at.chapter && item.at.paragraph === mention.at.paragraph && item.start === mention.start && item.text === text)!;
            expect(now.entity).toBe(mention.at.chapter >= 20 ? to.id : from.id);
        }
        const resultTo = result.entities.find(item => item.id === to.id)!;
        expect(resultTo.names.filter(name => name.text === text).map(name => name.at)).toContainEqual(evidence);
        const resultFrom = result.entities.find(item => item.id === from.id)!;
        expect(resultFrom.names.filter(name => name.text === text).every(name => name.at.chapter < 20)).toBe(true);
    });

    test("to 在依据位置已经有同文字的称呼时不重复添加", () => {
        const from = entity("e1-1"), to = entity("e3-2");
        const dup = to.names[0]!.text;
        const withName: Dataset = {...sample, entities: sample.entities.map(item => (item.id === from.id ? {...item, names: [...item.names, {text: dup, at: at(15, 1), primary: false}]} : item))};
        const revision = make({op: "name.move", params: {text: dup, from: from.id, to: to.id}, evidence: at(20, 1), anchors: [entityAnchor(from), entityAnchor(to)]});
        const out = applyOverlay(withName, file(revision)).dataset.entities.find(item => item.id === to.id)!;
        expect(out.names.filter(name => name.text === dup)).toHaveLength(to.names.filter(name => name.text === dup).length);
    });
});

describe("锚：对不上记 stale，整理合并后跟着走", () => {
    test("说法的文字变了、对象的位置变了：stale，不套用", () => {
        const changed: Dataset = {...sample, statements: sample.statements.map(item => (item.id === "s30-13" ? {...item, text: "别的话。"} : item))};
        const stale = applyOverlay(changed, file(confirm("s30-13")));
        expect(stale.resolved.get([...stale.resolved.keys()][0]!)).toBe("stale");
        expect(stale.dataset.statements.find(item => item.id === "s30-13")!.certainty).toBe("candidate");
        const moved: Dataset = {...sample, entities: sample.entities.map(item => (item.id === "e3-2" ? {...item, at: at(3, 11)} : item))};
        expect(resolveEntityAnchor(moved, entityAnchor(entity("e3-2")))).toBeNull();
    });

    test("对象被整理并进另一个对象后，按 mergedFrom 认到留下的那个", () => {
        const merged: Dataset = {
            ...sample,
            entities: sample.entities.filter(item => item.id !== "e3-2").map(item => (item.id === "e1-1" ? {...item, mergedFrom: [...item.mergedFrom, "e3-2"]} : item)),
        };
        expect(resolveEntityAnchor(merged, entityAnchor(entity("e3-2")))?.id).toBe("e1-1");
    });

    test("id 变了但位置与最早的称呼唯一对得上时，按位置认", () => {
        const renamed: Dataset = {...sample, entities: sample.entities.map(item => (item.id === "e3-2" ? {...item, id: "e3-99"} : item))};
        expect(resolveEntityAnchor(renamed, entityAnchor(entity("e3-2")))?.id).toBe("e3-99");
    });
});
