/**
 * 程序能开出的“核对清单”：拿本章原文和草稿逐项对账，列出模型最常漏或写错、而程序自己又改不了的地方，交给模型核对并补漏。
 * 四类：结构（编译检查出的错）、对账（原文有钱数、任务而草稿没记）、归属（说话人、心理写成事实、知情写反）、身份（像是揭示身份却没有 identity 说法）。
 * 这里只提出问题，不替模型决定；模型可以在 skip 里说明为什么不用改。
 *
 * 搬自 w00005 t29 `v2/reconcile.ts`，规则与文字不变（清单文字是发给模型的）。“神典石”“粉丝”是原管线按样例书加的
 * 对账词：只在原文出现这些词时才起作用，别的书不受影响。
 */

import type {Dataset} from "../core/dataset";
import {visibleAt as visible} from "../core/position";
import type {RawDraft} from "./draft-tools";

export interface ReconcileInput { draft: RawDraft; chapter: number; paragraphs: string[]; prior: Dataset | null; structural: string[] }
export interface Checklist { items: string[]; counts: Record<string, number> }

const LIMITS = { 对账: 8, 任务: 5, 归属: 8, 身份: 4, 工具: 3 };
const NUMBER = /[0-9０-９]+|[一二三四五六七八九十百千万两零]+/u;
const TASK_HINT = /完成|发布|新任务|奖励|进度|进行中|接受|触发|达成/u;
// “就是”太常见（“俨然就是个小恶魔”），只认揭示身份时的说法：真名、本名、变身后的、原来就是、竟然是。
const IDENTITY_HINT = /真名|真实身份|本名|真身|变身后的|原来就是|其实就是|竟是|竟然是|居然是|就是[^，。！？]{0,4}(?:本人|自己)/u;
const TOOL_HINT = /摄像头|陷阱|探查器|装置|手机|电脑|书|星|面具|武器|剑|杖/u;

/** 把草稿里的位置写法（9.7、9.7-9.9、9.7-9.9 这种跨段范围）解析成本章的段号；别的章的位置忽略。 */
export function paragraphsOf(ref: unknown, chapter: number): number[] {
    const refs = Array.isArray(ref) ? ref : [ref];
    const result: number[] = [];
    for (const item of refs) {
        const match = typeof item === "string" ? /^(\d+)\.(\d+)(?:-(?:(\d+)\.)?(\d+))?$/u.exec(item.trim()) : null;
        if (!match || Number(match[1]) !== chapter) continue;
        const from = Number(match[2]), to = match[4] ? Number(match[4]) : from;
        for (let paragraph = from; paragraph <= Math.min(to, from + 60); paragraph++) result.push(paragraph);
    }
    return result;
}

const snippet = (text: string, keyword: string, width = 28): string => {
    const index = Math.max(0, text.indexOf(keyword));
    const start = Math.max(0, index - width), end = Math.min(text.length, index + keyword.length + width);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
};

export function buildChecklist(input: ReconcileInput): Checklist {
    const { draft, chapter, paragraphs, prior } = input;
    const items: string[] = [];
    const counts: Record<string, number> = {};
    const push = (kind: keyof typeof LIMITS | "结构", text: string) => {
        if (kind !== "结构" && (counts[kind] ?? 0) >= LIMITS[kind]) return;
        counts[kind] = (counts[kind] ?? 0) + 1;
        items.push(`C${items.length + 1} [${kind === "任务" || kind === "工具" ? "对账" : kind}] ${text}`);
    };
    for (const problem of input.structural) push("结构", problem);

    const readAt = { chapter, paragraph: 1 };
    // 已知的称呼：以前的对象（此时可见的称呼）、本章新建的对象、本章给旧对象加的称呼。
    const names = new Map<string, Set<string>>();
    const addName = (id: unknown, text: unknown) => { if (typeof id !== "string" || typeof text !== "string" || !text) return; (names.get(id) ?? names.set(id, new Set()).get(id)!).add(text); };
    if (prior) for (const entity of prior.entities) if (visible(entity.at, readAt)) for (const name of entity.names) if (visible(name.at, readAt)) addName(entity.id, name.text);
    for (const entity of draft.entities ?? []) for (const name of entity?.names ?? []) addName(entity?.id, name?.text);
    for (const name of draft.names ?? []) addName(name?.entity, name?.text);
    const secretsAbout = new Map<string, string[]>();
    if (prior) for (const secret of prior.secrets) secretsAbout.set(secret.id, secret.about);
    for (const secret of draft.secrets ?? []) if (typeof secret?.id === "string") secretsAbout.set(secret.id, Array.isArray(secret.about) ? secret.about : []);

    const cited = (records: any[] | undefined, pick: (record: any) => unknown): Set<number> => {
        const set = new Set<number>();
        for (const record of records ?? []) for (const paragraph of paragraphsOf(pick(record), chapter)) set.add(paragraph);
        return set;
    };
    const ledgerParas = cited(draft.ledger, record => record?.at);
    const taskParas = cited((draft.ledger ?? []).filter(record => typeof record?.track === "string" && record.track.includes("任务")), record => record?.at);
    const identityParas = cited((draft.statements ?? []).filter(record => record?.family === "identity"), record => record?.src?.at);

    // 对账：原文里带钱数、粉丝数的段落，账本里要有记录引用它。量的名字来自已有的账本，再加上这本书一定会出现的“神典石”。
    const trackWords = new Set<string>(["神典石", "粉丝", "关注者"]);
    if (prior) for (const entry of prior.ledger) if (entry.running !== undefined) trackWords.add(entry.track);
    paragraphs.forEach((text, index) => {
        const paragraph = index + 1;
        const word = [...trackWords].find(item => text.includes(item));
        if (!word || !NUMBER.test(text) || ledgerParas.has(paragraph)) return;
        push("对账", `第 ${chapter}.${paragraph} 段提到“${word}”和数字（${snippet(text, word)}），账本里没有引用这一段的记录：是余额、收入、支出或购买就补一笔 ledger；不是就在 skip 里说明。`);
    });
    paragraphs.forEach((text, index) => {
        const paragraph = index + 1;
        if (!text.includes("任务") || !TASK_HINT.test(text) || taskParas.has(paragraph)) return;
        push("任务", `第 ${chapter}.${paragraph} 段提到任务（${snippet(text, "任务")}），没有任务进度记录引用这一段：有发布、接受、进展或完成就记一条 track 为“任务：任务名”的 ledger；不是就 skip。`);
    });

    // 归属：台词和心理的 by 必须在所引段落前后出现过这个人的称呼；心理不能写成事实；知情不能写反。
    for (const statement of draft.statements ?? []) {
        const src = statement?.src;
        if (!src || typeof src !== "object") continue;
        // 只查台词。心理活动几乎总是视角人物的，而视角人物在自己的心理描写里很少被点名，查了全是误报（冒烟测试第 2、3 章各一条）。
        if (src.ch === "speech" && typeof src.by === "string") {
            const known = names.get(src.by);
            const paras = paragraphsOf(src.at, chapter);
            // 对话常常连着几段不写“某某说”，说话人靠这一场戏的上下文判断。所以查的范围是所引段落所在的整个段落块，
            // 再加前后两段；只有整场戏里都没出现过这个人的称呼才提出来（“脑子里响起一个声音”这类无主的话就是这样）。
            const window = new Set<number>();
            for (const paragraph of paras) {
                for (let offset = -2; offset <= 2; offset++) window.add(paragraph + offset);
                const beat = (draft.beats ?? []).find(item => Number.isInteger(item?.from) && Number.isInteger(item?.to) && item.from <= paragraph && paragraph <= item.to);
                if (beat) for (let index = beat.from; index <= beat.to; index++) window.add(index);
            }
            const seen = !known || [...window].some(paragraph => { const text = paragraphs[paragraph - 1]; return !!text && [...known].some(name => text.includes(name)); });
            if (!seen) push("归属", `说法 ${statement.id} 记为 ${[...known!][0]}（${src.by}）的台词，但所引段落 ${paras.join("、")} 所在的整场戏里都没有出现这个人的称呼：核对是谁说的。前后文能看出是谁说的就保留 by 并 skip；原文确实没有标明说话人的（例如“脑子里响起一个声音”），by 写 null，text 里写明“说话人不明”。`);
        }
        if (src.ch === "thought" && statement.kind === "fact") push("归属", `说法 ${statement.id} 来源是心理活动却写成事实：心理里的判断是这个人的看法，kind 应为 belief。`);
    }
    for (const knowledge of draft.knowledge ?? []) {
        if (knowledge?.state !== "unaware") continue;
        const about = secretsAbout.get(knowledge.about);
        if (about && about.includes(knowledge.who)) push("归属", `知情 ${knowledge.id}：${[...(names.get(knowledge.who) ?? [knowledge.who])][0]} 是秘密 ${knowledge.about} 的当事人，不会不知道自己的秘密。这条多半写反了（应是别人不知道这个秘密，或者是当事人对另一个秘密的不知道）：改正 who 和 about，或者删掉。`);
    }

    // 身份：像是在揭示身份的段落里出现了两个已知称呼，却没有 identity 说法引用它。
    const allNames = [...names.values()].flatMap(set => [...set]).filter(name => name.length >= 2);
    paragraphs.forEach((text, index) => {
        const paragraph = index + 1;
        if (!IDENTITY_HINT.test(text) || identityParas.has(paragraph)) return;
        const hit = allNames.filter(name => text.includes(name));
        if (new Set(hit).size < 2) return;
        push("身份", `第 ${chapter}.${paragraph} 段像是在把两个身份连起来（${snippet(text, hit[0]!)}），但没有 identity 说法引用这一段：确实揭示了身份就补 identity 说法、建秘密并写知情；不是就 skip。`);
    });

    // 工具写成了消耗：use 只用于用掉就没有的东西。
    for (const entry of draft.ledger ?? []) {
        if (entry?.op !== "use" || typeof entry.item !== "string") continue;
        const label = [...(names.get(entry.item) ?? [])][0] ?? (draft.entities ?? []).find(entity => entity?.id === entry.item)?.label ?? entry.item;
        if (TOOL_HINT.test(label)) push("工具", `账本 ${entry.id} 对“${label}”写了 use：use 只用于用掉就没有的东西，工具用了还在，不该记 use（删掉这条，或改成别的 op）。`);
    }
    return { items, counts };
}
