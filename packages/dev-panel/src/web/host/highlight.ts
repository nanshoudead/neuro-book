/**
 * 搜索结果里的关键词高亮（t15 阶段 4 第 5 批）：把一段文字切成命中与非命中的几段，页面逐段渲染（`<mark>` 包命中），不拼 HTML。
 * 不分大小写，按服务端 `git grep -i -F` 同样的字面匹配；在原文上用正则找，大小写变换改变长度的字符（例如土耳其语的 İ）也切得对。
 */
export type HighlightPart = {text: string; hit: boolean};

function pattern(q: string): RegExp | null {
    const trimmed = q.trim();
    return trimmed === "" ? null : new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
}

export function highlightParts(text: string, q: string): HighlightPart[] {
    const regex = pattern(q);
    if (!regex) return [{text, hit: false}];
    const parts: HighlightPart[] = [];
    let last = 0;
    for (const match of text.matchAll(regex)) {
        if (match.index > last) parts.push({text: text.slice(last, match.index), hit: false});
        parts.push({text: match[0], hit: true});
        last = match.index + match[0].length;
    }
    if (last < text.length) parts.push({text: text.slice(last), hit: false});
    return parts.length === 0 ? [{text, hit: false}] : parts;
}

/** 按字素切：emoji 的代理对、带组合符号的字不会被切开（第 5 批前端审查第 6 条）。 */
const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});

/**
 * 内容命中那一行只显示一行、超出截断：第一个命中前多于 `before` 个字时，前面换成省略号，让命中落在看得见的地方。
 * 前导空白（缩进）先去掉。`before` 按字素数；起点落在字素中间时退到这个字素的开头。
 */
export function snippetAround(text: string, q: string, before = 30): string {
    const line = text.replace(/^\s+/u, "");
    const regex = pattern(q);
    const index = regex ? line.search(regex) : -1;
    if (index <= 0) return line;
    const starts = [...graphemes.segment(line.slice(0, index))].map((segment) => segment.index);
    if (starts.length <= before) return line;
    return `…${line.slice(starts[starts.length - before])}`;
}
