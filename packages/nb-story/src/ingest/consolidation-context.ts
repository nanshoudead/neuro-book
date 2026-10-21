/**
 * 增量整理的输入（docs/specs/story/ingest.md 输出 4）：只给“这一段”，即上一次整理以来的几章，五节各有字数上限。给模型的
 * 文字与清理用的范围（`ConsolidationScope`）在这里一起算，两边看到的对象、主线与候选一致。
 *
 * 两个水位（w00024 t12 plan.md）：对象与记录从上一次被接受的整理（`since`）之后算；情节从最近一批主线（快照）之后算。
 * 旧记录里有 0 条主线的整批稿时两者不同，快照更早，那几章的情节也要能归入主线。两者都最多回看 `LOOKBACK` 章。
 */

import type {Arc, Dataset, Entity, Facet, Position, Summary} from "../core/dataset";
import {featuresOf} from "../core/dataset";
import {formatPosition} from "../core/position";
import {displayName, KIND_ZH, STATE_ZH, uniqueNames} from "./context";
import {mergeRefusal, type ConsolidationScope} from "./draft-tools";

/** “这一段”最多回看的章数：连续跳过整理、追加了很长一段时，更早的情节留作未归入主线。 */
export const LOOKBACK = 10;
/** 各节的字数上限（按给模型的一行算）。 */
export const BUDGETS = {arcs: 6000, episodes: 8000, summaries: 10_000, others: 3000, records: 10_000} as const;
/** 列出现有归纳的对象最多几个。 */
export const SUMMARIZED_LIMIT = 15;
/** 合并候选最多几对。 */
export const CANDIDATE_LIMIT = 30;

const FACET_ZH: Record<Facet, string> = {overview: "概览", appearance: "外貌", personality: "性格与说话方式", relations: "人际关系", history: "经历", abilities: "能力与道具", goals: "处境与目标"};
const LINK_ZH: Record<string, string> = {after: "在其后", continues: "接着", retells: "重述", causes: "起因", motivates: "动机", enables: "前提"};
const OP_ZH: Record<string, string> = {set: "设为", gain: "增加", spend: "花掉", get: "得到", lose: "失去", use: "用掉"};
const HANDWRITTEN_KNOWLEDGE = /^k\d{1,4}-\d{1,4}$/u;

const lineSize = (line: string) => line.length + 1;

/** 从前往后取，合计不超过 `budget` 字；放不下的那一行起都不要。 */
function head(lines: string[], budget: number): string[] {
    const taken: string[] = [];
    let used = 0;
    for (const line of lines) {
        if (used + lineSize(line) > budget) break;
        used += lineSize(line);
        taken.push(line);
    }
    return taken;
}

/** 最近一批主线（与查询的取法相同）与它的章号；还没有主线时为空、0。 */
export function latestArcs(dataset: Dataset): {at: number; arcs: Arc[]} {
    const at = dataset.arcs.reduce((max, arc) => Math.max(max, arc.through), 0);
    return {at, arcs: dataset.arcs.filter(arc => arc.through === at)};
}

/** 每个方面最新的一份归纳（与 `entity.card` 的取法相同：章号最大的，章号相同取后写的）。 */
function latestSummaries(dataset: Dataset, entity: string): Summary[] {
    const latest = new Map<Facet, Summary>();
    for (const summary of dataset.summaries) {
        if (summary.entity !== entity) continue;
        const current = latest.get(summary.facet);
        if (!current || summary.through >= current.through) latest.set(summary.facet, summary);
    }
    return [...latest.values()];
}

export interface ConsolidationContext {
    text: string;
    scope: ConsolidationScope;
}

/** 读完第 `chapter` 章做整理时给模型的材料。`since` 是上一次被接受的整理的章号，没有为 0。 */
export function consolidationContext(dataset: Dataset, chapter: number, since: number): ConsolidationContext {
    const last = dataset.sources.find(item => item.chapter === chapter);
    const readAt: Position = {chapter, paragraph: last?.paragraphs.length ?? 1};
    const features = featuresOf(dataset.book.features);
    const unique = uniqueNames(dataset, readAt);
    const entityOf = new Map(dataset.entities.map(entity => [entity.id, entity]));
    const name = (id: string) => (id === "reader" ? "读者" : unique.get(id) ?? id);
    const from = Math.max(since, chapter - LOOKBACK);
    const inSegment = (at: Position) => at.chapter > from && at.chapter <= chapter;
    const snapshot = latestArcs(dataset);
    const episodeFrom = Math.max(snapshot.at, chapter - LOOKBACK);

    const lines: string[] = [`# 读到第 ${chapter} 章的整理材料`, "", `“这一段”是第 ${from + 1} 到 ${chapter} 章${episodeFrom < from ? `（情节从第 ${episodeFrom + 1} 章起）` : ""}。`];

    // ---- 当前的主线 ----
    const episodeById = new Map(dataset.episodes.map(item => [item.id, item]));
    const arcLine = (arc: Arc) => {
        if (arc.status === "closed") return `${arc.id}｜${arc.title}｜已结束`;
        const recent = arc.episodes.slice(-3).map(id => episodeById.get(id)?.title ?? id).join("、");
        return `${arc.id}｜${arc.title}｜进行中｜${arc.episodes.length} 段情节，最近：${recent}｜${arc.summary}`;
    };
    let shownArcs = [...snapshot.arcs];
    const arcsSize = () => shownArcs.reduce((sum, arc) => sum + lineSize(arcLine(arc)), 0);
    // 超出时先不列已结束的（从前往后），仍超出再从前往后不列进行中的；没列的照样带进新一批。
    while (arcsSize() > BUDGETS.arcs && shownArcs.some(arc => arc.status === "closed")) shownArcs.splice(shownArcs.findIndex(arc => arc.status === "closed"), 1);
    while (arcsSize() > BUDGETS.arcs) shownArcs.shift();
    lines.push("", "## 当前的主线", "");
    if (snapshot.arcs.length === 0) lines.push("还没有主线。");
    else {
        lines.push(`归纳到第 ${snapshot.at} 章的一批。没写到的主线原样留下。`, "编号｜标题｜状态｜情节｜概括");
        if (shownArcs.length < snapshot.arcs.length) lines.push(`（另有 ${snapshot.arcs.length - shownArcs.length} 条较早的主线没有列出，它们照样留下。）`);
        lines.push(...shownArcs.map(arcLine));
    }

    // ---- 这一段的情节 ----
    const arcsOf = new Map<string, string[]>();
    for (const arc of snapshot.arcs) for (const id of arc.episodes) arcsOf.set(id, [...(arcsOf.get(id) ?? []), arc.id]);
    const episodeLines = dataset.episodes
        .filter(item => item.at.chapter > episodeFrom && item.at.chapter <= chapter)
        .map(item => {
            const who = item.who.map(entry => name(entry.e)).join("、");
            const links = item.links.map(link => `${LINK_ZH[link.type] ?? link.type} ${link.to}${arcsOf.has(link.to) ? `（属于 ${arcsOf.get(link.to)!.join("、")}）` : ""}`).join("；");
            return `${item.id}（${formatPosition(item.at)}）${item.title}：${item.summary}｜参与：${who}${links ? `｜${links}` : ""}`;
        });
    const shownEpisodes = head([...episodeLines].reverse(), BUDGETS.episodes).reverse();
    lines.push("", "## 这一段的情节", "");
    if (shownEpisodes.length < episodeLines.length) lines.push(`（只列最近的 ${shownEpisodes.length} 段，更早的 ${episodeLines.length - shownEpisodes.length} 段没有列出。）`);
    lines.push(...(shownEpisodes.length ? shownEpisodes : ["没有新的情节。"]));

    // ---- 这一段的对象 ----
    const mentions = new Map<string, number>();
    for (const mention of dataset.mentions) if (inSegment(mention.at)) mentions.set(mention.entity, (mentions.get(mention.entity) ?? 0) + 1);
    const statements = dataset.statements.filter(item => inSegment(item.at));
    const knowledge = dataset.knowledge.filter(item => inSegment(item.at) && !item.derived && HANDWRITTEN_KNOWLEDGE.test(item.id) && (features.secrets || !/^x/u.test(item.about)));
    const ledger = features.ledger ? dataset.ledger.filter(item => inSegment(item.at)) : [];
    const related = new Set<string>(mentions.keys());
    for (const entity of dataset.entities) if (inSegment(entity.at)) related.add(entity.id);
    for (const item of statements) for (const id of [...item.about, item.holder, item.source.by]) if (id) related.add(id);
    for (const item of knowledge) if (item.who !== "reader") related.add(item.who);
    for (const item of ledger) related.add(item.owner);
    const order = new Map(dataset.entities.map((entity, index) => [entity.id, index]));
    const relevant = [...related].filter(id => entityOf.has(id)).sort((a, b) => (mentions.get(b) ?? 0) - (mentions.get(a) ?? 0) || order.get(a)! - order.get(b)!);
    const rosterLine = (entity: Entity) => `${entity.id}｜${KIND_ZH[entity.kind]}｜${displayName(entity, readAt)}｜${entity.label}`;
    const summarized = new Set<string>();
    const summaryLines: string[] = [];
    let used = 0;
    for (const id of relevant) {
        if (summarized.size >= SUMMARIZED_LIMIT) break;
        const entity = entityOf.get(id)!;
        const current = latestSummaries(dataset, id);
        const block = [rosterLine(entity), ...(current.length ? current.map(summary => `  - ${FACET_ZH[summary.facet]}（${summary.facet}）：${summary.items.map(item => `${item.text}〔${item.deps.join("、")}〕`).join("")}`) : ["  - 还没有归纳"])];
        const size = block.reduce((sum, line) => sum + lineSize(line), 0);
        if (used + size > BUDGETS.summaries) continue;
        used += size;
        summarized.add(id);
        summaryLines.push(...block);
    }
    const otherLines = relevant.filter(id => !summarized.has(id)).map(id => rosterLine(entityOf.get(id)!));
    const shownOthers = head(otherLines, BUDGETS.others);
    lines.push("", "## 这一段的对象", "");
    if (relevant.length === 0) lines.push("这一段没有涉及的对象。");
    else {
        lines.push("按这一段的提及次数排序。下面这些列出了现有的各方面归纳（每句后面是依据），可以改写：", "编号｜类别｜当前称呼｜整理标签", ...summaryLines);
        if (otherLines.length) {
            lines.push("", "其余的对象没有列出现有归纳，只能给它们补还没有的方面：", "编号｜类别｜当前称呼｜整理标签", ...shownOthers);
            if (shownOthers.length < otherLines.length) lines.push(`（另有 ${otherLines.length - shownOthers.length} 个没有列出。）`);
        }
    }

    // ---- 这一段的记录 ----
    const statementText = new Map(dataset.statements.map(item => [item.id, item.text]));
    const secretTitle = new Map(dataset.secrets.map(item => [item.id, item.title]));
    const records = [
        ...statements.map(item => ({at: item.at, ids: [...item.about, item.holder, item.source.by], line: `${item.id}　${item.text}`})),
        ...knowledge.map(item => ({at: item.at, ids: [item.who], line: `${item.id}　${name(item.who)}${STATE_ZH[item.state]}：${statementText.get(item.about) ?? secretTitle.get(item.about) ?? item.about}`})),
        ...ledger.map(item => ({at: item.at, ids: [item.owner], line: `${item.id}　${name(item.owner)}的“${item.track}”${OP_ZH[item.op]}${item.amount ?? item.value ?? item.item ?? ""}：${item.reason}`})),
    ].map((record, index) => ({...record, index}));
    // 先留涉及列了归纳的对象的，再按从新到旧；列出时按原文先后。
    const ranked = [...records].sort((a, b) => Number(b.ids.some(id => id && summarized.has(id))) - Number(a.ids.some(id => id && summarized.has(id))) || b.at.chapter - a.at.chapter || b.at.paragraph - a.at.paragraph);
    const keep = new Set<number>();
    let recordsUsed = 0;
    for (const record of ranked) {
        if (recordsUsed + lineSize(record.line) > BUDGETS.records) break;
        recordsUsed += lineSize(record.line);
        keep.add(record.index);
    }
    const shownRecords = records.filter(record => keep.has(record.index)).sort((a, b) => a.at.chapter - b.at.chapter || a.at.paragraph - b.at.paragraph || a.index - b.index);
    lines.push("", "## 这一段的记录", "", `写归纳的依据：说法（s）、知情（k）${features.ledger ? "、状态变动（l）" : ""}，以及上面的情节（p）。`);
    if (shownRecords.length < records.length) lines.push(`（只列了 ${shownRecords.length} 条，另有 ${records.length - shownRecords.length} 条没有列出。）`);
    lines.push(...(shownRecords.length ? shownRecords.map(record => record.line) : ["没有新的记录。"]));

    // ---- 合并候选 ----
    // 至少一方是这一段新建或新增了称呼的；条件与清理相同（mergeRefusal）。先用类别与称呼粗筛，再查身份说法。
    const fresh = dataset.entities.filter(entity => inSegment(entity.at) || entity.names.some(item => inSegment(item.at)));
    const seen = new Set<string>();
    const candidates: {pair: [string, string]; created: boolean}[] = [];
    for (const a of fresh) {
        for (const b of dataset.entities) {
            if (a.id === b.id || a.kind !== b.kind) continue;
            const key = [a.id, b.id].sort().join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            if (mergeRefusal(a, b, dataset) !== null) continue;
            candidates.push({pair: [a.id, b.id].sort((x, y) => order.get(x)! - order.get(y)!) as [string, string], created: inSegment(a.at) || inSegment(b.at)});
        }
    }
    const shownCandidates = [...candidates.filter(item => item.created), ...candidates.filter(item => !item.created)].slice(0, CANDIDATE_LIMIT).map(item => item.pair);
    if (shownCandidates.length) {
        const names = (id: string) => entityOf.get(id)!.names.map(item => item.text).join("、") || `〔${entityOf.get(id)!.label}〕`;
        lines.push("", "## 合并候选", "", "称呼相同或互相包含的同类对象。确实是同一个且建重了才合并；马甲和本人不要合并。只能从这里挑。");
        for (const [a, b] of shownCandidates) lines.push(`${a}（${names(a)}）｜${b}（${names(b)}）`);
    }

    return {text: `${lines.join("\n")}\n`, scope: {base: snapshot.at, arcs: snapshot.arcs, summarized, candidates: shownCandidates}};
}
