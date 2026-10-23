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

/** 文字里全部形如出处的片段（归一后的写法，按出现顺序，可能重复）。 */
export function refsInText(text: string): string[] {
    return [...text.normalize("NFKC").matchAll(REF_IN_TEXT)].map(match => match[0]);
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
