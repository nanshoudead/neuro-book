/**
 * 待确认列表（docs/specs/story/revisions.md 输出 7、8、16）。样例书里有三条候选身份说法：s21-2（苏天晴与魔法少女狐狐，
 * 这一对在第 8 章已有确定的身份说法）、s27-6（第 27 章第 90 段起有确定的）、s30-13（这一对从来没有确定的）。
 */

import {beforeAll, describe, expect, test} from "bun:test";

import {sampleDataset} from "../../../testing/sample";
import type {Dataset, Position} from "../dataset";
import {entityAnchor, statementAnchor} from "./anchor";
import {applyOverlay} from "./apply";
import {listItems} from "./items";
import type {OverlayFile, Revision} from "./schema";

let sample: Dataset;
beforeAll(async () => {
    sample = await sampleDataset();
});

const at = (chapter: number, paragraph: number): Position => ({chapter, paragraph});
const NOW = "2026-10-28T00:00:00.000Z";
let counter = 0;
function make(partial: Omit<Revision, "id" | "state" | "source" | "by" | "createdAt" | "decidedAt" | "history"> & Partial<Pick<Revision, "state">>): Revision {
    counter += 1;
    return {id: `r${counter}`, state: "adopted", source: "user", by: "user", createdAt: NOW, decidedAt: NOW, history: [], ...partial} as Revision;
}
const statement = (id: string) => sample.statements.find(item => item.id === id)!;
const decision = (op: "identity.confirm" | "identity.reject", id: string): Revision => make({op, state: op === "identity.reject" ? "rejected" : "adopted", params: {statement: id}, evidence: statement(id).at, anchors: [statementAnchor(statement(id))]});
function list(position: Position, ...items: Revision[]) {
    const file: OverlayFile | null = items.length ? {format: 1, generation: "g", version: 1, items} : null;
    const {resolved} = applyOverlay(sample, file);
    return listItems(sample, file, resolved, position);
}

describe("待确认列表", () => {
    test("只列阅读位置可见的候选，按依据位置排序；来源按 origin 区分", () => {
        const early = list(at(26, 1));
        expect(early.items.map(item => item.id)).toEqual(["st:s21-2"]);
        const late = list(at(30, 61));
        expect(late.items.map(item => item.id)).toEqual(["st:s21-2", "st:s27-6", "st:s30-13"]);
        expect(late.items.every(item => item.source === "extraction")).toBe(true);
        expect(list(at(27, 30)).items.map(item => item.id)).toEqual(["st:s21-2", "st:s27-6"]);
        expect(late.items.find(item => item.id === "st:s30-13")).toMatchObject({state: "pending", op: "identity.candidate", evidence: "30.61", undoable: false});
        expect(late.items.find(item => item.id === "st:s30-13")!.summary).toBe(statement("s30-13").text);
        const tagged: Dataset = {...sample, statements: sample.statements.map(item => (item.id === "s30-13" ? {...item, origin: "persona-check" as const} : item))};
        const {resolved} = applyOverlay(tagged, null);
        expect(listItems(tagged, null, resolved, at(30, 61)).items.find(item => item.id === "st:s30-13")!.source).toBe("persona-check");
    });

    test("这一对对象在阅读位置已有确定的身份说法：后文已确认（closed），不在待确认里；还没读到那一句时仍待确认", () => {
        const late = list(at(30, 61));
        expect(late.items.find(item => item.id === "st:s21-2")!.state).toBe("closed");
        expect(late.items.find(item => item.id === "st:s27-6")!.state).toBe("closed");
        expect(late.counts).toMatchObject({pending: 1, closed: 2});
        const before = list(at(27, 89));
        expect(before.items.find(item => item.id === "st:s27-6")!.state).toBe("pending");
        expect(list(at(27, 90)).items.find(item => item.id === "st:s27-6")!.state).toBe("closed");
    });

    test("确认与驳回：列在已处理，保留原说法的文字与出处，可撤销；套用后的图里没有候选也照样列出", () => {
        const confirmed = list(at(30, 61), decision("identity.confirm", "s30-13"));
        expect(confirmed.items.find(item => item.state === "adopted")).toMatchObject({op: "identity.confirm", summary: statement("s30-13").text, undoable: true, evidence: "30.61"});
        expect(confirmed.counts).toMatchObject({pending: 0, adopted: 1});
        const rejected = list(at(30, 61), decision("identity.reject", "s30-13"));
        expect(rejected.items.find(item => item.state === "rejected")).toMatchObject({op: "identity.reject", summary: statement("s30-13").text, undoable: true});
        expect(rejected.items.some(item => item.id === "st:s30-13")).toBe(false);
    });

    test("决定所指的候选在阅读位置还不可见时不列", () => {
        const result = list(at(28, 1), decision("identity.confirm", "s30-13"));
        expect(result.items.map(item => item.id)).toEqual(["st:s21-2", "st:s27-6"]);
    });

    test("撤销了的修订不列；对不上锚的是 stale，优先于决定", () => {
        const withdrawn = {...decision("identity.confirm", "s30-13"), state: "withdrawn" as const};
        expect(list(at(30, 61), withdrawn).items.find(item => item.id === "st:s30-13")!.state).toBe("pending");
        const changed: Dataset = {...sample, statements: sample.statements.map(item => (item.id === "s30-13" ? {...item, text: "别的话。"} : item))};
        const revision = decision("identity.confirm", "s30-13");
        const file: OverlayFile = {format: 1, generation: "g", version: 1, items: [revision]};
        const {resolved} = applyOverlay(changed, file);
        const result = listItems(changed, file, resolved, at(30, 61));
        expect(result.items.find(item => item.id === revision.id)).toMatchObject({state: "stale", undoable: true, summary: statement("s30-13").text});
        // 对不上的决定仍带着原说法挂靠的对象，按对象筛（人物卡）才找得到它。
        expect(result.items.find(item => item.id === revision.id)!.entities.map(entity => entity.id)).toEqual(["e30-1", "e10-1"]);
        expect(result.counts.stale).toBe(1);
    });

    test("用户自己的修订按依据位置可见，写出一句话概括", () => {
        const e3 = sample.entities.find(item => item.id === "e3-2")!;
        const kind = make({op: "kind.set", params: {entity: "e3-2", kind: "person"}, evidence: at(10, 1), anchors: [entityAnchor(e3)]});
        expect(list(at(9, 1), kind).items.some(item => item.id === kind.id)).toBe(false);
        const shown = list(at(30, 61), kind).items.find(item => item.id === kind.id)!;
        expect(shown).toMatchObject({state: "adopted", source: "user", undoable: true});
        expect(shown.summary).toContain("人物");
    });
});
