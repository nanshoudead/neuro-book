/**
 * 出处“章.段”“章.段—章.段”的认法（docs/specs/story/qa.md 输出 8、24）：引擎核对答案与文字回复里的出处、网页把正文里的
 * 出处改成可点的链接，用的是同一条规则，没核实的出处与正文里的链接才对得上。纯函数，不碰 node，网页可以直接引。
 */

/** 一个完整的出处（也接受 en dash 与短横线作范围的连接号）。 */
const REF = /^(\d+)\.(\d+)(?:[—–-](\d+)\.(\d+))?$/u;
/**
 * 文字里形如出处的片段：前面不紧挨数字或小数点，后面不紧跟数字、也不紧跟“小数点加数字”。所以句末的“39.1。”
 * “39.1.”算出处，“3.5.0”这类三段数字不算。在 NFKC 归一后的文字上用，全角的“３９．１”与半角同样识别。
 */
export const REF_IN_TEXT = /(?<![\d.])(\d+)\.(\d+)(?:[—–-](\d+)\.(\d+))?(?!\d)(?!\.\d)/gu;

export interface ParsedRef {
    readonly from: {readonly chapter: number; readonly paragraph: number};
    readonly to: {readonly chapter: number; readonly paragraph: number};
}

/** 文字里的一处出处：`start`、`end` 是在原文里的位置（UTF-16 下标，左闭右开），`text` 是归一后的片段。 */
export interface RefSpan {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/**
 * 找出文字里全部形如出处的片段，带原文位置。逐个字符做 NFKC 并记下每个归一后的字符来自原文哪里，在归一后的文字上
 * 匹配、再换回原文位置：全角的“３９．１”照样认出来，而改写正文时只换出处本身，别的全角标点原样留着（整段归一会把
 * 中文标点也变成半角）。
 */
export function findRefs(text: string): RefSpan[] {
    let normalized = "";
    const origin: number[] = [];
    for (let index = 0; index < text.length; ) {
        const char = String.fromCodePoint(text.codePointAt(index)!);
        for (const piece of char.normalize("NFKC")) {
            for (let unit = 0; unit < piece.length; unit += 1) origin.push(index);
            normalized += piece;
        }
        index += char.length;
    }
    origin.push(text.length);
    return [...normalized.matchAll(REF_IN_TEXT)].map(match => {
        const from = match.index;
        const to = from + match[0].length;
        // 结束位置取最后一个归一字符所在原文字符之后。
        const lastOrigin = origin[to - 1]!;
        const end = lastOrigin + String.fromCodePoint(text.codePointAt(lastOrigin)!).length;
        return {start: origin[from]!, end, text: match[0]};
    });
}

/** 文字里全部形如出处的片段（归一后的写法，按出现顺序，可能重复）。 */
export function refsInText(text: string): string[] {
    return findRefs(text).map(span => span.text);
}

/** 解析一个出处；写法不对时为 null。 */
export function parseRef(ref: string): ParsedRef | null {
    const match = REF.exec(ref.normalize("NFKC").trim());
    if (!match) return null;
    const from = {chapter: Number(match[1]), paragraph: Number(match[2])};
    return {from, to: match[3] === undefined ? from : {chapter: Number(match[3]), paragraph: Number(match[4])}};
}

/** 标准写法：半角数字、范围用“—”。写法不对时原样返回。 */
export function normalizeRef(ref: string): string {
    const parsed = parseRef(ref);
    if (parsed === null) return ref;
    const one = (position: ParsedRef["from"]): string => `${position.chapter}.${position.paragraph}`;
    return parsed.from === parsed.to ? one(parsed.from) : `${one(parsed.from)}—${one(parsed.to)}`;
}
