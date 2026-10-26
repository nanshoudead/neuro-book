/**
 * 写作字数（docs/specs/workbench/editor.md 输出 27）：编辑器状态栏的字数与书架的作品统计共用这一个算法。
 *
 * - 汉字、假名、谚文每字计 1；
 * - 连续的拉丁字母与数字计 1 个词，中间可夹 `'`、`’`、`-`（`don't`、`well-known` 各算一个词）；
 * - 标点、空白与 Markdown 标记不计；开头的 YAML frontmatter 不计；
 * - 方言标签与原样内容里的字不计（docs/specs/workspace/markdown-dialect.md 的“副作用与数据”），由下面的轻量扫描去掉。
 *
 * 浏览器与项目进程都用这个算法，不能依赖编辑器的编解码器：扫描只按行与标签判断，原样内容的判据从 `markdown-dialect.ts` 取，
 * 方言标签按声明表（`dialectTable`，docs/specs/workspace/markdown-syntaxes.md 输出 9）。它与编解码器读出的正文是否一致，由
 * `web/word-count.test.ts` 对照 nb-markdown 编解码器的语料核对；已知的偏差写在方言 Spec。
 */

import {decodeHTMLStrict} from "entities";

import type {DialectDeclaration} from "./dialects";
import {
    ATTRIBUTES_SOURCE,
    FOOTNOTE_REF_SOURCE,
    LONE_TAG,
    MATH_INLINE_SOURCE,
    OPENS_HTML_BLOCK,
    READABLE_INLINE_HTML,
    VOID_HTML_TAGS,
} from "@notnotype/nb-markdown";

const BOM = /^﻿/u;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{Script=Latin}\p{Nd}]+(?:['’-][\p{Script=Latin}\p{Nd}]+)*/gu;

/** 按方言声明算出的字数规则。在一个进程的寿命内不变（输出 10），调用方算一次、每次计数都用它。 */
export interface DialectTable {
    /** 只去掉标签本身、中间的正文照常计的标签：声明的方言标签（`tagWords` 为 `skip` 的除外）与能读的 HTML。其余成对的标签连同中间的字是原样片段。 */
    readonly known: ReadonlySet<string>;
    /** 块级方言标签：独占一行时不开启 HTML 块。 */
    readonly blockTags: ReadonlySet<string>;
    /** 规则的指纹：书架统计据此判断口径变没变（docs/specs/runtime/projects.md 输出 16）。 */
    readonly fingerprint: string;
}

export function dialectTable(declarations: ReadonlyArray<{readonly declaration: DialectDeclaration}>): DialectTable {
    const known = new Set<string>(READABLE_INLINE_HTML);
    const blockTags = new Set<string>();
    for (const {declaration} of declarations) {
        const skipped = new Set((declaration.tagWords ?? []).filter((rule) => rule.content === "skip").map((rule) => rule.tag));
        for (const tag of declaration.blockTags ?? []) blockTags.add(tag);
        for (const tag of [...(declaration.blockTags ?? []), ...(declaration.inlineTags ?? [])]) if (!skipped.has(tag)) known.add(tag);
    }
    return {known, blockTags, fingerprint: fingerprintOf(`${[...known].sort().join(",")}|${[...blockTags].sort().join(",")}`)};
}

/** FNV-1a（32 位）：只用来比较两次的规则是不是同一份，不防碰撞攻击。 */
function fingerprintOf(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

export function countWords(text: string, table: DialectTable): number {
    // 文件服务把 BOM 留在正文里（保存时原样写回），作品统计读文件时又去掉它：这里先剥掉再认 frontmatter，两边的字数才一致。
    const body = countable(text.replace(BOM, "").replace(FRONTMATTER, ""), table);
    // 先数中日韩的字，再把它们换成空格数拉丁词：两类紧挨着时（“第3章”）不会被当成一个词。
    let count = 0;
    const latin = body.replace(CJK, () => {
        count += 1;
        return " ";
    });
    for (const _ of latin.matchAll(WORD)) count += 1;
    return count;
}

// ---- 块：按行判断 ----

/** 容器的前缀（引用符号、列表符号与缩进）：判断一行开始什么块时去掉。 */
const CONTAINER = /^(?:[ \t]*>|[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*/u;
const FENCE = /^(`{3,}(?=[^`]*$)|~{3,})/u;
const HEADING = /^#{1,6}(?:[ \t]|$)/u;
/** 可渲染 HTML 的开闭行（与 nb-markdown 的 `language/syntax/html-embed` 相同：只认不带属性的 `<html>`）。 */
const EMBED_OPEN = /^<html>[ \t]*$/iu;
const EMBED_CLOSE = /^<\/html\s*>[ \t]*$/iu;
const EMBED_GLUED = /<html>[ \t]*$/iu;
const MATH_FENCE = /^\$\$[ \t]*$/u;
const MATH_LINE = /^\$\$.*\$\$[ \t]*$/u;
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:/u;
const DEFINITION_LABEL = /^\[(?!\^)(?:\\.|[^[\]\\])+\]:[ \t]*/u;
const DEFINITION_DESTINATION = /^(?:<[^<>\n]*>|\S+)/u;
const CALLOUT = /^((?:[ \t]*>)+[ \t]*)\[![A-Za-z][\w-]*\][+-]?(?=[ \t]|$)/u;
const TASK = /^((?:[ \t]*>)*[ \t]*[-*+][ \t]+)\[[ xX]\](?=[ \t]|$)/u;
const OPEN_TAG_AT_START = /^<([A-Za-z][\w-]*)(?=[\s/>]|$)/u;

/** CommonMark 第 1–5 类 HTML 块：开头的写法 → 结束它的那一行里有什么。其余的块（第 6、7 类）到空行结束。 */
const HTML_BLOCK_ENDS: ReadonlyArray<readonly [RegExp, RegExp]> = [
    [/^<(?:script|pre|style|textarea)(?:\s|>|$)/iu, /<\/(?:script|pre|style|textarea)>/iu],
    [/^<!--/u, /-->/u],
    [/^<\?/u, /\?>/u],
    [/^<![A-Za-z]/u, />/u],
    [/^<!\[CDATA\[/u, /\]\]>/u],
];

/**
 * 去掉不计字数的内容，剩下的交给计数。顺序与编辑器读入一致：先认代码、原样块与可渲染 HTML 这类整块的结构（按行），段落里的
 * 文字再按行内规则去掉标签、原样片段与注音小字。代码里的字照常计，其中的标签不当标签。
 */
function countable(body: string, table: DialectTable): string {
    const lines = body.split(/\r\n|\r|\n/u);
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        offsets.push(offset);
        offset += line.length + 1;
    }
    const joined = scanned(lines.join("\n"));
    // 往下找某种行：每种只建一次行号表，二分找下一个（没闭合的 `<html>`、`$$` 一行接一行时不至于每行都扫到文末）。
    const tables = new Map<RegExp, number[]>();
    const nextLine = (pattern: RegExp, from: number): number => {
        let table = tables.get(pattern);
        if (table === undefined) {
            table = [];
            lines.forEach((line, at) => {
                if (pattern.test(line.replace(CONTAINER, "").trimStart())) (table as number[]).push(at);
            });
            tables.set(pattern, table);
        }
        let low = 0;
        let high = table.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((table[middle] as number) < from) low = middle + 1;
            else high = middle;
        }
        return table[low] ?? -1;
    };
    const out: string[] = [];
    let paragraph: string[] = [];
    const flush = (): void => {
        if (paragraph.length > 0) out.push(inline(paragraph.join("\n"), table));
        paragraph = [];
    };
    // 这一行能不能开始只在块开头成立的结构（引用定义、第 7 类 HTML 块）：前面是空行、文件开头或另一个整块的结构。
    let blockStart = true;
    let index = 0;
    while (index < lines.length) {
        const line = lines[index] as string;
        const content = line.replace(CONTAINER, "");
        const skipTo = (last: number): void => {
            flush();
            index = last + 1;
            blockStart = true;
        };
        if (content.trim() === "") {
            flush();
            blockStart = true;
            index += 1;
            continue;
        }
        const fence = FENCE.exec(content);
        if (fence !== null) {
            // 围栏里的文字照常计；开闭行上的语言名是标记。没闭合的围栏到文末。
            const mark = fence[1] as string;
            const closing = new RegExp(`^${mark[0] === "`" ? "`" : "~"}{${mark.length},}[ \\t]*$`, "u");
            let last = index + 1;
            while (last < lines.length && !closing.test((lines[last] as string).replace(CONTAINER, ""))) last += 1;
            flush();
            out.push(lines.slice(index + 1, last).join("\n"));
            index = last + 1;
            blockStart = true;
            continue;
        }
        const embedAt = EMBED_OPEN.test(content) ? 0 : content.search(EMBED_GLUED);
        if (embedAt >= 0) {
            const last = nextLine(EMBED_CLOSE, index + 1);
            if (last >= 0) {
                // 宽容写法 `正文<html>`：前面的正文照常计。
                if (embedAt > 0) paragraph.push(line.slice(0, line.length - content.length + embedAt));
                skipTo(last);
                continue;
            }
        }
        if (MATH_LINE.test(content) && content.trim().length > 4) {
            skipTo(index);
            continue;
        }
        if (MATH_FENCE.test(content)) {
            const last = nextLine(MATH_FENCE, index + 1);
            if (last >= 0) {
                skipTo(last);
                continue;
            }
        }
        if (FOOTNOTE_DEF.test(content)) {
            // 续行是缩进的行，中间可以隔空行。
            let last = index;
            for (let next = index + 1; next < lines.length; next += 1) {
                const text = lines[next] as string;
                if (/^[ \t]+\S/u.test(text)) last = next;
                else if (text.trim() !== "") break;
            }
            skipTo(last);
            continue;
        }
        const definition = blockStart ? definitionEnd(lines, index) : -1;
        if (definition >= 0) {
            skipTo(definition);
            continue;
        }
        const html = htmlBlockEnd(joined, lines, offsets, index, content, blockStart, table);
        if (html >= 0) {
            skipTo(html);
            continue;
        }
        if (HEADING.test(content)) {
            flush();
            paragraph.push(line);
            flush();
            index += 1;
            blockStart = true;
            continue;
        }
        // 提示块的类型只在引用的第一行；后面的标题是原文，按字面计（不当 Markdown 解释，方言 Spec 输出 23）。
        const quoteStart = index === 0 || !/^[ \t]*>/u.test(lines[index - 1] as string);
        const callout = quoteStart ? CALLOUT.exec(line) : null;
        if (callout !== null) {
            flush();
            out.push(line.slice(callout[0].length));
            index += 1;
            blockStart = true;
            continue;
        }
        paragraph.push(line.replace(TASK, "$1"));
        blockStart = false;
        index += 1;
    }
    flush();
    return out.join("\n");
}

/**
 * 从第 `index` 行开始的引用定义的最后一行；不是定义返回 -1。按 CommonMark：`[标签]:` 后面是地址（可以在下一行），再后面可以有
 * 标题（同一行或下一行开始，可以跨行，不能隔空行）；同一行的地址后面跟着不是标题的字时不是定义，下一行的标题没闭合时定义到
 * 地址为止。
 */
function definitionEnd(lines: ReadonlyArray<string>, index: number): number {
    const content = (at: number): string | undefined => lines[at]?.replace(CONTAINER, "");
    const first = content(index) as string;
    const label = DEFINITION_LABEL.exec(first);
    if (label === null) return -1;
    let line = index;
    let rest = first.slice(label[0].length).trim();
    if (rest === "") {
        line += 1;
        rest = content(line)?.trim() ?? "";
        if (rest === "") return -1;
    }
    const destination = DEFINITION_DESTINATION.exec(rest);
    if (destination === null) return -1;
    const after = rest.slice(destination[0].length);
    if (after.trim() !== "") return /^[ \t]+["'(]/u.test(after) ? titleEnd(lines, line, after.trimStart()) : -1;
    const next = content(line + 1)?.trimStart() ?? "";
    if (!/^["'(]/u.test(next)) return line;
    const end = titleEnd(lines, line + 1, next);
    return end < 0 ? line : end;
}

/** 从第 `line` 行的 `text`（以引号或括号开头）开始的标题在哪一行闭合、闭合后这一行没有别的字；不成立返回 -1。 */
function titleEnd(lines: ReadonlyArray<string>, line: number, text: string): number {
    const close = text[0] === "(" ? ")" : (text[0] as string);
    let rest = text.slice(1);
    for (let at = line; ; ) {
        for (let index = 0; index < rest.length; index += 1) {
            if (rest[index] === "\\") index += 1;
            else if (rest[index] === close) return rest.slice(index + 1).trim() === "" ? at : -1;
        }
        at += 1;
        const next = lines[at]?.replace(CONTAINER, "");
        if (next === undefined || next.trim() === "") return -1;
        rest = next;
    }
}

/** 从 `from` 起第一行满足 `test` 的行号；没有返回 -1。 */
function findLine(lines: ReadonlyArray<string>, from: number, test: (line: string) => boolean): number {
    for (let index = from; index < lines.length; index += 1) if (test(lines[index] as string)) return index;
    return -1;
}

/**
 * 从第 `index` 行开始的 HTML 块（原样块）的最后一行；不是 HTML 块返回 -1。认法与 nb-markdown 的 `language/syntax/raw` 一致：行首是方言之外的
 * 标签、到配对的闭标签为止的完整片段（可以跨空行）后面紧跟行尾时整体是原样块；否则按 CommonMark 的 HTML 块。
 */
function htmlBlockEnd(joined: Scanned, lines: ReadonlyArray<string>, offsets: ReadonlyArray<number>, index: number, content: string, blockStart: boolean, table: DialectTable): number {
    const name = OPEN_TAG_AT_START.exec(content)?.[1]?.toLowerCase();
    if (name !== undefined && !table.known.has(name)) {
        const start = (offsets[index] as number) + (lines[index] as string).length - content.length;
        const end = completeElementEnd(joined, start, name);
        if (end >= 0) {
            const lineEnd = joined.text.indexOf("\n", end);
            if (/^[ \t]*$/u.test(joined.text.slice(end, lineEnd < 0 ? joined.text.length : lineEnd))) return lineOf(offsets, end - 1);
        }
    }
    for (const [opens, ends] of HTML_BLOCK_ENDS) {
        if (!opens.test(content)) continue;
        const last = findLine(lines, index, (line) => ends.test(line));
        return last < 0 ? lines.length - 1 : last;
    }
    const lone = name === undefined || !table.blockTags.has(name);
    if (OPENS_HTML_BLOCK.test(content) || (blockStart && lone && LONE_TAG.test(content.trimEnd()))) {
        const blank = findLine(lines, index + 1, (line) => line.trim() === "");
        return blank < 0 ? lines.length - 1 : blank - 1;
    }
    return -1;
}

/** 位置 `at` 所在的行号。 */
function lineOf(offsets: ReadonlyArray<number>, at: number): number {
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((offsets[middle] as number) <= at) low = middle;
        else high = middle - 1;
    }
    return low;
}

/**
 * 一段要找标签的文字，带上只算一次的辅助：小写形式、最后一个 `>` 的位置、各标签名最后一个闭标签的位置。属性串可以跨行、
 * 一直延伸到下一个 `>`，后面没有 `>` 的 `<` 不必试；后面没有同名闭标签的开标签不必配对。否则成千上万个 `a<b`、没闭合的
 * `<kbd>` 每个都要扫到末尾。
 */
interface Scanned {
    readonly text: string;
    readonly lower: string;
    readonly lastClose: number;
    /** 各标签名的开标签位置 → 配对的闭标签的结束位置（一次栈配对）。 */
    readonly pairs: Map<string, Map<number, number>>;
}

const scanned = (text: string): Scanned => {
    const lower = text.toLowerCase();
    return {text, lower, lastClose: text.lastIndexOf(">"), pairs: new Map()};
};

/**
 * `start` 处名为 `name` 的开标签配上的闭标签的结束位置；没配上返回 -1。整段一次栈配对（闭标签配最近一个还没配上的开标签，
 * 与从开标签起按嵌套计数找闭标签结果相同），按标签名缓存：成千上万个没配上的开标签不至于每个都扫到末尾。
 */
function pairedEnd(source: Scanned, start: number, name: string): number {
    let pairs = source.pairs.get(name);
    if (pairs === undefined) {
        pairs = new Map();
        const open: number[] = [];
        if (source.lower.includes(`</${name}`)) {
            const pattern = new RegExp(`<(/?)${name}(?=[\\s/>])((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "giu");
            for (const matched of source.text.matchAll(pattern)) {
                if ((matched[2] ?? "").endsWith("/")) continue;
                if (matched[1] !== "/") open.push(matched.index);
                else if (open.length > 0) pairs.set(open.pop() as number, matched.index + matched[0].length);
            }
        }
        source.pairs.set(name, pairs);
    }
    return pairs.get(start) ?? -1;
}

const TAG = new RegExp(`<(/?)([A-Za-z][\\w-]*)(?=[\\s/>])(${ATTRIBUTES_SOURCE})>`, "uy");

/** 从 `start` 处的开标签起，完整片段（自闭合、空元素，或同名标签按嵌套计数配上的闭标签）的结束位置；不完整返回 -1。 */
function completeElementEnd(source: Scanned, start: number, name: string): number {
    const {text} = source;
    if (start > source.lastClose) return -1;
    TAG.lastIndex = start;
    const open = TAG.exec(text);
    if (open === null || open[1] === "/") return -1;
    const end = start + open[0].length;
    if (VOID_HTML_TAGS.has(name) || (open[3] as string).endsWith("/")) return end;
    return pairedEnd(source, start, name);
}

// ---- 行内：一段的文字 ----

const SPECIAL = /[`\\<$[&]/gu;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/u;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/uy;
const COMMENT_END = "-->";
const MATH_INLINE = new RegExp(MATH_INLINE_SOURCE, "uy");
const FOOTNOTE_REF = new RegExp(FOOTNOTE_REF_SOURCE, "uy");
const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/uy;

/** 一段里不计的内容去掉后的文字：行内代码原样留下，标签、HTML 注释、行内数学与脚注引用去掉，实体解码，转义取字符本身。 */
function inline(text: string, table: DialectTable): string {
    const source = scanned(text);
    const runs = backtickRuns(text);
    // 每种长度下一个还没走过的反引号串（扫描只往后走）。
    const cursors = new Map<number, number>();
    const parts: string[] = [];
    let copied = 0;
    const replace = (from: number, to: number, value: string): number => {
        parts.push(text.slice(copied, from), value);
        copied = to;
        return to;
    };
    let at = 0;
    while (at < text.length) {
        SPECIAL.lastIndex = at;
        const special = SPECIAL.exec(text);
        if (special === null) break;
        const position = special.index;
        at = position + 1;
        switch (special[0]) {
            case "`": {
                // 行内代码：同样长的一串反引号闭合，中间原样计入；配不上时这串反引号是文字。
                let length = 1;
                while (text[position + length] === "`") length += 1;
                const starts = runs.get(length) ?? [];
                let cursor = cursors.get(length) ?? 0;
                while (cursor < starts.length && (starts[cursor] as number) <= position) cursor += 1;
                cursors.set(length, cursor);
                const close = starts[cursor];
                at = close === undefined ? position + length : close + length;
                break;
            }
            case "\\":
                if (ASCII_PUNCTUATION.test(text[position + 1] ?? "")) at = replace(position, position + 2, text[position + 1] as string);
                break;
            case "<":
                at = tagAt(source, position, replace, table) ?? at;
                break;
            case "$":
                MATH_INLINE.lastIndex = position;
                if (MATH_INLINE.test(text)) at = replace(position, MATH_INLINE.lastIndex, "");
                break;
            case "[":
                FOOTNOTE_REF.lastIndex = position;
                if (FOOTNOTE_REF.test(text)) at = replace(position, FOOTNOTE_REF.lastIndex, "");
                break;
            case "&": {
                ENTITY.lastIndex = position;
                const entity = ENTITY.exec(text)?.[0];
                if (entity !== undefined) at = replace(position, position + entity.length, decodeHTMLStrict(entity));
                break;
            }
        }
    }
    parts.push(text.slice(copied));
    return parts.join("");
}

/** 一段里每种长度的反引号串的起点（升序）。 */
function backtickRuns(text: string): Map<number, number[]> {
    const runs = new Map<number, number[]>();
    for (const matched of text.matchAll(/`+/gu)) {
        const starts = runs.get(matched[0].length) ?? [];
        starts.push(matched.index);
        runs.set(matched[0].length, starts);
    }
    return runs;
}

/**
 * `<` 开头的写法：自动链接留下地址，HTML 注释与标签去掉；方言之外的完整片段连同中间的字去掉（标准写法注音里的 `<rt>` 小字
 * 也由这一条去掉）。返回处理到的位置。
 */
function tagAt(source: Scanned, position: number, replace: (from: number, to: number, value: string) => number, table: DialectTable): number | null {
    const {text, lastClose} = source;
    if (position > lastClose) return null;
    if (text.startsWith("<!--", position)) {
        const end = text.indexOf(COMMENT_END, position + 4);
        return end < 0 ? null : replace(position, end + COMMENT_END.length, "");
    }
    AUTOLINK.lastIndex = position;
    const link = AUTOLINK.exec(text);
    if (link !== null) return replace(position, position + link[0].length, link[1] as string);
    TAG.lastIndex = position;
    const tag = TAG.exec(text);
    if (tag === null) return null;
    const name = (tag[2] as string).toLowerCase();
    const end = position + tag[0].length;
    // `<br>` 是换行：两边的词不连成一个。
    if (name === "br") return replace(position, end, " ");
    if (tag[1] === "/" || table.known.has(name)) return replace(position, end, "");
    const element = completeElementEnd(source, position, name);
    return replace(position, element < 0 ? end : element, "");
}
