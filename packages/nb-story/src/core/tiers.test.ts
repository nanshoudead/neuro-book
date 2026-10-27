/**
 * 记录等级（docs/specs/story/queries.md 的“记录等级”）：规则表、证据窗口、后文引用的口径，以及不剧透的主判据
 * “截断对照”：全量数据在 P 算的等级与依据，等于把数据截到 P 后在同一个 P 算的。
 */

import {beforeAll, describe, expect, test} from "bun:test";

import {sampleDataset} from "../../testing/sample";
import {buildBookIndex, type BookIndex} from "./book-index";
import type {Dataset, Family, Position} from "./dataset";
import type {BookMeta} from "./library";
import {visibleAt} from "./position";
import {combineTier, EVIDENCE_WINDOW, priorTier, tiersAt, type Evidence, type Tier, type TierFlag} from "./tiers";

const META = {id: "fox", generation: "g"} as BookMeta;
let dataset: Dataset;
let index: BookIndex;

beforeAll(async () => {
    dataset = await sampleDataset();
    index = buildBookIndex(META, dataset);
});

const chapterEnd = (chapter: number): Position => ({chapter, paragraph: dataset.sources[chapter - 1]!.paragraphs.length});

describe("规则表", () => {
    const columns: Evidence[] = ["unknown", "none", "some", "strong"];

    test("有先验：逐格", () => {
        const expected: Record<Tier, [Tier, TierFlag | null][]> = {
            1: [[1, null], [2, "unconfirmed"], [1, null], [1, null]],
            2: [[2, null], [2, null], [2, null], [1, null]],
            3: [[3, null], [3, null], [3, null], [2, "foreshadow"]],
        };
        for (const prior of [1, 2, 3] as const) {
            columns.forEach((ev, column) => {
                const [tier, flag] = expected[prior][column]!;
                // 先验表与类别无关。
                for (const family of ["identity", "attitude"] as const) expect(combineTier(prior, family, ev)).toEqual({tier, flag});
            });
        }
    });

    test("没有先验：按类别组逐格，不带标记，“未知”都是 2 级", () => {
        const expected: [Family, Tier[]][] = [
            ["identity", [2, 2, 1, 1]],
            ["kinship", [2, 2, 1, 1]],
            ["event", [2, 3, 2, 1]],
            ["trait", [2, 3, 2, 1]],
            ["attitude", [2, 3, 3, 2]],
            ["location", [2, 3, 3, 2]],
        ];
        for (const [family, tiers] of expected) columns.forEach((ev, column) => expect(combineTier(null, family, ev)).toEqual({tier: tiers[column]!, flag: null}));
    });

    test("数据里不是 1 到 3 的整数的先验当作没有", () => {
        expect([0, 4, 1.5, Number.NaN, undefined].map(tier => priorTier({tier}))).toEqual([null, null, null, null, null]);
        expect(priorTier({tier: 2})).toBe(2);
    });
});

describe("后验", () => {
    test("证据窗口：说法所在章之后读到的章数不足时，证据不强就是“未知”，没有先验的不折叠", () => {
        const at = chapterEnd(20);
        const table = tiersAt(index, at);
        const recent = index.statements.filter(statement => statement.at.chapter > at.chapter - EVIDENCE_WINDOW && visibleAt(statement.at, at));
        expect(recent.length).toBeGreaterThan(20);
        for (const statement of recent) {
            const result = table.statement(statement.id)!;
            expect(result.window).toBeLessThan(EVIDENCE_WINDOW);
            expect(["unknown", "strong"]).toContain(result.ev);
            expect(result.tier).toBeLessThan(3);
        }
    });

    test("同章写的知情不是后文引用；后文的确认是", () => {
        const table = tiersAt(index, chapterEnd(100));
        // s1-5 只有第 1 章当章写的一条知情。
        expect(index.knowledge.some(item => item.about === "s1-5" && !item.derived && item.at.chapter === 1)).toBe(true);
        expect(table.statement("s1-5")!.refs.knowers).toBe(0);
        // s4-1“风信子的真名是南小风”后文被确认，证据强。
        expect(table.statement("s4-1")!.refs.confirms).toBeGreaterThan(0);
        expect(table.statement("s4-1")!.ev).toBe("strong");
    });

    test("贯穿全书的设定词组在第 100 章仍算回响（上限随可见章数放宽）", () => {
        // “神典石”在原文的三十多章出现，按绝对上限会被当成太常见。
        const result = tiersAt(index, chapterEnd(100)).statement("s4-9")!;
        expect(result.echo.grams).toContain("00神典");
    });

    test("位置之后的说法不给等级", () => {
        expect(tiersAt(index, chapterEnd(3)).statement("s4-1")).toBeUndefined();
        expect(tiersAt(index, chapterEnd(3)).statement("没有这条")).toBeUndefined();
    });
});

/** 把数据截到 P：各类记录按自己的 at 截，称呼与悬念进展按各自的 at 截，原文截到 P 那一段。 */
function truncate(source: Dataset, at: Position): Dataset {
    const keep = <T extends {at: Position}>(records: readonly T[]): T[] => records.filter(record => visibleAt(record.at, at));
    return {
        ...source,
        sources: source.sources.filter(chapter => chapter.chapter <= at.chapter).map(chapter => (chapter.chapter === at.chapter ? {...chapter, paragraphs: chapter.paragraphs.slice(0, at.paragraph)} : chapter)),
        entities: keep(source.entities).map(entity => ({...entity, names: keep(entity.names)})),
        mentions: keep(source.mentions),
        times: keep(source.times),
        beats: keep(source.beats),
        statements: keep(source.statements),
        secrets: keep(source.secrets),
        episodes: keep(source.episodes),
        knowledge: keep(source.knowledge),
        ledger: keep(source.ledger),
        questions: keep(source.questions).map(question => ({...question, updates: keep(question.updates)})),
        summaries: keep(source.summaries),
        arcs: keep(source.arcs),
    };
}

describe("不剧透：截断对照", () => {
    const positions: [string, () => Position][] = [
        ["第 10 章末", () => chapterEnd(10)],
        ["第 20 章末", () => chapterEnd(20)],
        ["第 20 章中间", () => ({chapter: 20, paragraph: Math.floor(dataset.sources[19]!.paragraphs.length / 2)})],
        ["第 35 章末", () => chapterEnd(35)],
    ];
    for (const [label, position] of positions) {
        test(label, () => {
            const at = position();
            // 给一部分说法写上先验，也覆盖表一。
            const withPrior: Dataset = {...dataset, statements: dataset.statements.map((statement, offset) => (offset % 3 === 0 ? {...statement, tier: (offset % 9) / 3 + 1} : statement))};
            const full = tiersAt(buildBookIndex(META, withPrior), at);
            const cut = buildBookIndex(META, truncate(withPrior, at));
            const truncated = tiersAt(cut, at);
            const visible = cut.statements.filter(statement => visibleAt(statement.at, at));
            expect(visible.length).toBeGreaterThan(50);
            for (const statement of visible) expect({id: statement.id, ...full.statement(statement.id)}).toEqual({id: statement.id, ...truncated.statement(statement.id)});
        });
    }
});
