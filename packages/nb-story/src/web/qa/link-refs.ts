/**
 * 把回答正文里的出处“章.段”“章.段—章.段”改成可点的链接 `[38.12](paragraph://38.12)`（docs/specs/story/viewer.md 的问答页）。
 * 出处怎样认用 `contract/refs.ts`，与引擎核对出处、列“没核实的出处”是同一条规则。
 *
 * 只改纯文字：代码、行内代码、已有的链接与图片、裸网址、HTML 里的都不动。哪里是纯文字由 Markdown 的词法器说了算（与
 * 显示端 nb-markdown 同一份解析），不另写一套排除规则：按出现顺序在原文里找出每个纯文字单元的位置，出处整个落在这些
 * 区间里才改。流式生成时，文末的出处可能还没写完（“38.1”后面马上来“2”），先不改。
 */

import type {Token} from "marked";

import {findRefs, normalizeRef} from "../../contract/refs";

/** 词法器：显示端用的那一份（`defaultMarkdownLanguage().lexer()`），由调用方给，本模块不直接引编辑内核。 */
export type MarkdownLexer = () => {lex(text: string): Token[]};

/** 出处链接的地址：`paragraph://` 加标准写法。 */
export const REF_SCHEME = "paragraph://";

export function refTarget(ref: string): string {
    return `${REF_SCHEME}${normalizeRef(ref)}`;
}

/** 纯文字在原文里的区间（左闭右开，按位置排）。 */
export function plainTextRanges(source: string, tokens: readonly Token[]): Array<readonly [number, number]> {
    const ranges: Array<readonly [number, number]> = [];
    let cursor = 0;
    const skip = (raw: string): void => {
        const at = source.indexOf(raw, cursor);
        if (at >= 0) cursor = at + raw.length;
    };
    const children = (node: Record<string, unknown>): Token[][] => {
        const lists: Token[][] = [];
        if (Array.isArray(node.tokens)) lists.push(node.tokens as Token[]);
        if (Array.isArray(node.items)) for (const item of node.items as Record<string, unknown>[]) lists.push([item as Token]);
        if (Array.isArray(node.header)) for (const cell of node.header as Record<string, unknown>[]) if (Array.isArray(cell.tokens)) lists.push(cell.tokens as Token[]);
        if (Array.isArray(node.rows)) for (const row of node.rows as Record<string, unknown>[][]) for (const cell of row) if (Array.isArray(cell.tokens)) lists.push(cell.tokens as Token[]);
        return lists;
    };
    const visit = (token: Token): void => {
        const node = token as unknown as Record<string, unknown>;
        const nested = children(node);
        if (token.type === "text" && nested.length === 0) {
            const at = source.indexOf(token.raw, cursor);
            if (at >= 0) {
                ranges.push([at, at + token.raw.length]);
                cursor = at + token.raw.length;
            }
            return;
        }
        // 链接与图片整个不改（链接文字也不改）；其余没有子单元的（代码、HTML、换行……）同样跳过。
        if (token.type === "link" || token.type === "image" || nested.length === 0) {
            skip(token.raw);
            return;
        }
        for (const list of nested) for (const child of list) visit(child);
    };
    for (const token of tokens) visit(token);
    return ranges;
}

/** 改写后的正文。`streaming` 为真时文末的出处先不改。 */
export function linkRefs(text: string, lexer: MarkdownLexer, options: {streaming?: boolean} = {}): string {
    const spans = findRefs(text);
    if (spans.length === 0) return text;
    const ranges = plainTextRanges(text, lexer().lex(text));
    const inside = (start: number, end: number): boolean => ranges.some(([from, to]) => start >= from && end <= to);
    let result = "";
    let at = 0;
    for (const span of spans) {
        if (!inside(span.start, span.end)) continue;
        if (options.streaming === true && span.end === text.length) continue;
        result += `${text.slice(at, span.start)}[${text.slice(span.start, span.end)}](${refTarget(span.text)})`;
        at = span.end;
    }
    return result + text.slice(at);
}
