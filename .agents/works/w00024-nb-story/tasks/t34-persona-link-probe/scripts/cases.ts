/**
 * t34 的用例与冻结的金标（plan.md 的“用例与冻结的金标”“触发规则”）。
 *
 *   bun cases.ts            生成 evidences/gold.json 并打印摘要（金标冻结后不再重跑覆盖；要改先在 README 记原因）
 *
 * 两本书：魔女学院（t33 的 graph-164.json，用到第 30 章）与样例书（sampleDataset，100 章）。
 */

import {writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {Dataset, Entity, Statement} from "../../../../../../packages/nb-story/src/core/dataset";
import {sampleDataset} from "../../../../../../packages/nb-story/testing/sample";
import {GRAPH as WITCH_GRAPH} from "../../t33-graph-issue-reports/scripts/shared";

export const GOLD = join(import.meta.dir, "../evidences/gold.json");

export type BookId = "witch" | "sample";
export const LAST: Record<BookId, number> = {witch: 30, sample: 100};

export async function loadBook(book: BookId): Promise<Dataset> {
    return book === "witch" ? ((await Bun.file(WITCH_GRAPH).json()) as Dataset) : sampleDataset();
}

const ACTOR = new Set(["person", "persona"]);

/** 有效身份边：identity、非否定、about 恰好两个不同对象且两端都是人物或马甲（规则 rules.md 的要求，比产品的 identityLinkOf 严）。 */
export function validEdge(statement: Statement, kindOf: (id: string) => string | undefined): {a: string; b: string; certain: boolean} | null {
    if (statement.family !== "identity" || statement.neg || statement.about.length !== 2) return null;
    const [a, b] = statement.about as [string, string];
    if (a === b || !ACTOR.has(kindOf(a) ?? "") || !ACTOR.has(kindOf(b) ?? "")) return null;
    return {a, b, certain: statement.certainty === "certain" && (statement.kind === "fact" || statement.kind === "belief")};
}

/** 截至第 k 章可见的称呼（长度至少 2，单字称呼在原文里匹配太宽）。 */
export const namesAt = (entity: Entity, chapter: number) => entity.names.filter(name => name.at.chapter <= chapter && name.text.length >= 2).map(name => name.text);

export type CaseKind = "masked" | "real" | "not-persona" | "never";
export type Stratum = "explicit" | "label" | "inferred" | null;

export interface Answer {
    entity: string;
    certainFrom: number;
    candidateFrom: number;
}

const answer = (entity: string, certainFrom: number, candidateFrom = certainFrom): Answer => ({entity, certainFrom, candidateFrom});

export interface Case {
    id: string;
    book: BookId;
    entity: string;
    kind: CaseKind;
    /** 揭示章：允许答案里最早可以确定的那章；“不是马甲”与“一直没揭示”为 null。 */
    reveal: number | null;
    /**
     * 允许的答案，各带自己从哪章起可以确定（certainFrom）、从哪章起可以有根据地猜（candidateFrom）；按原文人工核定，跑前冻结
     * （设计审查第 2 轮第 1、2 条：不用字串共现判“已明说”）。`not-persona` 也可以是答案。
     */
    answers: Answer[];
    /** 遮掉的 identity 说法（只在实验副本里删）。 */
    masked: string[];
    stratum: Stratum;
    /** 按触发规则要问的章。 */
    triggers: number[];
    revealTriggered: boolean | null;
    note?: string;
}

/** 魔女学院按 t33 金标手工定的用例；`e1-3` 只有一条错记成身份的 `s2-7`（t33 G2），不做用例。 */
const WITCH_MANUAL: Omit<Case, "triggers" | "revealTriggered" | "book">[] = [
    {id: "witch-e18-1", entity: "e18-1", kind: "real", reveal: 19, answers: [answer("e19-1", 19)], masked: [], stratum: "inferred", note: "真实漏连（t33 G1），19.33 隐含揭示"},
    {id: "witch-e4-1", entity: "e4-1", kind: "not-persona", reveal: null, answers: [answer("not-persona", 4)], masked: [], stratum: null, note: "t33 G4"},
    {id: "witch-e4-2", entity: "e4-2", kind: "not-persona", reveal: null, answers: [answer("not-persona", 4)], masked: [], stratum: null, note: "t33 G5"},
    {id: "witch-e10-4", entity: "e10-4", kind: "not-persona", reveal: null, answers: [answer("not-persona", 10)], masked: [], stratum: null, note: "t33 G3"},
];
const WITCH_EXCLUDE = new Set(["e1-3", ...WITCH_MANUAL.map(item => item.entity)]);

/**
 * 遮掉用例的允许答案与揭示章，按原文人工核定（2026-10-28，跑模型前）：最终图里有几条身份说法记错了（魔女学院 `s2-7`；样例书
 * `s57-13` 把“流星”、`s92-20` 把粉红魔法少女连到了苏天晴），确定边的闭包会把不同的人连在一起，不能直接当答案。
 * 样例书的南嘉鱼没有建人物，本人被建成了马甲 `e8-2`（猫女兽人），`e10-1`、`e30-1`、`e33-1` 是她的另外几个身份，链上互相算对；
 * `e8-2` 答“不是马甲”也算对。`e30-1`、`e33-1` 的揭示取 33.x 深蓝猫娘自报代号（`s33-17`），`e90-1` 取 `s93-26`。
 */
const CURATED: Record<string, Answer[]> = {
    "witch-e6-4": [answer("e5-1", 6)],
    "witch-e6-5": [answer("e1-1", 6)],
    "witch-e7-1": [answer("e1-4", 7)],
    "witch-e24-3": [answer("e24-2", 24)],
    "sample-e3-2": [answer("e4-1", 4)],
    "sample-e6-2": [answer("e1-1", 6)],
    // 南嘉鱼一链：10.x 写她暗中以反派身份活动（e8-2—e10-1）；30.x 旁白猜深蓝猫娘可能就是她（s30-13，候选）；33.x 深蓝猫娘自报
    // 代号地狱伯劳（e30-1—e33-1）；37.8“地狱猫——或者说南嘉鱼”才把深蓝猫娘与南嘉鱼连上。
    "sample-e8-2": [answer("e10-1", 10), answer("e30-1", 37, 30), answer("e33-1", 37), answer("not-persona", 8)],
    "sample-e10-1": [answer("e8-2", 10), answer("e30-1", 37, 30), answer("e33-1", 37)],
    "sample-e26-2": [answer("e12-5", 27)],
    "sample-e30-1": [answer("e33-1", 33), answer("e8-2", 37, 30), answer("e10-1", 37, 30)],
    "sample-e33-1": [answer("e30-1", 33), answer("e8-2", 37), answer("e10-1", 37)],
    "sample-e66-1": [answer("e53-1", 66)],
    "sample-e90-1": [answer("e78-1", 93)],
};
/** 没有任何身份说法、但原文或标签已经点明的马甲：按真实漏连处理。样例书 `e5-1` 的标签就是“苏天晴为新魔法少女身份考虑的代号”（5.37-45）。 */
const REAL: Record<string, Answer[]> = {
    "sample-e5-1": [answer("e1-1", 5), answer("e6-2", 6)],
};
/** 不算有效边的说法：记错成身份的（见上）。 */
const WRONG_EDGES = new Set(["s2-7", "s57-13", "s92-20"]);

function casesFor(book: BookId, graph: Dataset): Case[] {
    const last = LAST[book];
    const entityById = new Map(graph.entities.map(entity => [entity.id, entity]));
    const kindOf = (id: string) => entityById.get(id)?.kind;
    const inRange = (statement: Statement) => statement.at.chapter <= last;
    const edges = graph.statements.filter(inRange).flatMap(statement => {
        const edge = WRONG_EDGES.has(statement.id) ? null : validEdge(statement, kindOf);
        return edge ? [{...edge, statement}] : [];
    });
    const out: Case[] = [];
    const personas = graph.entities.filter(entity => entity.kind === "persona" && entity.at.chapter <= last);
    for (const persona of personas) {
        if (book === "witch" && WITCH_EXCLUDE.has(persona.id)) continue;
        const mine = graph.statements.filter(statement => statement.family === "identity" && statement.about.includes(persona.id));
        const certain = edges.filter(edge => edge.certain && (edge.a === persona.id || edge.b === persona.id));
        const curated = CURATED[`${book}-${persona.id}`];
        const real = REAL[`${book}-${persona.id}`];
        if (curated) {
            const reveal = Math.min(...curated.filter(item => item.entity !== "not-persona").map(item => item.certainFrom));
            const revealing = mine.filter(statement => statement.at.chapter === reveal);
            const ids = curated.filter(item => item.certainFrom === reveal && item.entity !== "not-persona").map(item => item.entity);
            out.push({id: `${book}-${persona.id}`, book, entity: persona.id, kind: "masked", reveal, answers: curated, masked: mine.map(item => item.id), stratum: stratumOf(graph, persona, ids, revealing, reveal), triggers: [], revealTriggered: null});
        } else if (real) {
            out.push({id: `${book}-${persona.id}`, book, entity: persona.id, kind: "real", reveal: Math.min(...real.map(item => item.certainFrom)), answers: real, masked: [], stratum: "label", triggers: [], revealTriggered: null, note: "没有身份说法，标签已点明"});
        } else if (certain.length) {
            throw new Error(`${book}-${persona.id} 有确定身份说法但没有人工核定的答案`);
        } else if (!mine.length) {
            out.push({id: `${book}-${persona.id}`, book, entity: persona.id, kind: "never", reveal: null, answers: [], masked: [], stratum: null, triggers: [], revealTriggered: null});
        } else {
            // 只有候选边或无效边：不做用例，在摘要里列出来（计划第 2 版的“候选用例”在两本书里都没有出现时就是空的）。
            out.push({id: `${book}-${persona.id}`, book, entity: persona.id, kind: "never", reveal: null, answers: [], masked: [], stratum: null, triggers: [], revealTriggered: null, note: `只有候选或无效的身份说法：${mine.map(item => item.id).join("、")}；按一直没揭示对照，答 candidate 不算错`});
        }
    }
    if (book === "witch") for (const manual of WITCH_MANUAL) out.push({...manual, book, triggers: [], revealTriggered: null});

    for (const item of out) {
        const persona = entityById.get(item.entity)!;
        const masked = new Set(item.masked);
        for (let chapter = persona.at.chapter; chapter <= last; chapter++) {
            const text = graph.sources.find(source => source.chapter === chapter)!.paragraphs.join("\n");
            const named = namesAt(persona, chapter).some(name => text.includes(name));
            const created = graph.entities.some(entity => entity.at.chapter === chapter && ACTOR.has(entity.kind) && entity.id !== persona.id);
            if (named || created) item.triggers.push(chapter);
        }
        if (item.reveal !== null) item.revealTriggered = item.triggers.includes(item.reveal);
        // 遮掉之后，揭示章之前不应有涉及它的有效确定边（遮掉的就是全部涉及它的身份说法，这里防遮漏）。
        const leftover = graph.statements.filter(statement => !masked.has(statement.id) && statement.at.chapter <= last && validEdge(statement, kindOf)?.certain && statement.about.includes(item.entity));
        if (item.kind === "masked" && leftover.length) throw new Error(`${item.id} 遮掉后仍有确定身份说法 ${leftover.map(statement => statement.id).join("、")}`);
    }
    return out;
}

/** 泄漏分层（plan.md）：揭示章的身份说法的出处段落里同时出现双方称呼为 explicit；答案称呼出现在马甲的标签或称呼备注里为 label；否则 inferred。 */
function stratumOf(graph: Dataset, persona: Entity, allowed: string[], revealing: Statement[], reveal: number): Stratum {
    const entityById = new Map(graph.entities.map(entity => [entity.id, entity]));
    const answerNames = allowed.flatMap(id => namesAt(entityById.get(id)!, reveal));
    const own = namesAt(persona, reveal);
    for (const statement of revealing) for (const range of statement.source.evidence) {
        const source = graph.sources.find(item => item.chapter === range.chapter);
        for (let index = range.from; index <= range.to; index++) {
            const text = source?.paragraphs[index - 1] ?? "";
            if (own.some(name => text.includes(name)) && answerNames.some(name => text.includes(name))) return "explicit";
        }
    }
    const own_text = [persona.label, ...persona.names.map(name => name.note ?? "")].join("；");
    if (answerNames.some(name => own_text.includes(name))) return "label";
    return "inferred";
}

export async function allCases(): Promise<Case[]> {
    return [...casesFor("witch", await loadBook("witch")), ...casesFor("sample", await loadBook("sample"))];
}

if (import.meta.main) {
    const cases = await allCases();
    await writeFile(GOLD, `${JSON.stringify(cases, null, 1)}\n`);
    for (const item of cases) console.log(`${item.id} ${item.kind} 揭示 ${item.reveal ?? "-"} 答案 ${item.answers.map(answer => `${answer.entity}@${answer.certainFrom}${answer.candidateFrom !== answer.certainFrom ? `/猜${answer.candidateFrom}` : ""}`).join(",") || "-"} 分层 ${item.stratum ?? "-"} 遮 ${item.masked.length} 触发 ${item.triggers.length} 章${item.revealTriggered === false ? "（漏触发揭示章）" : ""}${item.note ? `｜${item.note}` : ""}`);
    console.log(`用例 ${cases.length} 个，触发合计 ${cases.reduce((sum, item) => sum + item.triggers.length, 0)} 次`);
}
