/**
 * Markdown 行内链接与图片的写法（CommonMark 的行内链接：`[文字](地址 "标题")`、`![说明](地址)`）：编解码器写地址、Composer 认
 * 引用与图片都用这里，两边对“什么算一个链接”的判断一致（docs/specs/ui/prompt-editor.md 的文字写法）。
 *
 * 只认行内写法；引用式链接（`[文字][标签]`）要整篇的定义才能解析，Composer 的一段话里不认。不跨行。
 */

/** 文字里的一个行内链接或图片：`[start, end)` 是它的原文。 */
export interface InlineLink {
    readonly start: number;
    readonly end: number;
    readonly image: boolean;
    /** 方括号里的原文，去掉首尾空白，反斜杠转义保留。 */
    readonly label: string;
    /** 地址，去掉尖括号与反斜杠转义。 */
    readonly destination: string;
}

const ESCAPABLE = /\\([!-/:-@[-`{-~])/gu;

/** 去掉反斜杠转义（CommonMark：反斜杠后面是 ASCII 标点时转义它）。 */
export const unescapeMarkdown = (text: string): string => text.replace(ESCAPABLE, "$1");

/** 链接与图片地址：含空白、尖括号或括号不配对时写成 `<地址>`。 */
export function writeDestination(href: string): string {
    let depth = 0;
    let balanced = true;
    for (const char of href) {
        if (char === "(") depth += 1;
        else if (char === ")" && --depth < 0) balanced = false;
    }
    if (/[\s<>]/u.test(href) || !balanced || depth !== 0 || href === "") return `<${href.replace(/[<>\\]/gu, (char) => `\\${char}`)}>`;
    return href.replace(/\\(?=[!-/:-@[-`{-~])/gu, "\\\\");
}

/** 方括号里的文字：方括号与反斜杠加转义，换行换成空格（行内链接不跨行）。 */
export const writeLabel = (text: string): string => text.replace(/[[\]\\]/gu, (char) => `\\${char}`).replace(/\s*\n\s*/gu, " ");

/** `[文字](地址)` 或 `![文字](地址)`。 */
export const writeInlineLink = (label: string, href: string, image = false): string => `${image ? "!" : ""}[${writeLabel(label)}](${writeDestination(href)})`;

/** 从 `open`（`[` 的位置）读方括号：返回 `]` 的位置，没闭合或跨行返回 -1。方括号可以嵌套。 */
function closeBracket(text: string, open: number): number {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\\") index += 1;
        else if (char === "\n") return -1;
        else if (char === "[") depth += 1;
        else if (char === "]" && --depth === 0) return index;
    }
    return -1;
}

const skipSpaces = (text: string, index: number): number => {
    while (text[index] === " " || text[index] === "\t") index += 1;
    return index;
};

/** 从 `index` 读地址：返回地址的原文与之后的位置；不成立返回 null。 */
function readDestination(text: string, index: number): {raw: string; next: number} | null {
    if (text[index] === "<") {
        for (let at = index + 1; at < text.length; at += 1) {
            const char = text[at];
            if (char === "\\") at += 1;
            else if (char === "\n" || char === "<") return null;
            else if (char === ">") return {raw: text.slice(index + 1, at), next: at + 1};
        }
        return null;
    }
    let depth = 0;
    let at = index;
    for (; at < text.length; at += 1) {
        const char = text[at] as string;
        if (char === "\\") at += 1;
        else if (/[\s\u0000-\u001f]/u.test(char)) break;
        else if (char === "(") depth += 1;
        else if (char === ")") {
            if (depth === 0) break;
            depth -= 1;
        }
    }
    return depth === 0 ? {raw: text.slice(index, at), next: at} : null;
}

/** 从 `index`（引号或左括号）读标题，返回之后的位置；不成立返回 -1。 */
function readTitle(text: string, index: number): number {
    const open = text[index];
    const close = open === "(" ? ")" : open;
    if (open !== "\"" && open !== "'" && open !== "(") return -1;
    for (let at = index + 1; at < text.length; at += 1) {
        const char = text[at];
        if (char === "\\") at += 1;
        else if (char === "\n" || (open === "(" && char === "(")) return -1;
        else if (char === close) return at + 1;
    }
    return -1;
}

/** 从 `start`（`[` 或 `![` 的位置）读一个行内链接；不成立返回 null。 */
export function readInlineLink(text: string, start: number): InlineLink | null {
    const image = text[start] === "!";
    const open = image ? start + 1 : start;
    if (text[open] !== "[") return null;
    const close = closeBracket(text, open);
    if (close < 0 || text[close + 1] !== "(") return null;
    const destination = readDestination(text, skipSpaces(text, close + 2));
    if (destination === null) return null;
    let at = skipSpaces(text, destination.next);
    if (at > destination.next && text[at] !== ")") {
        at = readTitle(text, at);
        if (at < 0) return null;
        at = skipSpaces(text, at);
    }
    if (text[at] !== ")") return null;
    return {start, end: at + 1, image, label: text.slice(open + 1, close).trim(), destination: unescapeMarkdown(destination.raw)};
}

/**
 * 文字里所有不重叠的行内链接与图片，从左往右。链接文字里的图片（`[![图](a.png)](b.md)`）算外层的一个链接；被转义的 `\[`
 * 不开始链接。
 */
export function findInlineLinks(text: string): InlineLink[] {
    const links: InlineLink[] = [];
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\\") {
            index += 1;
            continue;
        }
        if (char !== "[" && !(char === "!" && text[index + 1] === "[")) continue;
        const link = readInlineLink(text, index);
        if (link === null) continue;
        links.push(link);
        index = link.end - 1;
    }
    return links;
}
