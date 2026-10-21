/**
 * 模型写出的草稿在交给编译程序之前的整理：纠正常见的格式小毛病、逐条检查、应用修复、丢弃修不好的记录。这些都是
 * 机械处理，不改变任何一条记录的含义。
 *
 * 搬自 w00005 t29 `draft-tools.ts`，处理规则不变；不同的是问题带着结构化的归属（`Problem.subject`），兜底丢弃按它
 * 找记录，不再从提示文字里截编号。结构问题的说明文字由 TypeBox 给出，和原来 zod 的措辞不同（只出现在给模型的核对
 * 清单里，模型输出有格式错误时才有）。
 */

import {Value} from "typebox/value";

import type {Dataset} from "../core/dataset";
import {FACETS, FAMILIES} from "../core/dataset";
import type {IssueSubject} from "./compile";
import {DRAFT_SECTION_SCHEMAS, DRAFT_SECTIONS, parseWith, type DraftSection} from "./draft-schema";

/**
 * 模型写的一章草稿，还没经过检查：各部分是任意形状的记录。这个模块处理的都是检查之前的模型输出，所以用 `any`；
 * 经过 `checkDraft` 与编译之后才有 `ChapterDraft` 的类型。
 */
export type RawDraft = {chapter: number} & Partial<Record<DraftSection, any[]>>;

/** 一条要修或要丢的问题：`message` 给模型看，`subject` 给程序找记录。 */
export interface Problem {
    message: string;
    subject: ProblemSubject;
}

/** 编译问题的归属，另加检查时格式不对的那条记录本身（没有可用编号时按对象身份找）。 */
export interface ProblemSubject extends IssueSubject {
    section?: DraftSection;
    record?: unknown;
}

const WITH_ID = new Set<DraftSection>(["times", "beats", "entities", "secrets", "statements", "episodes", "knowledge", "ledger", "questions"]);

/** 模型常把只有一个元素的数组写成单个字符串；这些字段在这里补回数组。 */
const ARRAY_FIELDS: Partial<Record<DraftSection, string[]>> = {
    times: ["at"], statements: ["about", "premises"], secrets: ["about"], episodes: ["at"], knowledge: ["at"], ledger: ["at"],
    questions: ["at", "about"], questionUpdates: ["at"],
};

/** 同样的毛病出现在“对象数组”上：只有一项时模型会省掉方括号。 */
const OBJECT_LIST_FIELDS: Partial<Record<DraftSection, string[]>> = {times: ["rel"], statements: ["rel"], episodes: ["who", "steps", "links"], entities: ["names"]};

function normalizeRecord(section: DraftSection, record: any): any {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const result: any = {...record};
    // null 在草稿里只有两处有含义：副文本段落块的 time，和来源不明的 by。其它地方的 null 等于没写。
    for (const key of Object.keys(result)) if (result[key] === null && !(section === "beats" && key === "time")) delete result[key];
    for (const field of ARRAY_FIELDS[section] ?? []) if (typeof result[field] === "string") result[field] = [result[field]];
    // 大类写成了清单之外的词：归到“其他”，把原来的词留作小标签，内容不丢。
    if (section === "statements" && typeof result.family === "string" && !(FAMILIES as readonly string[]).includes(result.family)) {
        if (!result.label) result.label = result.family;
        result.family = "other";
    }
    if (section === "statements" && result.src && typeof result.src === "object") {
        const src = {...result.src};
        for (const key of Object.keys(src)) if (src[key] === null && key !== "by") delete src[key];
        if (typeof src.at === "string") src.at = [src.at];
        if (typeof src.to === "string") src.to = [src.to];
        // 模型常把“旁白转述某人的看法”写成旁白加 by，却忘了写 kind。按规则这就是那个人的看法，补成 belief。
        // 不补的话这条会因为“旁白不写 by”报错，在不修复的配置下整条被丢掉（t29 试跑 006 因此丢了 16 条说法）。
        if (src.ch === "narrator" && typeof src.by === "string") {
            if (result.kind === undefined) result.kind = "belief";
            else if (result.kind === "fact") delete src.by;
        }
        result.src = src;
    }
    for (const field of OBJECT_LIST_FIELDS[section] ?? []) if (result[field] && typeof result[field] === "object" && !Array.isArray(result[field])) result[field] = [result[field]];
    // 相隔的天数偶尔被写成字符串；数字串直接转成数字。
    if (section === "times" && Array.isArray(result.rel)) result.rel = result.rel.map((rel: any) => (rel && typeof rel === "object" && typeof rel.days === "string" && /^\d+$/u.test(rel.days) ? {...rel, days: Number(rel.days)} : rel));
    if (section === "beats") {
        for (const key of ["from", "to"]) if (typeof result[key] === "string" && /^\d+$/u.test(result[key])) result[key] = Number(result[key]);
    }
    if (section === "ledger" && typeof result.amount === "number" && result.amount < 0) result.amount = -result.amount;
    if (section === "entities" && Array.isArray(result.names)) result.names = result.names.map((name: any) => (name && typeof name === "object" ? Object.fromEntries(Object.entries(name).filter(([, value]) => value !== null)) : name));
    if (section === "episodes") {
        // 地点写成了名字而不是对象编号：去掉这一项，情节本身留下。
        if (typeof result.place === "string" && !/^e\d{1,4}-\d{1,4}$/u.test(result.place)) delete result.place;
        if (Array.isArray(result.who)) result.who = result.who.map((who: any) => (typeof who === "string" ? {e: who} : who && typeof who === "object" ? Object.fromEntries(Object.entries(who).filter(([, value]) => value !== null)) : who));
        if (Array.isArray(result.steps)) result.steps = result.steps.map((step: any) => (step && Array.isArray(step.at) && step.at.length === 1 ? {...step, at: step.at[0]} : step));
    }
    return result;
}

/** 把模型的回复整理成草稿的形状：只取认识的各部分，每条记录纠正常见的格式小毛病。 */
export function normalizeDraft(raw: any, chapter: number): RawDraft {
    const draft: RawDraft = {chapter};
    for (const section of DRAFT_SECTIONS) {
        const value = raw?.[section];
        if (!Array.isArray(value)) continue;
        draft[section] = value.map(record => normalizeRecord(section, record)).filter(record => record !== null);
    }
    return draft;
}

/**
 * 称呼和提及标错了段落时，由程序在本章原文里找到正确的位置。
 * 称呼取它在本章第一次出现的段落（不早于对象自己出现的位置）；提及是针对某一处的，只在前后两段内找最近的一处。找不到的保持原样，交给后面的检查处理。
 */
export function fixPositions(draft: RawDraft, paragraphs: string[]): RawDraft {
    const chapter = draft.chapter;
    const paragraphOf = (ref: unknown): number | null => {
        const match = typeof ref === "string" ? /^(\d+)\.(\d+)$/u.exec(ref) : null;
        return match && Number(match[1]) === chapter ? Number(match[2]) : null;
    };
    const firstFrom = (text: string, from: number): number | null => {
        for (let index = Math.max(from, 1); index <= paragraphs.length; index++) if (paragraphs[index - 1]!.includes(text)) return index;
        return null;
    };
    const fixName = (name: any, from: number) => {
        const at = paragraphOf(name?.at);
        if (typeof name?.text !== "string" || !name.text || (at !== null && paragraphs[at - 1]?.includes(name.text))) return name;
        const found = firstFrom(name.text, from);
        return found === null ? name : {...name, at: `${chapter}.${found}`};
    };
    const next: RawDraft = {...draft};
    if (draft.entities) next.entities = draft.entities.map(entity => (Array.isArray(entity?.names) ? {...entity, names: entity.names.map((name: any) => fixName(name, paragraphOf(entity.at) ?? 1))} : entity));
    if (draft.names) next.names = draft.names.map(name => fixName(name, 1));
    if (draft.mentions) {
        next.mentions = draft.mentions.map(mention => {
            const at = paragraphOf(mention?.at);
            if (at === null || typeof mention?.text !== "string" || paragraphs[at - 1]?.includes(mention.text)) return mention;
            for (const offset of [1, -1, 2, -2]) if (paragraphs[at + offset - 1]?.includes(mention.text)) return {...mention, at: `${chapter}.${at + offset}`};
            return mention;
        });
    }
    return next;
}

/** 段落块必须连续覆盖全章。边界对不齐时按顺序接上，这是纯机械的修正。 */
export function fixBeats(beats: any[], total: number): any[] {
    const sorted = beats.filter(item => item && Number.isInteger(item.from) && Number.isInteger(item.to)).sort((a, b) => a.from - b.from);
    const result: any[] = [];
    let next = 1;
    for (const beat of sorted) {
        const to = Math.min(beat.to, total);
        if (to < next) continue;
        result.push({...beat, from: next, to});
        next = to + 1;
    }
    if (result.length && next <= total) result[result.length - 1] = {...result.at(-1), to: total};
    return result;
}

/** 逐条按结构检查；不合格的记录不进入编译，问题单独列出，所以一条坏记录不会拖累整章。多写的字段直接去掉。 */
export function checkDraft(draft: RawDraft): {clean: RawDraft; problems: Problem[]} {
    const clean: RawDraft = {chapter: draft.chapter};
    const problems: Problem[] = [];
    for (const section of DRAFT_SECTIONS) {
        const records = draft[section];
        if (!records) continue;
        const kept: any[] = [];
        for (const record of records) {
            const schema = DRAFT_SECTION_SCHEMAS[section];
            const candidate = Value.Clean(schema, structuredClone(record));
            const parsed = parseWith(schema, candidate);
            if (parsed.ok) {
                kept.push(candidate);
                continue;
            }
            const label = typeof record?.id === "string" ? record.id : JSON.stringify(record).slice(0, 80);
            const details = parsed.problems.map(item => `${item.path.replace(/^\//u, "").replaceAll("/", ".") || "整条"} ${item.message}`).join("；");
            problems.push({message: `${section} 里的记录 ${label} 格式不对：${details}`, subject: {section, record}});
        }
        clean[section] = kept;
    }
    return {clean, problems};
}

/** 应用模型给出的修正：按编号整条替换或新增、删除、整段重写没有编号的部分。 */
/** 草稿里秘密的编号（与 draft-schema.ts 的 secretId 相同）：知情记录的 about 只能是说法或秘密，两者编号互斥。 */
const SECRET_ID = /^x\d{1,4}-\d{1,4}$/u;

/**
 * 去掉这本书关掉的那几类记录（docs/specs/story/ingest.md 输出 18）：关数值时去掉 ledger；关秘密时去掉 secrets、
 * 说法的 secret 字段，以及 about 是秘密编号的知情（指向说法的知情留着）。在检查之前做：关掉的记录不算质量问题，
 * 不该进核对清单，也不计入兜底丢弃。返回去掉了几条，给这一章的问题说明用。
 */
export function stripDisabled(draft: RawDraft, features: {ledger: boolean; secrets: boolean}): {draft: RawDraft; removed: {ledger: number; secrets: number; secretRefs: number; knowledge: number}} {
    const removed = {ledger: 0, secrets: 0, secretRefs: 0, knowledge: 0};
    const result: RawDraft = {...draft};
    if (!features.ledger && draft.ledger?.length) {
        removed.ledger = draft.ledger.length;
        delete result.ledger;
    }
    if (!features.secrets) {
        if (draft.secrets?.length) {
            removed.secrets = draft.secrets.length;
            delete result.secrets;
        }
        if (draft.statements) result.statements = draft.statements.map(item => {
            if (!item || typeof item !== "object" || !("secret" in item)) return item;
            removed.secretRefs += 1;
            const {secret: _secret, ...rest} = item;
            return rest;
        });
        if (draft.knowledge) {
            const kept = draft.knowledge.filter(item => !(typeof item?.about === "string" && SECRET_ID.test(item.about)));
            removed.knowledge = draft.knowledge.length - kept.length;
            result.knowledge = kept;
        }
    }
    return {draft: result, removed};
}

export function applyPatch(draft: RawDraft, patch: any, chapter: number): RawDraft {
    const next: RawDraft = structuredClone(draft);
    const replace = normalizeDraft(patch?.replace ?? {}, chapter);
    for (const section of DRAFT_SECTIONS) {
        const records = replace[section];
        if (!records || !WITH_ID.has(section)) continue;
        const list = next[section] ?? (next[section] = []);
        for (const record of records) {
            const index = list.findIndex(item => item?.id === record.id);
            if (index >= 0) list[index] = record;
            else list.push(record);
        }
    }
    if (Array.isArray(patch?.remove)) {
        const remove = new Set<string>(patch.remove.filter((id: unknown): id is string => typeof id === "string"));
        for (const section of DRAFT_SECTIONS) if (WITH_ID.has(section) && next[section]) next[section] = next[section]!.filter(item => !remove.has(item?.id));
    }
    const rewrite = normalizeDraft(patch?.rewrite ?? {}, chapter);
    for (const section of ["names", "mentions", "episodeLinks", "questionUpdates"] as const) if (rewrite[section]) next[section] = rewrite[section];
    if (next.beats) next.beats = [...next.beats].sort((a, b) => (a?.from ?? 0) - (b?.from ?? 0));
    return next;
}

/**
 * 从一条记录里摘掉对某个不存在的记录的引用。
 * 只处理“可有可无”的位置（涉及对象、听者、依据、前后文关系、情节连接等）；必填的位置摘不掉，返回 false，由调用方丢弃整条记录。
 */
function pruneReference(record: any, missing: string): boolean {
    let pruned = false;
    const dropFrom = (holder: any, key: string, test: (item: any) => boolean) => {
        if (!Array.isArray(holder?.[key])) return;
        const kept = holder[key].filter((item: any) => !test(item));
        if (kept.length !== holder[key].length) {
            holder[key] = kept;
            pruned = true;
        }
    };
    for (const key of ["about", "premises"]) dropFrom(record, key, item => item === missing);
    dropFrom(record?.src, "to", item => item === missing);
    for (const key of ["rel", "links"]) dropFrom(record, key, item => item?.to === missing);
    if (Array.isArray(record?.who)) {
        for (const who of record.who) {
            if (who?.as === missing) {
                delete who.as;
                pruned = true;
            }
        }
        if (record.who.length > 1) dropFrom(record, "who", item => item?.e === missing);
    }
    for (const key of ["time", "place", "secret", "answer"]) {
        if (record?.[key] === missing && !(key === "time" && "from" in record)) {
            delete record[key];
            pruned = true;
        }
    }
    // 段落块的时间点被丢掉时，把段落块的时间改成“没有故事时间”而不是丢掉段落块：段落块要连续盖满全章，丢一块就会连累整章
    // （t32 改前管线的第 4 章因此整章丢失）。
    if ("from" in (record ?? {}) && record.time === missing) {
        record.time = null;
        pruned = true;
    }
    return pruned;
}

/**
 * 修复轮数用完后的兜底：按问题点到的记录逐条丢弃，直到这一章能编译。丢一条可能让引用它的记录也出问题，所以要反复
 * 检查；找不到可丢的记录就停下，把剩下的问题交回调用方（这一章不能提交）。
 *
 * `evaluate` 对候选草稿做检查与编译，返回检查后的草稿与仍要消除的问题。每一轮对每个问题只处理它点到的第一条本章
 * 记录，与原管线一样尽量少丢。
 */
export function dropOffending(draft: RawDraft, evaluate: (candidate: RawDraft) => {clean: RawDraft; errors: Problem[]}): {clean: RawDraft; remaining: Problem[]; dropped: number} {
    let current: RawDraft = structuredClone(draft);
    const pruned = new Set<string>();
    let dropped = 0;
    const withId = (id: string) => DRAFT_SECTIONS.flatMap(section => (WITH_ID.has(section) ? current[section] ?? [] : [])).find(item => item?.id === id);
    const removeWhere = (section: DraftSection, test: (item: any) => boolean): boolean => {
        const before = current[section]?.length ?? 0;
        current[section] = (current[section] ?? []).filter(item => !test(item));
        const removed = before - current[section]!.length;
        dropped += removed;
        return removed > 0;
    };
    for (let round = 0; round < 12; round++) {
        const {clean, errors} = evaluate(current);
        if (!errors.length) return {clean, remaining: [], dropped};
        let changed = false;
        for (const {subject} of errors) {
            if (subject.link) {
                const {from, to} = subject.link;
                changed = removeWhere("episodeLinks", item => item?.from === from && item?.to === to) || changed;
            } else if (subject.questionUpdate !== undefined) {
                changed = removeWhere("questionUpdates", item => item?.q === subject.questionUpdate) || changed;
            } else if (subject.name !== undefined) {
                const text = subject.name;
                const before = JSON.stringify([current.names, current.entities]);
                current.names = (current.names ?? []).filter(item => item?.text !== text);
                current.entities = (current.entities ?? []).map(item => (Array.isArray(item?.names) ? {...item, names: item.names.filter((entry: any) => entry?.text !== text)} : item));
                if (JSON.stringify([current.names, current.entities]) !== before) {
                    changed = true;
                    dropped += 1;
                }
            } else if (subject.mention !== undefined) {
                changed = removeWhere("mentions", item => item?.text === subject.mention) || changed;
            } else if (subject.records) {
                const id = subject.records.find(candidate => withId(candidate) !== undefined);
                if (id === undefined) continue;
                // 只是引用了不存在的记录时，先试着把那个引用摘掉；摘过之后同一个引用还报错，才整条丢弃。
                const target = withId(id);
                if (subject.missing && !pruned.has(`${id}:${subject.missing}`) && pruneReference(target, subject.missing)) {
                    pruned.add(`${id}:${subject.missing}`);
                    changed = true;
                    continue;
                }
                for (const section of DRAFT_SECTIONS) if (WITH_ID.has(section) && current[section]) changed = removeWhere(section, item => item?.id === id) || changed;
            } else if (subject.section && subject.record !== undefined) {
                // 格式不对、说不出编号的记录：按对象本身丢掉。
                const {section, record} = subject;
                changed = removeWhere(section, item => item === record) || changed;
            }
        }
        if (!changed) return {clean, remaining: errors, dropped};
    }
    const last = evaluate(current);
    return {clean: last.clean, remaining: last.errors, dropped};
}

/**
 * 清理模型写的整理稿：指向不存在的记录的内容去掉，不稳妥的合并拒绝，其余保留。
 * 合并会改写所有引用，错了很难挽回，所以只接受有把握的：类别相同、称呼相同或一个称呼包含另一个、两者之间没有“身份同一”的说法。
 * 马甲和本人靠身份说法相连，是有意分开的两个对象，不能合并。
 */
export function sanitizeConsolidation(reply: any, chapter: number, dataset: Dataset): {value: any; dropped: string[]} {
    const dropped: string[] = [];
    const entities = new Map(dataset.entities.map(item => [item.id, item]));
    const targets = new Set([...dataset.statements.map(item => item.id), ...dataset.episodes.map(item => item.id)]);
    const episodes = new Set(dataset.episodes.map(item => item.id));
    const linked = (a: string, b: string) => dataset.statements.some(item => item.family === "identity" && item.about.includes(a) && item.about.includes(b));
    const merges: any[] = [];
    for (const item of Array.isArray(reply?.merges) ? reply.merges : []) {
        const keep = entities.get(item?.keep), drop = entities.get(item?.drop);
        const refuse = (why: string) => dropped.push(`合并 ${item?.drop} 到 ${item?.keep} 被拒绝：${why}`);
        if (!keep || !drop || keep.id === drop.id) {
            refuse("对象不存在");
            continue;
        }
        if (typeof item.reason !== "string" || !item.reason) {
            refuse("没有写理由");
            continue;
        }
        if (keep.kind !== drop.kind) {
            refuse("类别不同");
            continue;
        }
        if (linked(keep.id, drop.id)) {
            refuse("两者之间有身份同一的说法，是有意分开的马甲和本人");
            continue;
        }
        // “任务”“学院”这类两个字的泛称出现在别的称呼里不算数，包含关系要求较短的称呼至少三个字。
        const contains = (long: string, short: string) => [...short].length >= 3 && long.includes(short);
        const related = keep.names.some(a => drop.names.some(b => a.text === b.text || contains(a.text, b.text) || contains(b.text, a.text)));
        if (!related) {
            refuse("没有相同或互相包含的称呼");
            continue;
        }
        merges.push({keep: keep.id, drop: drop.id, reason: item.reason});
    }
    // 模型有时把摘要写成一句一条（entity、facet、text、deps 平铺），这里按对象和方面归并成规定的形状。
    const grouped = new Map<string, {entity: string; facet: string; items: {text: string; deps: string[]}[]}>();
    for (const summary of Array.isArray(reply?.summaries) ? reply.summaries : []) {
        if (!entities.has(summary?.entity) || !(FACETS as readonly string[]).includes(summary?.facet)) {
            dropped.push(`摘要 ${summary?.entity}/${summary?.facet}：对象或方面不存在`);
            continue;
        }
        const rows = Array.isArray(summary.items) ? summary.items : [summary];
        for (const item of rows) {
            const deps = (Array.isArray(item?.deps) ? item.deps : typeof item?.deps === "string" ? [item.deps] : []).filter((dep: unknown) => typeof dep === "string" && targets.has(dep));
            if (typeof item?.text !== "string" || !item.text || !deps.length) {
                dropped.push(`摘要 ${summary.entity}/${summary.facet} 的一句话没有有效依据：${String(item?.text).slice(0, 30)}`);
                continue;
            }
            const key = `${summary.entity}\u0000${summary.facet}`;
            const group = grouped.get(key) ?? {entity: summary.entity as string, facet: summary.facet as string, items: [] as {text: string; deps: string[]}[]};
            grouped.set(key, group);
            group.items.push({text: item.text, deps});
        }
    }
    const arcs: any[] = [];
    for (const arc of Array.isArray(reply?.arcs) ? reply.arcs : []) {
        const list = (Array.isArray(arc?.episodes) ? arc.episodes : []).filter((id: unknown) => typeof id === "string" && episodes.has(id));
        if (!list.length || typeof arc?.title !== "string" || typeof arc?.summary !== "string") {
            dropped.push(`故事线 ${arc?.id}：没有有效的情节或缺少标题`);
            continue;
        }
        arcs.push({id: `a${chapter}-${arcs.length + 1}`, title: arc.title, summary: arc.summary, episodes: list, status: arc.status === "closed" || arc.ongoing === false ? "closed" : "ongoing"});
    }
    return {value: {through: chapter, merges, summaries: [...grouped.values()], arcs}, dropped};
}
