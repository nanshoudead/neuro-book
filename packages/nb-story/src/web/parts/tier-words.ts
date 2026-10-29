/**
 * 记录等级的人话（viewer 输出 57，开发者 2026-10-27 定的依据写法 A）：`tier.explain` 的结构化依据 → 一句结论与两行证据。
 * 文字只在这里写，`TierBadge` 只排版。
 */

import type {StoryResult} from "../../contract/contract";

type Explain = StoryResult<"tier.explain">;

export const FLAG_WORDS = {unconfirmed: "待证实", foreshadow: "伏笔候选"} as const;
export const TIER_WORDS = {1: "主线", 2: "有用", 3: "次要"} as const;
const FAMILY_WORDS: Record<string, string> = {
    kinship: "亲属", social: "交往", membership: "所属", attitude: "态度", identity: "身份", event: "事件", goal: "打算", trait: "特点",
    rule: "规则", possession: "拥有", location: "位置", other: "其他",
};

/** 阅读位置：读完全书时“读到……”不通，结论的写法要跟着变。 */
export interface Reading {
    atEnd: boolean;
    /** 阅读位置的写法，例如“第 20 章”。 */
    label: string;
}

/** 说法为什么是这一级，一句话。`family` 是说法的类别（没有先验时写进句子）。情节不能点开（输出 56），不走这里。 */
export function tierVerdict(explain: Explain, family: string | null, reading: Reading): string {
    const tier = explain.tier ?? 2;
    if (explain.flag === "unconfirmed") return `抽取时模型认为这是主线，但${reading.atEnd ? "直到最后，后文都" : `读到${reading.label}，后文还`}没有再提起它，先算作 ${tier} 级。`;
    if (explain.flag === "foreshadow") return `抽取时模型认为这是琐碎细节，但后文又提起了它，可能是伏笔，升为 ${tier} 级。`;
    const byPrior = explain.prior === null ? `按类别（${(family && FAMILY_WORDS[family]) ?? family ?? "其他"}）定为 ${tier} 级` : "暂按抽取时的判断";
    if (explain.ev === "unknown") {
        if (reading.atEnd) return `这条在最后几章，后面没有内容可以印证，${byPrior}。`;
        const where = explain.window === 0 ? "就在正读的这一章" : `刚读到不久（之后只读了 ${explain.window} 章）`;
        return `这条${where}，还看不出后文会不会再提，${byPrior}。`;
    }
    if (explain.prior === null) return `这本书抽取时没有给重要程度，按类别（${(family && FAMILY_WORDS[family]) ?? family ?? "其他"}）和后文的情况定为 ${tier} 级。`;
    if (tier < explain.prior) return `后文多次引用或提起它，从 ${explain.prior} 级升为 ${tier} 级。`;
    if (tier === explain.prior) return `抽取时模型给 ${explain.prior} 级，后文的情况与之相符。`;
    return `抽取时模型给 ${explain.prior} 级，按后文的情况定为 ${tier} 级。`;
}

/** 后文引用：分来源写，没有为“没有”。 */
export function citedWords(explain: Explain): string {
    const refs = explain.signals?.refs;
    if (!refs) return "没有";
    const parts = [
        refs.confirms ? `后文确认了它 ${refs.confirms} 次` : "",
        refs.contradicts ? `后文反驳了它 ${refs.contradicts} 次` : "",
        refs.revises ? `后文修正了它 ${refs.revises} 次` : "",
        refs.knowers ? `之后又有 ${refs.knowers} 人得知` : "",
        refs.secrets ? "被收进后来的秘密" : "",
        refs.answers ? "是悬念的答案" : "",
    ].filter(Boolean);
    return parts.length ? parts.join("；") : "没有";
}

/** 后文又提到：只写有没有（片段常不成词，开发者 2026-10-27 定不列）。 */
export function echoWords(explain: Explain): string {
    return (explain.signals?.echo.count ?? 0) > 0 ? "有" : "没有";
}
