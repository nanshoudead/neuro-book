/**
 * Markdown 原文的三步预处理（docs/specs/workspace/markdown-dialect.md 输出 1、2、9、17）：拆出 frontmatter、规范化正文、
 * 把正文切成块与间隔。后面的读入与写回都建在这里给出的一条不变量上：全部块与间隔的原文切片依次拼接，逐字节等于正文原文。
 *
 * 规范化只为解析：解析器看到的是 LF 换行、宽容写法补了空行的文字；块与间隔的原文切片都经偏移表从原文里取，所以 CR、
 * 原来没有的空行都不会写回去。
 */

/** 原文拆成前缀（BOM 与 frontmatter，原样）与正文。 */
export interface SourceSplit {
    readonly prefix: string;
    readonly body: string;
}

const FENCE = /^---[ \t]*(\r\n|\n)/u;
const CLOSE = /^---[ \t]*(\r\n|\n|$)/u;

/** 按原始字符串的偏移切出开头的 `---` 块（BOM 留在前缀里）；不归一化换行、不补换行。没有闭合的分隔线时不是 frontmatter。 */
export function splitFrontmatter(source: string): SourceSplit {
    const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
    const rest = source.slice(bom.length);
    const open = FENCE.exec(rest);
    if (open === null) return {prefix: bom, body: rest};
    let offset = open[0].length;
    while (offset <= rest.length) {
        const close = CLOSE.exec(rest.slice(offset));
        if (close !== null) {
            const end = offset + close[0].length;
            return {prefix: bom + rest.slice(0, end), body: rest.slice(end)};
        }
        const next = rest.indexOf("\n", offset);
        if (next < 0) break;
        offset = next + 1;
    }
    return {prefix: bom, body: rest};
}

/** 规范化后的文字与偏移表：`toSource[i]` 是规范化文字第 i 个位置在原文里的位置（长度为文字长度加一）。 */
export interface Normalized {
    readonly text: string;
    readonly toSource: Int32Array;
}

/** 一行原文：内容的范围与它自己的换行符（最后一行可以没有）。 */
interface SourceLine {
    readonly start: number;
    readonly end: number;
    readonly eol: "" | "\n" | "\r\n" | "\r";
}

function linesOf(body: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    for (let index = 0; index < body.length; index += 1) {
        const char = body.charCodeAt(index);
        if (char === 10) {
            lines.push({start, end: index, eol: "\n"});
            start = index + 1;
        } else if (char === 13) {
            const crlf = body.charCodeAt(index + 1) === 10;
            lines.push({start, end: index, eol: crlf ? "\r\n" : "\r"});
            if (crlf) index += 1;
            start = index + 1;
        }
    }
    lines.push({start, end: body.length, eol: ""});
    return lines;
}

/** 代码围栏的开栏：最多 3 空格缩进加 ``` 或 ~~~；反引号围栏后面的信息串里不能再有反引号（CommonMark），否则只是段落。 */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/u;
/** 开标签前只有空白与容器标记（引用 `>`、列表 `-*+`、有序 `1.`/`1)`）：这是正常的嵌套，不拆。 */
const CONTAINER_ONLY_PREFIX = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*$/u;

/** 可渲染 HTML 块（方言 Spec 输出 16）的开闭行：里面是 HTML，不是 Markdown，其中的 ``` 不开代码围栏。 */
const HTML_OPEN = /^<html>[ \t]*$/iu;
const HTML_CLOSE = /^ {0,3}<\/html\s*>[ \t]*$/iu;

/** 每一行在不在代码围栏或 `<html>` 块里（开、内、闭都算）；一次扫描。 */
function fencedLines(body: string, lines: ReadonlyArray<SourceLine>): boolean[] {
    const fenced: boolean[] = [];
    let fence: {marker: string; length: number} | null = null;
    let html = false;
    for (const line of lines) {
        const text = body.slice(line.start, line.end);
        const matched = FENCE_OPEN.exec(text);
        if (html || (fence === null && HTML_OPEN.test(text))) {
            html = !(html && HTML_CLOSE.test(text));
            fenced.push(true);
        } else if (fence !== null) {
            if (matched !== null && (matched[1] as string).startsWith(fence.marker) && (matched[1] as string).length >= fence.length && text.slice(matched[0].length).trim() === "") fence = null;
            fenced.push(true);
        } else if (matched !== null) {
            fence = {marker: (matched[1] as string)[0] as string, length: (matched[1] as string).length};
            fenced.push(true);
        } else {
            fenced.push(false);
        }
    }
    return fenced;
}

/**
 * 宽容写法（输出 17）的拆分点：每行至多一处，值是开标签在行内的列。
 *
 * 判据（每条都对应过一次真实的回归，改动前读 `markdown-dialect.test.ts` 里的宽容写法样例）：开标签在行尾；往下有独占一行的
 * 同名闭标签（只看围栏外的行）；开标签前有真实正文，不只是容器标记；不在围栏里、不是缩进代码；原文不以换行结尾时最后一行
 * 不算“行尾”（流式写入的半截不被抢拆）。“往下有闭标签”用每个标签最后一次出现的闭标签行号判断，整篇一次扫描。
 */
function gluedSplits(body: string, lines: ReadonlyArray<SourceLine>, blockTags: ReadonlyArray<string>, openAtLineEnd: RegExp): Map<number, number> {
    const splits = new Map<number, number>();
    if (blockTags.length === 0) return splits;
    const fenced = fencedLines(body, lines);
    const closePattern = new RegExp(`^[ \\t]*</(${blockTags.join("|")})>[ \\t]*$`, "u");
    const lastClose = new Map<string, number>();
    lines.forEach((line, index) => {
        if (fenced[index] === true) return;
        const matched = closePattern.exec(body.slice(line.start, line.end));
        if (matched !== null) lastClose.set(matched[1] as string, index);
    });
    if (lastClose.size === 0) return splits;
    const lastLine = lines.length - 1;
    lines.forEach((line, index) => {
        if (fenced[index] === true || (index === lastLine && line.eol === "")) return;
        const text = body.slice(line.start, line.end);
        if (/^(?: {4}|\t)/u.test(text)) return;
        const matched = openAtLineEnd.exec(text);
        if (matched === null || matched.index === 0) return;
        if (CONTAINER_ONLY_PREFIX.test(text.slice(0, matched.index))) return;
        const tag = /^<([a-zA-Z-]+)/u.exec(matched[0])?.[1];
        if (tag === undefined || (lastClose.get(tag) ?? -1) <= index) return;
        splits.set(index, matched.index);
    });
    return splits;
}

/** 宽容写法会在哪里拆开：开标签在正文里的位置，从小到大。写回用它检查整篇输出（拆分点只能在块的开头）。 */
export function gluedOpenings(body: string, blockTags: ReadonlyArray<string>, openAtLineEnd: RegExp): number[] {
    const lines = linesOf(body);
    return [...gluedSplits(body, lines, blockTags, openAtLineEnd)].map(([line, column]) => (lines[line] as SourceLine).start + column).sort((left, right) => left - right);
}

/**
 * 规范化正文：换行一律成 `\n`（`\r\n` 与单独的 `\r`，与 `marked` 的做法一致），宽容写法在开标签前补一个空行。
 * `openAtLineEnd` 匹配“行尾的块级方言开标签”，各标签的属性形态由语法模块给出，必须与各自的块分词规则一致。
 */
export function normalize(body: string, blockTags: ReadonlyArray<string>, openAtLineEnd: RegExp): Normalized {
    const lines = linesOf(body);
    const splits = gluedSplits(body, lines, blockTags, openAtLineEnd);
    const parts: string[] = [];
    const map: number[] = [];
    const copy = (from: number, to: number): void => {
        parts.push(body.slice(from, to));
        for (let index = from; index < to; index += 1) map.push(index);
    };
    lines.forEach((line, index) => {
        const split = splits.get(index);
        if (split === undefined) {
            copy(line.start, line.end);
        } else {
            copy(line.start, line.start + split);
            // 补的空行不对应任何原文字符：它们映射到开标签在原文里的位置，所以切出来的间隔是空串。
            parts.push("\n\n");
            map.push(line.start + split, line.start + split);
            copy(line.start + split, line.end);
        }
        if (line.eol !== "") {
            parts.push("\n");
            map.push(line.end);
        }
    });
    map.push(body.length);
    return {text: parts.join(""), toSource: Int32Array.from(map)};
}

/** 分块用的词法单元：`marked` 顶层单元里分块用得到的部分。 */
export interface LexedUnit {
    readonly type: string;
    readonly raw: string;
}

/** 一块：规范化文字里的范围（不含结尾换行）与原文切片。`unit` 为 null 表示读入时对不上任何词法单元的原文。 */
export interface SourceBlock<U extends LexedUnit = LexedUnit> {
    readonly unit: U | null;
    readonly from: number;
    readonly to: number;
    readonly raw: string;
}

/** 分块结果：`gaps[i]` 是第 i 块之前的间隔原文，`gaps[blocks.length]` 是最后一块之后的（含文件末尾的换行）。 */
export interface Segmented<U extends LexedUnit = LexedUnit> {
    readonly blocks: ReadonlyArray<SourceBlock<U>>;
    readonly gaps: ReadonlyArray<string>;
    /** 读入时对不上的原文段数（诊断用）。 */
    readonly skipped: number;
}

/**
 * 把规范化文字按顶层词法单元切成块与间隔。不信任 `raw` 依次拼接等于输入：`marked` 遇到同名的第二条引用定义会把它整个丢掉，
 * 所以逐个核对单元的 `raw` 是否恰好出现在当前偏移，对不上时把跳过的那段原文作为一块（`unit: null`，读成原样块）。
 */
export function segment<U extends LexedUnit>(normalized: Normalized, source: string, units: ReadonlyArray<U>): Segmented<U> {
    const {text, toSource} = normalized;
    const slice = (from: number, to: number): string => source.slice(toSource[from] as number, toSource[to] as number);
    const ranges: Array<{unit: U | null; from: number; to: number}> = [];
    let skipped = 0;
    let offset = 0;
    /**
     * 一段非空白文字作为块：去掉两端的换行，换行归间隔。对不上单元的原文按空行切成几块：同一段原文在不同的上下文里
     * （例如写回校验预置了引用定义表，两条定义都被当成重复的丢掉）切出来的块要一样。
     */
    const pushBlock = (unit: U | null, from: number, to: number): void => {
        if (unit === null) {
            const pattern = /\n[ \t]*\n/gu;
            pattern.lastIndex = from;
            let start = from;
            for (let matched = pattern.exec(text); matched !== null && matched.index < to; matched = pattern.exec(text)) {
                pushTrimmed(null, start, matched.index);
                start = matched.index + matched[0].length;
            }
            pushTrimmed(null, start, to);
            return;
        }
        pushTrimmed(unit, from, to);
    };
    const pushTrimmed = (unit: U | null, from: number, to: number): void => {
        let start = from;
        let end = to;
        while (start < end && text.charCodeAt(start) === 10) start += 1;
        while (end > start && text.charCodeAt(end - 1) === 10) end -= 1;
        if (start >= end || (unit === null && text.slice(start, end).trim() === "")) return;
        ranges.push({unit, from: start, to: end});
    };
    for (const unit of units) {
        if (unit.raw === "") continue;
        const at = text.startsWith(unit.raw, offset) ? offset : text.indexOf(unit.raw, offset);
        if (at < 0) continue;
        if (at > offset) {
            if (text.slice(offset, at).trim() !== "") skipped += 1;
            pushBlock(null, offset, at);
        }
        if (unit.type !== "space") pushBlock(unit, at, at + unit.raw.length);
        offset = at + unit.raw.length;
    }
    if (offset < text.length) {
        if (text.slice(offset).trim() !== "") skipped += 1;
        pushBlock(null, offset, text.length);
    }
    const blocks: SourceBlock<U>[] = [];
    const gaps: string[] = [];
    let previous = 0;
    for (const range of ranges) {
        gaps.push(slice(previous, range.from));
        blocks.push({unit: range.unit, from: range.from, to: range.to, raw: slice(range.from, range.to)});
        previous = range.to;
    }
    gaps.push(slice(previous, text.length));
    return {blocks, gaps, skipped};
}
