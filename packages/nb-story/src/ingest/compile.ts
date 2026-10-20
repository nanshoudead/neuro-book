/**
 * 把各章草稿与整理稿编译成数据集（docs/specs/story/ingest.md 输出 5、8）。草稿里的语义内容原样保留；位置、称呼出现处、
 * 默认断言类型、派生知情、账本累加与时间次序由这里生成。发现的问题全部收集后返回，不在第一处停下。
 *
 * 搬自 w00005 t27 `compile.ts`，提示文字与算法不变，只有三处不同：
 * 1. 称呼首次出现往前校正时不跨章（原来会把后文才交代的代号回填到前文同样的字串上，提前透露它属于谁）；
 * 2. 只由前面各章的说法组成的新秘密，以及出处全在前面各章的知情记录，成立位置不早于写下它的那一章的最后一段
 *    （原来取出处的位置，回补的记录会出现在写下它之前的阅读位置上）；
 * 3. 问题带上结构化的归属（`IssueSubject`），抽取管线按它找要丢弃的记录，不从提示文字里截取编号。
 */

import {createHash} from "node:crypto";

import {DAY_PARTS, DATASET_SCHEMA} from "../core/dataset";
import type {Arc, Basis, Beat, Dataset, Entity, Episode, Knowledge, LedgerEntry, Mention, Position, Question, Secret, SourceChapter, Span, Statement, StatementKind, Summary, TimeAnchor} from "../core/dataset";
import {comparePosition} from "../core/position";
import {ChapterDraftSchema, ConsolidationSchema, parseWith, type ChapterDraft, type Consolidation} from "./draft-schema";
import {occurrenceFinder} from "./text-match";

/**
 * 问题指向的记录。草稿记录多数有编号（`records`）；称呼、提及、情节连接与疑问更新没有自己的编号，各用一个字段。
 * `missing` 是“引用了不存在的记录”时缺的那个编号：兜底时先试着只摘掉这个引用。
 */
export interface IssueSubject {
    records?: string[];
    missing?: string;
    name?: string;
    mention?: string;
    link?: {from: string; to: string};
    questionUpdate?: string;
}

export interface Issue extends IssueSubject {
    level: "error" | "warning";
    chapter: number | null;
    code: string;
    message: string;
}

export interface CompileResult {
    dataset: Dataset;
    issues: Issue[];
}

export function parseEvidence(ref: string): Span {
    const match = /^(\d+)\.(\d+)(?:-(?:(\d+)\.)?(\d+))?$/u.exec(ref);
    if (!match) throw new Error(`无法解析的原文位置：${ref}`);
    const chapter = Number(match[1]), from = Number(match[2]);
    // 范围不能跨章：跨章的依据分成几条写。写成 -1 让后面的范围检查报错，而不是悄悄截断。
    if (match[3] && Number(match[3]) !== chapter) return {chapter, from, to: -1};
    return {chapter, from, to: match[4] ? Number(match[4]) : from};
}

const endOf = (spans: Span[]): Position => spans.reduce<Position>((latest, span) => {
    const end = {chapter: span.chapter, paragraph: span.to};
    return comparePosition(end, latest) > 0 ? end : latest;
}, {chapter: 0, paragraph: 0});

/** 一章原文的指纹：段落以换行连接后的 SHA-256。 */
export function sourceChapter(chapter: number, title: string, paragraphs: string[]): SourceChapter {
    return {chapter, title, paragraphs, sha256: createHash("sha256").update(paragraphs.join("\n"), "utf8").digest("hex")};
}

const DEFAULT_KIND: Record<string, StatementKind> = {narrator: "fact", author: "claim", thought: "belief", speech: "claim", document: "claim"};

type Report = (level: Issue["level"], chapter: number | null, code: string, message: string, subject?: IssueSubject) => void;

export function compile(book: Dataset["book"], sources: SourceChapter[], rawDrafts: unknown[], rawConsolidations: unknown[] = []): CompileResult {
    const issues: Issue[] = [];
    const issue: Report = (level, chapter, code, message, subject = {}) => {
        issues.push({level, chapter, code, message, ...subject});
    };

    const drafts: ChapterDraft[] = [];
    for (const raw of rawDrafts) {
        const parsed = parseWith(ChapterDraftSchema, raw);
        if (!parsed.ok) {
            const chapter = typeof (raw as {chapter?: unknown})?.chapter === "number" ? (raw as {chapter: number}).chapter : null;
            for (const item of parsed.problems) issue("error", chapter, "schema", `${item.path}：${item.message}`);
            continue;
        }
        drafts.push(parsed.value);
    }
    drafts.sort((a, b) => a.chapter - b.chapter);
    const consolidations: Consolidation[] = [];
    for (const raw of rawConsolidations) {
        const parsed = parseWith(ConsolidationSchema, raw);
        if (!parsed.ok) {
            for (const item of parsed.problems) issue("error", null, "schema", `整理稿 ${item.path}：${item.message}`);
            continue;
        }
        consolidations.push(parsed.value);
    }
    consolidations.sort((a, b) => a.through - b.through);

    const sourceOf = new Map(sources.map(item => [item.chapter, item]));
    const paragraphOf = (at: Position): string | undefined => sourceOf.get(at.chapter)?.paragraphs[at.paragraph - 1];
    const endOfChapter = (chapter: number): Position => ({chapter, paragraph: sourceOf.get(chapter)?.paragraphs.length ?? 1});

    const ids = new Set<string>();
    const entities = new Map<string, Entity>();
    const times = new Map<string, TimeAnchor>();
    const statements = new Map<string, Statement>();
    const secrets = new Map<string, Secret>();
    /** 秘密写在哪一章：它的成立位置不早于这一章的最后一段（见模块头第 2 条）。 */
    const secretChapter = new Map<string, number>();
    const episodes = new Map<string, Episode>();
    const questions = new Map<string, Question>();
    const beats: Beat[] = [];
    const knowledge: Knowledge[] = [];
    const ledger: LedgerEntry[] = [];
    const mentionNotes: {at: Position; text: string; entity: string; chapter: number}[] = [];
    const written: Record<string, number> = {};
    const generated: Record<string, number> = {};
    const count = (bucket: Record<string, number>, key: string, by = 1) => {
        bucket[key] = (bucket[key] ?? 0) + by;
    };

    // 草稿一般只能引用本章原文。知情例外：后面才建的秘密，可以给前面章节里已经知情的人补记，依据指向当时的原文。
    function spanOf(ref: string, chapter: number, what: string, subject: IssueSubject, sameChapter = true): Span | null {
        const span = parseEvidence(ref);
        const source = sourceOf.get(span.chapter);
        if (!source) {
            issue("error", chapter, "evidence", `${what}：位置 ${ref} 的章节不在原文范围内`, subject);
            return null;
        }
        if (span.from < 1 || span.to < span.from || span.to > source.paragraphs.length) {
            issue("error", chapter, "evidence", `${what}：位置 ${ref} 超出该章段落范围（共 ${source.paragraphs.length} 段）`, subject);
            return null;
        }
        if (sameChapter && span.chapter !== chapter) {
            issue("error", chapter, "evidence", `${what}：位置 ${ref} 不在本章；本章草稿只能引用本章原文`, subject);
            return null;
        }
        if (span.chapter > chapter) {
            issue("error", chapter, "evidence", `${what}：位置 ${ref} 在本章之后`, subject);
            return null;
        }
        return span;
    }
    const spansOf = (refs: string[], chapter: number, what: string, subject: IssueSubject, sameChapter = true): Span[] =>
        refs.map(ref => spanOf(ref, chapter, what, subject, sameChapter)).filter((span): span is Span => span !== null);
    function pointOf(ref: string, chapter: number, what: string, subject: IssueSubject): Position | null {
        const span = spanOf(ref, chapter, what, subject);
        return span ? {chapter: span.chapter, paragraph: span.from} : null;
    }
    function claimId(id: string, chapter: number, what: string): boolean {
        const owner = Number(/^[a-z](\d+)-/u.exec(id)?.[1]);
        if (owner !== chapter) {
            issue("error", chapter, "id", `${what} ${id}：编号里的章号应为 ${chapter}`, {records: [id]});
            return false;
        }
        if (ids.has(id)) {
            issue("error", chapter, "id", `${what} ${id}：编号重复`, {records: [id]});
            return false;
        }
        ids.add(id);
        return true;
    }
    const has = (map: Map<string, unknown>, id: string, chapter: number, what: string, subject: IssueSubject): boolean => {
        if (map.has(id)) return true;
        issue("error", chapter, "ref", `${what}：引用了不存在的记录 ${id}`, {...subject, missing: id});
        return false;
    };

    for (const draft of drafts) {
        const chapter = draft.chapter;
        const source = sourceOf.get(chapter);
        if (!source) {
            issue("error", chapter, "source", `没有第 ${chapter} 章的原文`);
            continue;
        }

        // 先登记本章新建的时间点、对象和秘密，本章其它记录可以不分先后地引用它们。
        for (const item of draft.times) {
            if (!claimId(item.id, chapter, "时间点")) continue;
            const subject = {records: [item.id]};
            const evidence = spansOf(item.at, chapter, `时间点 ${item.id}`, subject);
            const shownAt = (ref: string | undefined, value: unknown, field: string): Position | undefined => {
                if (ref === undefined) return undefined;
                if (value === undefined) {
                    issue("error", chapter, "time", `时间点 ${item.id}：写了 ${field}At 却没有写 ${field}`, subject);
                    return undefined;
                }
                return pointOf(ref, chapter, `时间点 ${item.id} 的 ${field}At`, subject) ?? undefined;
            };
            times.set(item.id, {
                id: item.id, label: item.label, day: item.day, part: item.part, clock: item.clock, date: item.date,
                clockAt: shownAt(item.clockAt, item.clock, "clock"), dateAt: shownAt(item.dateAt, item.date, "date"), rel: item.rel,
                evidence, basis: item.basis ?? "explicit", note: item.note, at: evidence.length ? endOf(evidence) : {chapter, paragraph: 1}, order: 0,
            });
            count(written, "times");
        }
        resolveDays(draft.times.map(item => times.get(item.id)).filter((item): item is TimeAnchor => item !== undefined), times, chapter, issue);
        for (const item of draft.entities) {
            if (!claimId(item.id, chapter, "对象")) continue;
            const at = pointOf(item.at, chapter, `对象 ${item.id}`, {records: [item.id]}) ?? {chapter, paragraph: 1};
            entities.set(item.id, {id: item.id, kind: item.kind, label: item.label, note: item.note, at, names: [], mergedFrom: []});
            count(written, "entities");
            for (const name of item.names) addName(item.id, name, chapter);
        }
        for (const item of draft.names) {
            if (!has(entities, item.entity, chapter, `称呼“${item.text}”`, {name: item.text})) continue;
            addName(item.entity, item, chapter);
        }
        for (const item of draft.secrets) {
            if (!claimId(item.id, chapter, "秘密")) continue;
            for (const id of item.about) has(entities, id, chapter, `秘密 ${item.id}`, {records: [item.id]});
            secrets.set(item.id, {id: item.id, title: item.title, about: item.about, note: item.note, statements: [], at: {chapter, paragraph: source.paragraphs.length}});
            secretChapter.set(item.id, chapter);
            count(written, "secrets");
        }
        for (const item of draft.mentions) {
            const subject = {mention: item.text};
            if (!has(entities, item.entity, chapter, `提及“${item.text}”`, subject)) continue;
            const at = pointOf(item.at, chapter, `提及“${item.text}”`, subject);
            if (!at) continue;
            if (!paragraphOf(at)?.includes(item.text)) {
                issue("error", chapter, "mention", `提及“${item.text}”在 ${item.at} 段里找不到`, subject);
                continue;
            }
            mentionNotes.push({at, text: item.text, entity: item.entity, chapter});
            count(written, "mentionNotes");
        }
        for (const item of draft.times) for (const rel of item.rel) has(times, rel.to, chapter, `时间点 ${item.id}`, {records: [item.id]});

        // 段落块必须连续、不重叠地覆盖全章，这样任何一段原文都有归属。
        let expected = 1;
        for (const item of draft.beats) {
            if (!claimId(item.id, chapter, "段落块")) continue;
            const subject = {records: [item.id]};
            if (item.from !== expected || item.to < item.from) issue("error", chapter, "beat", `段落块 ${item.id} 应从第 ${expected} 段开始，实际是 ${item.from}-${item.to}`, subject);
            expected = item.to + 1;
            if (item.time !== null) has(times, item.time, chapter, `段落块 ${item.id}`, subject);
            // 章中间的分隔线按规则并入前一块；规则改动后旧草稿里单独成块的分隔线靠这条警告找出来。
            if (item.from > 1 && source.paragraphs.slice(item.from - 1, item.to).every(paragraph => SEPARATOR.test(paragraph))) {
                issue("warning", chapter, "beat", `段落块 ${item.id}（${item.from}-${item.to}）只有分隔线，应并入前一块`, subject);
            }
            beats.push({id: item.id, chapter, from: item.from, to: item.to, gist: item.gist, time: item.time, flashback: item.narration === "flashback", at: {chapter, paragraph: item.to}});
            count(written, "beats");
        }
        if (expected !== source.paragraphs.length + 1) issue("error", chapter, "beat", `段落块覆盖到第 ${expected - 1} 段，本章共 ${source.paragraphs.length} 段`);

        // 说法先全部登记编号，再检查相互引用，允许本章内前后引用。
        const chapterStatements: Statement[] = [];
        for (const item of draft.statements) {
            if (!claimId(item.id, chapter, "说法")) continue;
            const subject = {records: [item.id]};
            const evidence = spansOf(item.src.at, chapter, `说法 ${item.id}`, subject);
            const channel = item.src.ch;
            const needsBy = channel === "speech" || channel === "thought" || channel === "document";
            if (needsBy && item.src.by === undefined) issue("error", chapter, "source", `说法 ${item.id}：台词、心理、文字要写出是谁的（by）；来源不明写 null`, subject);
            // 旁白转述某个角色的看法时，kind 写成信念或说法，by 写这个角色；除此之外旁白和作者声明不写 by。
            const narrated = channel === "narrator" && (item.kind === "belief" || item.kind === "claim");
            if (!needsBy && item.src.by && !narrated) issue("error", chapter, "source", `说法 ${item.id}：旁白和作者声明不写 by；旁白转述角色的看法时把 kind 写成 belief 或 claim 再写 by`, subject);
            const kind = item.kind ?? DEFAULT_KIND[channel]!;
            if (!item.kind) count(generated, "statementKinds");
            if (!item.time) count(generated, "statementTimes");
            if (kind === "fact" && needsBy && !item.reason) issue("error", chapter, "kind", `说法 ${item.id}：把台词、心理或文字的内容记成世界事实，必须写明理由（reason）`, subject);
            const basis: Basis = item.basis ?? "explicit";
            if (basis === "inferred" && !item.reason) issue("error", chapter, "basis", `说法 ${item.id}：推断必须写理由（reason）`, subject);
            if (item.family === "identity" && item.about.length !== 2) issue("error", chapter, "identity", `说法 ${item.id}：身份同一类的说法要正好连接两个对象`, subject);
            const by = item.src.by ?? null;
            const statement: Statement = {
                id: item.id, text: item.text, family: item.family, label: item.label, about: item.about,
                source: {evidence, channel, by, to: item.src.to ?? [], mode: item.src.mode ?? "assert"},
                kind, holder: kind === "fact" ? null : by, basis, premises: item.premises ?? [], reason: item.reason,
                certainty: item.certainty ?? "certain", neg: item.neg ?? false, time: item.time ?? null, secret: item.secret, rel: item.rel ?? [],
                unverified: item.unverified,
                at: evidence.length ? endOf(evidence) : {chapter, paragraph: 1},
            };
            statements.set(item.id, statement);
            chapterStatements.push(statement);
            count(written, "statements");
        }
        /** 把一条说法挂到秘密上时秘密的候选成立位置：前面各章的说法只能把它提到写下秘密的那一章末尾。 */
        const secretAt = (secretId: string, at: Position): Position => {
            const written = secretChapter.get(secretId) ?? at.chapter;
            return at.chapter < written ? endOfChapter(written) : at;
        };
        for (const item of chapterStatements) {
            const what = `说法 ${item.id}`;
            const subject = {records: [item.id]};
            for (const id of item.about) has(entities, id, chapter, what, subject);
            if (item.source.by) has(entities, item.source.by, chapter, what, subject);
            for (const id of item.source.to) has(entities, id, chapter, what, subject);
            for (const id of item.premises) has(statements, id, chapter, what, subject);
            for (const rel of item.rel) if (has(statements, rel.to, chapter, what, subject) && rel.to === item.id) issue("error", chapter, "ref", `${what}：不能指向自己`, subject);
            if (item.time) has(times, item.time, chapter, what, subject);
            if (item.secret && has(secrets, item.secret, chapter, what, subject)) {
                const secret = secrets.get(item.secret)!;
                secret.statements.push(item.id);
                const at = secretAt(secret.id, item.at);
                if (secret.statements.length === 1 || comparePosition(at, secret.at) < 0) secret.at = at;
            }
            if (!item.time) item.time = beats.find(beat => beat.chapter === chapter && beat.from <= item.at.paragraph && item.at.paragraph <= beat.to)?.time ?? null;
        }
        for (const item of draft.secrets) for (const id of item.statements ?? []) {
            const statement = statements.get(id), secret = secrets.get(item.id);
            if (!statement || !secret) {
                issue("error", chapter, "ref", `秘密 ${item.id}：引用了不存在的记录 ${id}`, {records: [item.id], missing: id});
                continue;
            }
            if (!secret.statements.includes(id)) secret.statements.push(id);
            if (!statement.secret) statement.secret = item.id;
            const at = secretAt(secret.id, statement.at);
            if (secret.statements.length === 1 || comparePosition(at, secret.at) < 0) secret.at = at;
        }

        for (const item of draft.episodes) {
            if (!claimId(item.id, chapter, "情节")) continue;
            const what = `情节 ${item.id}`;
            const subject = {records: [item.id]};
            const evidence = spansOf(item.at, chapter, what, subject);
            has(times, item.time, chapter, what, subject);
            if (item.place) has(entities, item.place, chapter, what, subject);
            for (const who of item.who) {
                has(entities, who.e, chapter, what, subject);
                if (who.as) has(entities, who.as, chapter, what, subject);
            }
            const steps = item.steps.flatMap(step => {
                const span = spanOf(step.at, chapter, `${what} 的步骤`, subject);
                return span ? [{text: step.text, evidence: span}] : [];
            });
            const at = evidence.length ? endOf(evidence) : {chapter, paragraph: 1};
            episodes.set(item.id, {
                id: item.id, title: item.title, summary: item.summary, evidence, time: item.time, place: item.place, who: item.who, steps,
                outcome: item.outcome, links: item.links.map(link => ({...link, at})), at,
            });
            count(written, "episodes");
        }
        for (const item of draft.episodes) for (const link of item.links) {
            const subject = {records: [item.id]};
            if (has(episodes, link.to, chapter, `情节 ${item.id}`, subject) && link.to === item.id) issue("error", chapter, "ref", `情节 ${item.id}：不能连到自己`, subject);
        }

        for (const item of draft.episodeLinks) {
            const what = `情节连接 ${item.from} 到 ${item.to}`;
            const subject = {link: {from: item.from, to: item.to}};
            if (!has(episodes, item.from, chapter, what, subject) || !has(episodes, item.to, chapter, what, subject)) continue;
            if (item.from === item.to) {
                issue("error", chapter, "ref", `${what}：不能连到自己`, subject);
                continue;
            }
            episodes.get(item.from)!.links.push({type: item.type, to: item.to, note: item.note, at: {chapter, paragraph: source.paragraphs.length}});
            count(written, "episodeLinks");
        }

        for (const item of draft.knowledge) {
            if (!claimId(item.id, chapter, "知情")) continue;
            const what = `知情 ${item.id}`;
            const subject = {records: [item.id]};
            if (item.who !== "reader") has(entities, item.who, chapter, what, subject);
            if (!statements.has(item.about) && !secrets.has(item.about)) issue("error", chapter, "ref", `${what}：引用了不存在的说法或秘密 ${item.about}`, {...subject, missing: item.about});
            const evidence = spansOf(item.at, chapter, what, subject, false);
            const end = evidence.length ? endOf(evidence) : {chapter, paragraph: 1};
            // 回补的知情（出处全在前面各章）读完写下它的这一章才可见，见模块头第 2 条。
            const at = end.chapter < chapter ? endOfChapter(chapter) : end;
            knowledge.push({id: item.id, who: item.who, about: item.about, state: item.state, how: item.how, evidence, basis: item.basis ?? "explicit", unverified: item.unverified, at, derived: false});
            count(written, "knowledge");
        }

        for (const item of draft.ledger) {
            if (!claimId(item.id, chapter, "状态变动")) continue;
            const what = `状态变动 ${item.id}`;
            const subject = {records: [item.id]};
            has(entities, item.owner, chapter, what, subject);
            if (item.item) has(entities, item.item, chapter, what, subject);
            if ((item.op === "gain" || item.op === "spend") && item.amount === undefined) issue("error", chapter, "ledger", `${what}：增加或减少要写数额（amount）`, subject);
            if (item.op === "set" && item.value === undefined) issue("error", chapter, "ledger", `${what}：设为某值要写 value`, subject);
            if ((item.op === "get" || item.op === "lose" || item.op === "use") && !item.item) issue("error", chapter, "ledger", `${what}：得到、失去、用掉要写是哪件东西（item）`, subject);
            const evidence = spansOf(item.at, chapter, what, subject);
            ledger.push({
                id: item.id, owner: item.owner, track: item.track, op: item.op, amount: item.amount, value: item.value, item: item.item, reason: item.reason,
                evidence, basis: item.basis ?? "explicit", unverified: item.unverified, at: evidence.length ? endOf(evidence) : {chapter, paragraph: 1}, check: null,
            });
            count(written, "ledger");
        }

        for (const item of draft.questions) {
            if (!claimId(item.id, chapter, "疑问")) continue;
            const what = `疑问 ${item.id}`;
            const subject = {records: [item.id]};
            for (const id of item.about) has(entities, id, chapter, what, subject);
            if (item.by) has(entities, item.by, chapter, what, subject);
            const evidence = spansOf(item.at, chapter, what, subject);
            questions.set(item.id, {id: item.id, text: item.text, evidence, about: item.about, by: item.by, at: evidence.length ? endOf(evidence) : {chapter, paragraph: 1}, updates: []});
            count(written, "questions");
        }
        for (const item of draft.questionUpdates) {
            const what = `疑问更新 ${item.q}`;
            const subject = {questionUpdate: item.q};
            if (!has(questions, item.q, chapter, what, subject)) continue;
            if (item.answer) has(statements, item.answer, chapter, what, subject);
            if (item.type !== "raised" && !item.answer && !item.note) issue("error", chapter, "question", `${what}：解答要指向一条说法（answer）或写说明（note）`, subject);
            const evidence = spansOf(item.at, chapter, what, subject);
            const at = evidence.length ? endOf(evidence) : {chapter, paragraph: 1};
            const question = questions.get(item.q)!;
            if (comparePosition(at, question.at) < 0) issue("error", chapter, "question", `${what}：更新的位置早于提出的位置`, subject);
            question.updates.push({type: item.type, evidence, answer: item.answer, note: item.note, reliability: item.reliability, at});
            count(written, "questionUpdates");
        }
    }

    function addName(entityId: string, name: {text: string; at: string; primary?: boolean; note?: string}, chapter: number): void {
        const subject = {name: name.text};
        const at = pointOf(name.at, chapter, `称呼“${name.text}”`, subject);
        if (!at) return;
        if (!paragraphOf(at)?.includes(name.text)) {
            issue("error", chapter, "name", `称呼“${name.text}”在 ${name.at} 段里找不到`, subject);
            return;
        }
        const entity = entities.get(entityId)!;
        if (entity.names.some(item => item.text === name.text)) {
            issue("warning", chapter, "name", `对象 ${entityId} 已有称呼“${name.text}”，重复登记`, subject);
            return;
        }
        entity.names.push({text: name.text, at, primary: name.primary ?? false, note: name.note});
        count(written, "names");
    }

    // ---- 整理稿：合并重复对象、对象摘要、故事线 ----
    const summaries: Summary[] = [];
    const arcs: Arc[] = [];
    const redirect = new Map<string, string>();
    const resolve = (id: string): string => {
        let current = id;
        while (redirect.has(current)) current = redirect.get(current)!;
        return current;
    };
    for (const item of consolidations) {
        const at = endOfChapter(item.through);
        for (const merge of item.merges) {
            const keep = entities.get(resolve(merge.keep)), drop = entities.get(resolve(merge.drop));
            if (!keep || !drop) {
                issue("error", item.through, "merge", `合并 ${merge.drop} 到 ${merge.keep}：对象不存在`);
                continue;
            }
            if (keep.id === drop.id) continue;
            for (const name of drop.names) if (!keep.names.some(existing => existing.text === name.text)) keep.names.push({...name, primary: false});
            if (comparePosition(drop.at, keep.at) < 0) keep.at = drop.at;
            keep.mergedFrom.push(drop.id, ...drop.mergedFrom);
            entities.delete(drop.id);
            redirect.set(drop.id, keep.id);
            count(written, "merges");
        }
        for (const summary of item.summaries) {
            const entity = resolve(summary.entity);
            if (!entities.has(entity)) {
                issue("error", item.through, "summary", `摘要指向不存在的对象 ${summary.entity}`);
                continue;
            }
            for (const row of summary.items) for (const dep of row.deps) {
                const target = statements.get(dep) ?? episodes.get(dep) ?? knowledge.find(record => record.id === dep) ?? ledger.find(record => record.id === dep);
                if (!target) issue("error", item.through, "summary", `摘要“${row.text.slice(0, 16)}…”依据的 ${dep} 不存在`);
                else if (comparePosition(target.at, at) > 0) issue("error", item.through, "summary", `摘要“${row.text.slice(0, 16)}…”依据的 ${dep} 在整理范围之后`);
            }
            summaries.push({entity, facet: summary.facet, through: item.through, items: summary.items, at});
            count(written, "summaries");
        }
        for (const arc of item.arcs) {
            if (!claimId(arc.id, item.through, "故事线")) continue;
            for (const id of arc.episodes) has(episodes, id, item.through, `故事线 ${arc.id}`, {records: [arc.id]});
            arcs.push({id: arc.id, title: arc.title, summary: arc.summary, episodes: arc.episodes, status: arc.status, through: item.through, at});
            count(written, "arcs");
        }
    }
    if (redirect.size) {
        const fix = (id: string) => resolve(id);
        for (const item of statements.values()) {
            item.about = [...new Set(item.about.map(fix))];
            item.holder = item.holder && fix(item.holder);
            item.source.by = item.source.by && fix(item.source.by);
            item.source.to = item.source.to.map(fix);
        }
        for (const item of secrets.values()) item.about = [...new Set(item.about.map(fix))];
        for (const item of episodes.values()) {
            item.place = item.place && fix(item.place);
            item.who = item.who.map(who => ({...who, e: fix(who.e), as: who.as && fix(who.as)}));
        }
        for (const item of knowledge) if (item.who !== "reader") item.who = fix(item.who);
        for (const item of ledger) {
            item.owner = fix(item.owner);
            item.item = item.item && fix(item.item);
        }
        for (const item of questions.values()) {
            item.about = [...new Set(item.about.map(fix))];
            item.by = item.by && fix(item.by);
        }
        for (const item of mentionNotes) item.entity = fix(item.entity);
    }

    // ---- 程序生成的部分 ----
    orderTimes([...times.values()], issue);
    count(generated, "timeOrder", times.size);
    for (const beat of beats) {
        if (!beat.flashback || !beat.time) continue;
        const previous = [...beats].reverse().find(item => item.chapter === beat.chapter && item.to < beat.from && !item.flashback && item.time);
        const now = previous?.time ? times.get(previous.time) : undefined, then = times.get(beat.time);
        if (now && then && then.order >= now.order) issue("warning", beat.chapter, "time", `段落块 ${beat.id} 标为回忆，但它的时间点 ${then.id} 不早于前面正叙的时间点 ${now.id}`, {records: [beat.id]});
    }

    // 称呼的首次出现位置以原文为准：草稿登记得比实际晚时，往前校正到它第一次单独出现的地方（不早于对象本身出现的位置）。
    // 只校正全书只属于一个对象的称呼；同名的称呼归属要靠草稿判断，程序不动。不跨章：前面章节里同样的字串，当时的读者
    // 还不知道它指这个对象（docs/specs/story/ingest.md 输出 8）。
    const owners = new Map<string, number>();
    for (const entity of entities.values()) for (const name of entity.names) owners.set(name.text, (owners.get(name.text) ?? 0) + 1);
    const earliest = matchMentions(sources, [...entities.values()].map(entity => ({...entity, names: entity.names.map(name => ({...name, at: entity.at}))})), mentionNotes);
    for (const entity of entities.values()) for (const name of entity.names) {
        if (owners.get(name.text) !== 1) continue;
        const first = earliest.find(item => item.via === "match" && item.entity === entity.id && item.text === name.text && item.at.chapter === name.at.chapter);
        if (first && comparePosition(first.at, name.at) < 0) {
            name.at = first.at;
            count(generated, "nameFirstSeen");
        }
    }

    const mentions = matchMentions(sources, [...entities.values()], mentionNotes);
    count(generated, "mentions", mentions.filter(item => item.via === "match").length);

    // 草稿手写的知情优先于程序推出的。手写的和程序本来就会推出的完全一样时提醒一声：规则要求这类不要写。
    const redundant = (record: Knowledge | undefined, state: Knowledge["state"]) => {
        if (record && !record.derived && record.state === state) issue("warning", record.at.chapter, "knowledge", `知情 ${record.id} 和程序自动生成的重复，可以删去`, {records: [record.id]});
    };
    // 心理活动意味着本人相信；写了听者或读者的台词和文字意味着对方听到或读到。
    for (const item of statements.values()) {
        const derive = (who: string, state: Knowledge["state"], how: string) => {
            const record = knowledge.find(entry => entry.who === who && entry.about === item.id);
            if (record) {
                redundant(record, state);
                return;
            }
            knowledge.push({id: `k:${item.id}:${who}`, who, about: item.id, state, how, evidence: item.source.evidence, basis: "explicit", at: item.at, derived: true});
            count(generated, "knowledge");
        };
        if (item.source.channel === "thought" && item.source.by) derive(item.source.by, item.source.mode === "guess" || item.source.mode === "question" ? "suspects" : "believes", "本人的心理活动");
        for (const who of item.source.to) derive(who, item.source.channel === "document" ? "read" : "heard", item.source.channel === "document" ? "读到这段文字" : "听到这句话");
    }
    // 马甲背后的本人当然知道这层身份。旁白确认了“某个身份就是某人”之后，程序替本人补上“知道”，不用草稿去写。
    for (const item of statements.values()) {
        if (item.family !== "identity" || item.kind !== "fact" || item.neg || item.certainty !== "certain" || item.about.length !== 2) continue;
        const [first, second] = item.about.map(id => entities.get(id));
        const owner = first?.kind === "persona" && second && second.kind !== "persona" ? second : second?.kind === "persona" && first && first.kind !== "persona" ? first : null;
        if (!owner) continue;
        const targets = [item.id, ...(item.secret ? [item.secret] : [])];
        const record = knowledge.find(entry => entry.who === owner.id && targets.includes(entry.about));
        if (record) {
            redundant(record, "knows");
            continue;
        }
        knowledge.push({id: `k:${item.id}:${owner.id}:self`, who: owner.id, about: item.secret ?? item.id, state: "knows", how: "这是本人自己的身份", evidence: item.source.evidence, basis: "explicit", at: item.at, derived: true});
        count(generated, "knowledge");
    }
    // 把马甲和本人连起来的说法，要么挂在一个秘密上，要么说明这层身份是公开的；否则“谁知道、谁不知道”无处可记。
    // 这是警告而不是错误：记录本身没有写错，只是少了一层。抽取管线把它和错误一起交给修复。关掉秘密的书不查：
    // 它本来就不记秘密（docs/specs/story/ingest.md 输出 18），提醒只会让修复去写被关掉的记录。
    if (book.features?.secrets !== false) for (const item of statements.values()) {
        if (item.family !== "identity" || item.kind !== "fact" || item.neg || item.certainty !== "certain" || item.about.length !== 2 || item.secret) continue;
        if (item.label?.includes("公开")) continue;
        const [first, second] = item.about.map(id => entities.get(id));
        if (!first || !second || (first.kind !== "persona" && second.kind !== "persona")) continue;
        if ([...secrets.values()].some(secret => item.about.every(id => secret.about.includes(id)))) continue;
        issue("warning", item.at.chapter, "secret-missing", `说法 ${item.id} 把“${first.label}”和“${second.label}”记成同一个人，但没有对应的秘密：书里有人不知道这层身份时，建一个秘密并把这条说法的 secret 指向它，再在 knowledge 里写谁知道、谁表现出不知道；这层身份人人都知道时，在说法的 label 里写“公开身份”`, {records: [item.id]});
    }
    knowledge.sort((a, b) => comparePosition(a.at, b.at));

    runLedger(ledger, issue);
    count(generated, "ledgerTotals", ledger.filter(item => item.running !== undefined).length);

    for (const secret of secrets.values()) if (!secret.statements.length) issue("warning", secret.at.chapter, "secret", `秘密 ${secret.id}“${secret.title}”没有任何说法指向它`, {records: [secret.id]});
    // 人物和组织没有称呼多半是漏登记了。马甲可以暂时没有代号；物品、地点、概念常常只有“手机”“住处”这类泛称，按规则不登记。
    for (const entity of entities.values()) {
        if (!entity.names.length && (entity.kind === "person" || entity.kind === "group")) issue("warning", entity.at.chapter, "name", `对象 ${entity.id}“${entity.label}”没有登记任何书里的称呼`, {records: [entity.id]});
    }

    const dataset: Dataset = {
        schema: DATASET_SCHEMA, book,
        through: {chapter: sources.at(-1)?.chapter ?? 0, paragraph: sources.at(-1)?.paragraphs.length ?? 0},
        sources, entities: [...entities.values()], mentions, times: [...times.values()], beats, statements: [...statements.values()],
        secrets: [...secrets.values()], episodes: [...episodes.values()], knowledge, ledger, questions: [...questions.values()], summaries, arcs,
        stats: {written, generated, chars: sources.reduce((sum, item) => sum + item.paragraphs.join("").length, 0)},
    };
    checkNameLeaks(dataset, issue);
    return {dataset, issues};
}

const PART_INDEX = new Map(DAY_PARTS.map((part, index) => [part, index]));
/** 只由点、横线、星号这类符号组成的一段，是场景之间的分隔线。 */
const SEPARATOR = /^[\s.。·*=\-—–_]+$/u;

/**
 * 草稿里的时间点可以只写“比某个时间点晚几天”（rel.days），第几天由这里算出：模型自己累加天数时常把“翌日”记成第 1 天。
 * 同时写了第几天的核对，不一致时以算出的为准并提醒。只处理本章新建的时间点；所指的时间点可以是本章的，所以循环到没有变化为止。
 */
function resolveDays(current: TimeAnchor[], all: Map<string, TimeAnchor>, chapter: number, issue: Report): void {
    const settled = new Set<string>();
    for (let changed = true; changed;) {
        changed = false;
        for (const item of current) {
            if (settled.has(item.id)) continue;
            // 模型常常只写 gap 的文字（“翌日”“当天傍晚”“十分钟”）而不写 days；文字里看得出整天数的也用。
            // 写了 after 却既没有 days 也没有 gap 的，按同一天算并标为推断：连续的场景多半在同一天，换了天作者通常会写出来。
            const resolved = item.rel.map(entry => ({entry, days: entry.type === "same" ? 0 : entry.days ?? daysFromGap(entry.gap) ?? (entry.type === "after" && entry.gap === undefined ? 0 : undefined)}));
            const found = resolved.find(({entry, days}) => days !== undefined && all.get(entry.to)?.day !== undefined);
            if (!found) continue;
            const rel = found.entry, days = found.days!;
            settled.add(item.id);
            changed = true;
            if (rel.type === "after" && rel.days === undefined && rel.gap === undefined) item.basis = "inferred";
            const base = all.get(rel.to)!.day!;
            const day = rel.type === "after" ? base + days : rel.type === "before" ? base - days : base;
            const subject = {records: [item.id]};
            if (day < 1) {
                issue("warning", chapter, "time", `时间点 ${item.id}“${item.label}”：按“比 ${rel.to} 早 ${rel.days} 天”算出来早于主线第一天，没有填第几天`, subject);
                continue;
            }
            if (item.day !== undefined && item.day !== day) issue("warning", chapter, "time", `时间点 ${item.id}“${item.label}”：写的是第 ${item.day} 天，按“比 ${rel.to} ${rel.type === "before" ? "早" : "晚"} ${rel.days} 天”算出是第 ${day} 天，以算出的为准`, subject);
            item.day = day;
        }
    }
}

const NUMERALS: Record<string, number> = {一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10};

/** 从“相隔”的文字里读出整天数：翌日、三天后是整天数；当天、十分钟、随后这类同一天内的说法是 0；年月、半年这类看不出天数的不猜。 */
export function daysFromGap(gap: string | undefined): number | undefined {
    if (!gap) return undefined;
    if (/翌日|次日|第二天|第二日|隔天|明天|昨天|昨晚|昨夜|前一天|前一晚/u.test(gap)) return 1;
    const counted = /(\d+|[一两二三四五六七八九十]+)\s*天/u.exec(gap);
    if (counted) {
        const text = counted[1]!;
        return /^\d+$/u.test(text) ? Number(text) : text.length === 1 ? NUMERALS[text] : text === "十一" ? 11 : text === "十二" ? 12 : undefined;
    }
    if (/周|星期|月|年/u.test(gap)) return undefined;
    if (/当天|当日|当晚|当夜|同一天|同日|同时|稍后|随后|之后|之前|片刻|不久|分钟|小时|钟头|白天|上午|下午|中午|傍晚|晚上|晚些|凌晨|早上|早晨|清晨|夜里|深夜|黄昏|直到|饭/u.test(gap)) return 0;
    return undefined;
}

/**
 * 给时间点排出故事先后次序。有“第几天”的按天、时段、钟点排；主线之前的时间点没有天数，只能靠它与其它时间点的先后
 * 关系定位。
 */
function orderTimes(times: TimeAnchor[], issue: Report): void {
    const byId = new Map(times.map(item => [item.id, item]));
    const after = new Map<string, Set<string>>(times.map(item => [item.id, new Set()]));
    const edge = (earlier: string, later: string) => {
        if (earlier !== later) after.get(later)?.add(earlier);
    };
    for (const item of times) {
        if (item.day === undefined && !item.rel.length) issue("error", item.at.chapter, "time", `时间点 ${item.id}“${item.label}”既没有第几天，也没有与其它时间点的先后关系`, {records: [item.id]});
        for (const rel of item.rel) {
            if (!byId.has(rel.to)) continue;
            if (rel.type === "after") edge(rel.to, item.id);
            else if (rel.type === "before") edge(item.id, rel.to);
        }
    }
    const dated = times.filter(item => item.day !== undefined);
    const part = (item: TimeAnchor) => (item.part ? PART_INDEX.get(item.part)! : null);
    const clock = (item: TimeAnchor) => (item.clock ? Number(item.clock.split(":")[0]) * 60 + Number(item.clock.split(":")[1]) : null);
    for (const a of dated) for (const b of dated) {
        if (a === b) continue;
        if (a.day! < b.day!) edge(a.id, b.id);
        else if (a.day === b.day) {
            const pa = part(a), pb = part(b), ca = clock(a), cb = clock(b);
            if (pa !== null && pb !== null && pa < pb) edge(a.id, b.id);
            if (ca !== null && cb !== null && ca < cb) edge(a.id, b.id);
        }
    }
    // 拓扑排序。没有天数的时间点一旦前置条件满足就先排，所以“主线之前”的回忆会排在主线前面；
    // 其余并列时按草稿里出现的先后，保证结果稳定。
    const done = new Set<string>();
    const result: TimeAnchor[] = [];
    const pending = new Set(times.map(item => item.id));
    while (pending.size) {
        const ready = times.filter(item => pending.has(item.id) && [...after.get(item.id)!].every(id => done.has(id)));
        if (!ready.length) {
            // 卡住的时间点里有环上的，也有只是排在环后面的；records 只列环上的，抽取管线按它丢本章的时间点，
            // 不能误伤只是排在后面的那些。
            issue("error", null, "time", `时间点的先后关系自相矛盾：${[...pending].join("、")}`, {records: cycleMembers(pending, after)});
            for (const id of pending) result.push(byId.get(id)!);
            break;
        }
        const next = ready.find(item => item.day === undefined) ?? ready[0]!;
        pending.delete(next.id);
        done.add(next.id);
        result.push(next);
    }
    result.forEach((item, index) => {
        item.order = index;
    });
}

/** `pending` 里处在环上的时间点：从它出发、沿“必须先于它”的边能回到它自己。 */
function cycleMembers(pending: ReadonlySet<string>, after: ReadonlyMap<string, ReadonlySet<string>>): string[] {
    const reachesItself = (start: string): boolean => {
        const seen = new Set<string>();
        const stack = [...(after.get(start) ?? [])];
        while (stack.length) {
            const id = stack.pop()!;
            if (id === start) return true;
            if (seen.has(id) || !pending.has(id)) continue;
            seen.add(id);
            stack.push(...(after.get(id) ?? []));
        }
        return false;
    };
    return [...pending].filter(reachesItself);
}

/**
 * 在原文里找出每个称呼的每次出现。
 * 长称呼优先，避免“南小风”里的“小风”被重复计入；同一个字串属于多个对象时，取最早登记的那个，除非草稿指定了归属。
 *
 * 书越长段落与称呼都越多，每段里的工作不能随称呼总数增长，否则编译随章数三次方变慢（抽取每章要整本编译几次；t09
 * 实测原来的写法 98 章一次 12 秒）：字串的归属与草稿指定的提及在进段落之前算好，每段只扫它里面实际出现的字串。
 */
export function matchMentions(sources: SourceChapter[], entities: Entity[], notes: {at: Position; text: string; entity: string}[]): Mention[] {
    const names = entities.flatMap(entity => entity.names.map(name => ({entity: entity.id, text: name.text, at: name.at})))
        .filter(name => [...name.text].length >= 2)
        .sort((a, b) => b.text.length - a.text.length || comparePosition(a.at, b.at));
    // 每个字串最早的登记：它在某段还没登记时，更晚的登记也都还没有，所以某段的归属只看它一个。登记位置相同的取
    // 排在前面的那个。
    const earliest = new Map<string, {entity: string; at: Position}>();
    for (const name of names) if (!earliest.has(name.text)) earliest.set(name.text, name);
    const notesAt = new Map<string, typeof notes>();
    for (const note of notes) {
        const key = `${note.at.chapter}.${note.at.paragraph}`;
        const list = notesAt.get(key) ?? [];
        list.push(note);
        notesAt.set(key, list);
    }
    const occurring = occurrenceFinder(earliest.keys());
    const rank = new Map([...earliest.keys()].map((text, index) => [text, index]));
    const result: Mention[] = [];
    for (const source of sources) {
        source.paragraphs.forEach((paragraph, index) => {
            const at = {chapter: source.chapter, paragraph: index + 1};
            const taken = new Uint8Array(paragraph.length);
            const claim = (start: number, end: number): boolean => {
                for (let i = start; i < end; i++) if (taken[i]) return false;
                taken.fill(1, start, end);
                return true;
            };
            const here = [...(notesAt.get(`${at.chapter}.${at.paragraph}`) ?? [])].sort((a, b) => b.text.length - a.text.length);
            // 草稿指定的提及先占位，可以是登记过的称呼，也可以是“她”“这只狐狐”这类代称。
            for (const note of here) {
                for (let start = paragraph.indexOf(note.text); start >= 0; start = paragraph.indexOf(note.text, start + note.text.length)) {
                    if (claim(start, start + note.text.length)) result.push({entity: note.entity, text: note.text, at, start, end: start + note.text.length, via: "note"});
                }
            }
            // 按称呼的长短顺序（earliest 的插入顺序）。
            for (const text of [...occurring(paragraph)].sort((a, b) => rank.get(a)! - rank.get(b)!)) {
                const owner = earliest.get(text)!;
                if (comparePosition(owner.at, at) > 0) continue;
                for (let start = paragraph.indexOf(text); start >= 0; start = paragraph.indexOf(text, start + text.length)) {
                    if (claim(start, start + text.length)) result.push({entity: owner.entity, text, at, start, end: start + text.length, via: "match"});
                }
            }
        });
    }
    return result.sort((a, b) => comparePosition(a.at, b.at) || a.start - b.start);
}

/** 按“谁的哪个量”累加，并在原文给出数值的地方核对。 */
function runLedger(ledger: LedgerEntry[], issue: Report): void {
    const totals = new Map<string, number>();
    const holdings = new Map<string, Map<string, number>>();
    for (const item of [...ledger].sort((a, b) => comparePosition(a.at, b.at))) {
        const key = `${item.owner}\u0000${item.track}`;
        const subject = {records: [item.id]};
        if (item.op === "set" && typeof item.value === "number") {
            totals.set(key, item.value);
            item.running = item.value;
            continue;
        }
        if (item.op === "gain" || item.op === "spend") {
            if (item.amount === undefined) continue;
            if (!totals.has(key) && item.op === "spend") issue("warning", item.at.chapter, "ledger", `状态变动 ${item.id}：“${item.track}”还没有起点就出现了减少，累加结果从 0 算起`, subject);
            const next = (totals.get(key) ?? 0) + (item.op === "gain" ? item.amount : -item.amount);
            totals.set(key, next);
            item.running = next;
            if (typeof item.value === "number") {
                item.check = item.value === next ? "match" : "mismatch";
                if (item.check === "mismatch") issue("error", item.at.chapter, "ledger", `状态变动 ${item.id}：原文给出的数值是 ${item.value}，累加结果是 ${next}`, subject);
            }
            continue;
        }
        if (item.item && (item.op === "get" || item.op === "lose" || item.op === "use")) {
            const held = holdings.get(key) ?? new Map<string, number>();
            holdings.set(key, held);
            const current = held.get(item.item) ?? 0;
            if (item.op === "get") held.set(item.item, current + (item.amount ?? 1));
            else {
                if (current <= 0) issue("warning", item.at.chapter, "ledger", `状态变动 ${item.id}：${item.op === "use" ? "用掉" : "失去"}了一件没有“得到”记录的东西 ${item.item}`, subject);
                held.set(item.item, Math.max(0, current - (item.amount ?? 1)));
            }
        }
    }
}

/**
 * 检查有没有提前用了后文才出现的称呼。
 * 只能查字面：某条记录的文字里出现了一个在它的位置之后才登记的称呼，就给出警告。
 */
function checkNameLeaks(dataset: Dataset, issue: Report): void {
    const names = dataset.entities.flatMap(entity => entity.names.map(name => ({text: name.text, at: name.at}))).filter(name => [...name.text].length >= 2);
    const longFirst = [...names].sort((a, b) => b.text.length - a.text.length);
    // 每条记录只看它的文字里出现的称呼：抹掉称呼只会让文字变少，原来没有的称呼抹完也不会冒出来。
    const occurring = occurrenceFinder(names.map(name => name.text));
    const check = (what: string, text: string | undefined, at: Position, record: string) => {
        if (!text) return;
        const present = occurring(text);
        if (present.size === 0) return;
        let rest = text;
        // 先抹掉此时已经可用的称呼（长的优先），剩下的文字里再出现后文称呼才算泄露。
        for (const name of longFirst) if (present.has(name.text) && comparePosition(name.at, at) <= 0) rest = rest.split(name.text).join("\u0000");
        const leaked = [...new Set(names.filter(item => present.has(item.text) && comparePosition(item.at, at) > 0 && rest.includes(item.text)).map(item => `“${item.text}”（${item.at.chapter}.${item.at.paragraph} 才出现）`))];
        if (leaked.length) issue("warning", at.chapter, "name-leak", `${what} 用了后文才出现的称呼：${leaked.join("、")}`, {records: [record]});
    };
    for (const item of dataset.entities) {
        check(`对象 ${item.id} 的标签`, item.label, item.at, item.id);
        check(`对象 ${item.id} 的说明`, item.note, item.at, item.id);
    }
    for (const item of dataset.beats) check(`段落块 ${item.id}`, item.gist, item.at, item.id);
    for (const item of dataset.statements) {
        check(`说法 ${item.id}`, item.text, item.at, item.id);
        check(`说法 ${item.id} 的理由`, item.reason, item.at, item.id);
    }
    for (const item of dataset.episodes) {
        check(`情节 ${item.id}`, `${item.title}\n${item.summary}\n${item.outcome ?? ""}`, item.at, item.id);
        for (const step of item.steps) check(`情节 ${item.id} 的步骤`, step.text, {chapter: step.evidence.chapter, paragraph: step.evidence.to}, item.id);
    }
    for (const item of dataset.knowledge) check(`知情 ${item.id}`, item.how, item.at, item.id);
    for (const item of dataset.ledger) check(`状态变动 ${item.id}`, item.reason, item.at, item.id);
    for (const item of dataset.questions) check(`疑问 ${item.id}`, item.text, item.at, item.id);
    for (const item of dataset.times) check(`时间点 ${item.id}`, item.label, item.at, item.id);
    for (const item of dataset.secrets) check(`秘密 ${item.id}`, item.title, item.at, item.id);
}
