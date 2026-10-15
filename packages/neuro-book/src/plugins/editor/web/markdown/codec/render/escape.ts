/**
 * 正文文字的转义（docs/specs/workspace/markdown-dialect.md 输出 4）。
 *
 * `minimal` 只转义按局部规则判断会被读成语法的字符；规则判断不准的情况由写回的读回校验发现，再换 `full`：转义全部 ASCII 标点，
 * 每个插进去的反斜杠前放一个哨兵字符，写回据此从后往前逐个试撤（`stripSentinels` 去掉剩下的哨兵）。
 */

import type {InlinePlace} from "../../syntax/types";

/** `full` 模式插入的转义前放的哨兵（私用区字符，正文里不会出现；读回前与写回前都要去掉）。 */
export const SENTINEL = "";

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /[ \t]/u;

/** 不可见、会被读成别的东西或被丢掉的字符写成实体。 */
function entityOf(char: string): string | null {
    switch (char) {
        case " ":
            return "&nbsp;";
        case "\n":
            return "&#10;";
        case "​":
        case "‌":
        case "‍":
        case "⁠":
        case "﻿":
            return `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`;
        default:
            return null;
    }
}

export interface EscapeAround {
    /** 这段文字从一行的开头起（块首或换行之后）。 */
    readonly lineStart: boolean;
    /** 这段文字一直到这一行的结尾（块尾或换行之前）。 */
    readonly lineEnd: boolean;
    /** 前后紧挨的字符（已写出的最后一个、下一个节点的第一个），没有为空串。 */
    readonly before: string;
    readonly after: string;
    readonly place: InlinePlace;
    readonly full: boolean;
    readonly definitions: ReadonlyMap<string, string>;
}

/** 行首会被读成块语法的写法：返回要在第几个字符前加反斜杠（相对去掉前导空白后的位置），不需要为 -1。 */
function lineStartEscape(line: string): number {
    if (/^#{1,6}(?:[ \t]|$)/u.test(line)) return 0;
    if (/^>/u.test(line)) return 0;
    if (/^[-+*](?:[ \t]|$)/u.test(line)) return 0;
    if (/^(?:[-*_][ \t]*){3,}$/u.test(line)) return 0;
    if (/^(?:=+|-+)[ \t]*$/u.test(line)) return 0;
    if (/^(?:`{3,}|~{3,})/u.test(line)) return 0;
    const ordered = /^\d{1,9}([.)])(?:[ \t]|$)/u.exec(line);
    if (ordered !== null) return ordered[0].indexOf(ordered[1] as string);
    return -1;
}

/** 从 `index` 起在 `text` 里还有没有能与它配对的同样的分隔符（只看这一段文字，跨节点的由读回校验兜底）。 */
const hasLater = (text: string, index: number, delimiter: string): boolean => text.indexOf(delimiter, index + delimiter.length) >= 0;
const hasEarlier = (text: string, index: number, delimiter: string): boolean => text.lastIndexOf(delimiter, index - 1) >= 0;

/** `[` 会不会开一个链接：后面有配对的 `]` 且紧跟 `(`、`[`，或括起来的文字是全篇定义过的标签，或是脚注 `[^`。 */
function opensLink(text: string, index: number, after: string, definitions: ReadonlyMap<string, string>): boolean {
    if (text[index + 1] === "^") return true;
    const close = text.indexOf("]", index + 1);
    if (close < 0) return false;
    const next = text[close + 1] ?? after;
    if (next === "(" || next === "[" || next === ":") return true;
    return definitions.has(text.slice(index + 1, close).trim().toLowerCase());
}

/**
 * 转义一段正文文字。返回写出的文字（`full` 模式里带哨兵）。
 */
export function escapeText(text: string, around: EscapeAround): string {
    const out: string[] = [];
    const escape = (char: string): string => (around.full ? `${SENTINEL}\\${char}` : `\\${char}`);
    // 行首的前导空白会被吃掉（四个以上还会变成代码块）：第一个写成实体。标题与表格单元格的内容被 `trim()`，全角空格这类
    // Unicode 空白也会被去掉。
    const trimmed = around.place.heading === true || around.place.table === true;
    // 整行只有 Unicode 空白（全角空格）时，marked 判空行用 `\s`，也会把它当成空行（列表项因此断开）：同样按会被吃掉处理。
    const wholeLine = around.lineStart && around.lineEnd && /^\s+$/u.test(text);
    const blank = trimmed || wholeLine ? /^\s+/u : /^[ \t]+/u;
    let start = 0;
    if (around.lineStart) {
        const lead = blank.exec(text)?.[0] ?? "";
        if (lead !== "" && entityOf(lead[0] as string) === null) {
            const hex = (char: string): string => `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`;
            // 整段都是空白又到行尾：两头都会被吃掉，每个都写成实体。
            out.push(hex(lead[0] as string), lead.length === text.length && around.lineEnd ? [...lead.slice(1)].map(hex).join("") : lead.slice(1));
            start = lead.length;
        }
    }
    const lineEscape = around.lineStart ? lineStartEscape(text.slice(start)) : -1;
    // 行尾的空白也会被吃掉（两个以上的空格还会变成硬换行）：最后一个写成实体。
    const trailingAt = around.lineEnd && (trimmed ? /\s$/u : /[ \t]$/u).test(text) && text.length > start ? text.length - 1 : -1;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index] as string;
        const previous = index === 0 ? around.before : (text[index - 1] as string);
        const next = index === text.length - 1 ? around.after : (text[index + 1] as string);
        const entity = entityOf(char);
        if (entity !== null) {
            out.push(entity);
            continue;
        }
        // 紧跟在 `$` 后面的数字：行内数学的闭合 `$` 后面是数字时不算数学（Pandoc 的规则），写成实体。
        if (index === 0 && around.before === "$" && /[0-9]/u.test(char)) {
            out.push(`&#${char.charCodeAt(0)};`);
            continue;
        }
        if (index === trailingAt) {
            out.push(`&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`);
            continue;
        }
        if (around.full && ASCII_PUNCTUATION.test(char)) {
            out.push(escape(char));
            continue;
        }
        if (index - start === lineEscape) {
            out.push(escape(char));
            continue;
        }
        out.push(needsEscape(text, index, previous, next, around) ? escape(char) : char);
    }
    return out.join("");
}

/** 一串同样的强调符号能不能开闭强调：两侧都是空白的不能；`_` 的一串两侧都是字（含汉字）时也不能（CJK 友好规则对 `_` 不放宽）。 */
function delimiterRunInert(text: string, start: number, end: number, char: string, around: EscapeAround): boolean {
    const before = start === 0 ? around.before : (text[start - 1] as string);
    const after = end === text.length ? around.after : (text[end] as string);
    if ((before === "" || SPACE.test(before)) && (after === "" || SPACE.test(after))) return true;
    return char === "_" && WORD.test(before) && WORD.test(after);
}

/**
 * `*`、`_` 要不要转义：按一串同样的符号判断能不能开闭；能开闭的符号除最后一个外都转义，剩下的一个没法配对
 * （`5*3*2=30` 写成 `5\*3*2=30`）。跨节点的配对由读回校验兜底。
 */
function delimiterNeedsEscape(text: string, index: number, around: EscapeAround): boolean {
    const char = text[index] as string;
    const active: number[] = [];
    for (let at = 0; at < text.length; at += 1) {
        if (text[at] !== char) continue;
        let end = at;
        while (end < text.length && text[end] === char) end += 1;
        if (!delimiterRunInert(text, at, end, char, around)) for (let position = at; position < end; position += 1) active.push(position);
        at = end - 1;
    }
    return active.length >= 2 && active.includes(index) && index !== active.at(-1);
}

function needsEscape(text: string, index: number, previous: string, next: string, around: EscapeAround): boolean {
    const char = text[index] as string;
    switch (char) {
        case "\\":
            return ASCII_PUNCTUATION.test(next) || next === "" || next === "\n";
        case "`":
            return hasLater(text, index, "`") || hasEarlier(text, index, "`");
        case "*":
        case "_":
            return delimiterNeedsEscape(text, index, around);
        case "~":
        case "=":
            return next === char && previous !== char && (hasLater(text, index + 1, char + char) || hasEarlier(text, index, char + char));
        case "[":
            return opensLink(text, index, around.after, around.definitions);
        case "<":
            return /[A-Za-z/!?]/u.test(next);
        case "&":
            return /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/u.test(text.slice(index));
        case "$":
            return /^\$(?=\S)(?:\\.|[^$\\\n])*?\S\$(?!\d)|^\$[^\s$]\$(?!\d)/u.test(text.slice(index)) || /^\$\$/u.test(text.slice(index));
        case "|":
            return around.place.table === true;
        case "#":
            return around.place.heading === true && /^#+[ \t]*$/u.test(text.slice(index)) && (previous === " " || previous === "\t");
        case ":":
            // 裸网址（GFM 自动链接）：转义协议后的冒号。
            return /(?:^|[^A-Za-z])https?$/u.test(text.slice(0, index)) && text.startsWith("//", index + 1);
        case ".":
            return /(?:^|[^\w.-])www$/u.test(text.slice(0, index));
        case "@":
            return /[\w.+-]$/u.test(text.slice(0, index)) && /^@[\w-]+\.[\w.-]*\w/u.test(text.slice(index));
        default:
            return false;
    }
}

/** 去掉 `full` 模式留下的哨兵。 */
export const stripSentinels = (text: string): string => text.split(SENTINEL).join("");
