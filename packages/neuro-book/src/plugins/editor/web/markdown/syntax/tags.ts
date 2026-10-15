/**
 * 方言标签的扫描（docs/specs/workspace/markdown-dialect.md 输出 11–17）：开标签的形态、同名标签按嵌套计数配对。
 *
 * 配对时跳过不算标签的地方：行内代码与反斜杠转义（行内），代码围栏与缩进代码（块级）。属性值里的 `>` 由开标签的写法
 * （引号里的字符不结束标签）挡住。
 */

import type {Token, Tokens, TokenizerExtension} from "marked";

import {ATTRIBUTES_SOURCE, parseAttributes} from "nbook/shared/markdown-dialect";

/** 一个开标签：名字（小写）、属性与它在文字里的长度。 */
export interface OpenTag {
    readonly name: string;
    readonly attributes: ReadonlyMap<string, string>;
    readonly length: number;
    /** 开标签的原文（写回时保持属性顺序与大小写用）。 */
    readonly raw: string;
}

/** 文字开头的开标签（名字在 `names` 里）；不是为 null。 */
export function openTagAt(src: string, names: ReadonlyArray<string>): OpenTag | null {
    const matched = new RegExp(`^<(${names.join("|")})(?=[\\s>/])(${ATTRIBUTES_SOURCE})>`, "iu").exec(src);
    if (matched === null || (matched[2] as string).trimEnd().endsWith("/")) return null;
    return {name: (matched[1] as string).toLowerCase(), attributes: parseAttributes(matched[2] as string), length: matched[0].length, raw: matched[0]};
}

/** `src` 里第一个开标签的位置（名字在 `names` 里），没有为 -1：给 `marked` 的 `start` 用。 */
export function openTagIndex(src: string, names: ReadonlyArray<string>): number {
    return src.search(new RegExp(`<(?:${names.join("|")})(?=[\\s>/])`, "iu"));
}

/** 任意一个开标签或闭标签（引号里的字符不结束标签）。 */
const ANY_TAG = new RegExp(`</?[A-Za-z][\\w-]*${ATTRIBUTES_SOURCE}>`, "uy");

/**
 * 行内扫描时跳过不算语法的地方：`index` 处是反斜杠时跳过被转义的字符，是一串反引号时跳过到配对的反引号串（行内代码；
 * 没有配对的只是文字），是一个完整的标签时跳过整个标签（属性值里的反引号、`==` 不算）。返回跳过之后的位置；都不是时
 * 返回 `index`。
 */
export function skipInline(src: string, index: number): number {
    const char = src[index];
    if (char === "\\") return Math.min(src.length, index + 2);
    if (char === "`") {
        let end = index;
        while (src[end] === "`") end += 1;
        const ticks = src.slice(index, end);
        const pattern = new RegExp(`(?<!\`)${ticks}(?!\`)`, "gu");
        pattern.lastIndex = end;
        const matched = pattern.exec(src);
        return matched === null ? end : matched.index + ticks.length;
    }
    if (char === "<") {
        ANY_TAG.lastIndex = index;
        const matched = ANY_TAG.exec(src);
        if (matched !== null) return index + matched[0].length;
    }
    return index;
}

/**
 * 行内配对：`from` 是开标签之后的位置，向后找同名的闭标签（同名开标签让层数加一）。跳过转义、行内代码与别的标签
 * （`skipInline`）。返回闭标签的起止；没有配上为 null。
 */
export function closeInline(src: string, name: string, from: number): {readonly start: number; readonly end: number} | null {
    const open = new RegExp(`<${name}(?=[\\s>/])${ATTRIBUTES_SOURCE}>`, "iuy");
    const close = new RegExp(`</${name}\\s*>`, "iuy");
    let depth = 1;
    for (let index = from; index < src.length; ) {
        if (src[index] === "<") {
            close.lastIndex = index;
            const closing = close.exec(src);
            if (closing !== null) {
                depth -= 1;
                if (depth === 0) return {start: index, end: index + closing[0].length};
                index += closing[0].length;
                continue;
            }
            open.lastIndex = index;
            const opening = open.exec(src);
            if (opening !== null) {
                depth += 1;
                index += opening[0].length;
                continue;
            }
        }
        const next = skipInline(src, index);
        index = next === index ? index + 1 : next;
    }
    return null;
}

/** 代码围栏的开栏：反引号围栏后面的信息串里不能再有反引号（CommonMark），否则只是段落。 */
const FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/u;

/**
 * 块级配对：`src` 从开标签那一行开始，开标签那一行已由调用方认出（长度 `openLength`，含行尾空白，不含换行）。向下逐行找
 * 独占一行的同名闭标签（最多缩进 3 个空格），独占一行的同名开标签让层数加一；代码围栏里与缩进代码的行不算。返回整个块的
 * 原文（到闭标签那一行的行尾，不含换行）与中间的内容；没有配上为 null。`markdown` 为假时内容不是 Markdown（`<html>` 块），
 * 不跳过围栏与缩进的行。
 */
export function closeBlock(src: string, name: string, openLength: number, opensNested: (line: string) => boolean, markdown = true): {readonly raw: string; readonly inner: string} | null {
    const closeLine = new RegExp(`^ {0,3}</${name}\\s*>[ \\t]*$`, "iu");
    if (src[openLength] !== "\n") return null;
    let depth = 1;
    let fence: {marker: string; length: number} | null = null;
    let position = openLength + 1;
    const innerStart = position;
    while (position <= src.length) {
        const newline = src.indexOf("\n", position);
        const end = newline < 0 ? src.length : newline;
        const line = src.slice(position, end);
        const fenced = markdown ? FENCE.exec(line) : null;
        if (fence !== null) {
            if (fenced !== null && (fenced[1] as string).startsWith(fence.marker) && (fenced[1] as string).length >= fence.length && line.slice(fenced[0].length).trim() === "") fence = null;
        } else if (fenced !== null) {
            fence = {marker: (fenced[1] as string)[0] as string, length: (fenced[1] as string).length};
        } else if (!markdown || !/^(?: {4}|\t)/u.test(line)) {
            if (closeLine.test(line)) {
                depth -= 1;
                if (depth === 0) return {raw: src.slice(0, end), inner: src.slice(innerStart, Math.max(innerStart, position - 1))};
            } else if (opensNested(line)) {
                depth += 1;
            }
        }
        if (newline < 0) break;
        position = newline + 1;
    }
    return null;
}

/**
 * 给 `marked` 的块级 `start`：只认“换行之后、独占一行的开标签”。`marked` 判断段落能不能被打断时传进来的是 `src.slice(1)`，
 * 在开头匹配会把段内的行内用法当成断点；真正在块首的标签不需要 `start`，`marked` 在每个块的开头都会试分词规则。
 * 每个段落都会调用一次，所以先用正则找换行后的 `<名字`，只对这些行做完整判断。
 */
export function blockStart(src: string, name: string, opensLine: (line: string) => boolean): number {
    const candidate = new RegExp(`\\n<${name}(?=[\\s>])`, "giu");
    for (let matched = candidate.exec(src); matched !== null; matched = candidate.exec(src)) {
        const start = matched.index + 1;
        const end = src.indexOf("\n", start);
        if (opensLine(src.slice(start, end < 0 ? src.length : end))) return start;
    }
    return -1;
}

/** 块级方言标签的词法单元：开标签的原文与属性、中间的块。 */
export interface BlockTagToken {
    readonly type: string;
    readonly raw: string;
    readonly open: OpenTag;
    /** 开闭标签写在同一行（`<align value="center">文本</align>`）：中间是一段的行内内容。 */
    readonly inline: boolean;
    readonly tokens: Token[];
}

/**
 * 块级方言标签的分词规则：开标签独占一行（`accepts` 认可它的属性），向下配对独占一行的闭标签，中间的内容按块分词。
 * `inlineForm` 为真时也认开闭标签在同一行、独占一行的写法（输出 14 的对齐）。
 */
export function blockTagExtension(type: string, name: string, accepts: (attributes: ReadonlyMap<string, string>) => boolean, inlineForm = false): TokenizerExtension {
    const openLine = (line: string): OpenTag | null => {
        const open = openTagAt(line, [name]);
        return open !== null && accepts(open.attributes) && /^[ \t]*$/u.test(line.slice(open.length)) ? open : null;
    };
    return {
        name: type,
        level: "block",
        start: (src: string) => blockStart(src, name, (line) => openLine(line) !== null),
        tokenizer(src: string): BlockTagToken | undefined {
            const lineEnd = src.indexOf("\n");
            const first = src.slice(0, lineEnd < 0 ? src.length : lineEnd);
            const open = openLine(first);
            if (open !== null) {
                const closed = closeBlock(src, name, first.length, (line) => openLine(line) !== null);
                if (closed === null) return undefined;
                return {type, raw: closed.raw, open, inline: false, tokens: this.lexer.blockTokens(closed.inner, [])};
            }
            if (!inlineForm) return undefined;
            const single = openTagAt(first, [name]);
            if (single === null || !accepts(single.attributes)) return undefined;
            const close = new RegExp(`</${name}\\s*>[ \\t]*$`, "iu").exec(first);
            if (close === null || close.index < single.length) return undefined;
            const inner = first.slice(single.length, close.index);
            // 行内分词排进队列，整篇的块分词完了才做：这时引用定义已经收齐（与 `marked` 自己的段落一样）。
            return {type, raw: first, open: single, inline: true, tokens: [{type: "paragraph", raw: inner, text: inner, tokens: this.lexer.inline(inner, [])} as Tokens.Paragraph]};
        },
    };
}
