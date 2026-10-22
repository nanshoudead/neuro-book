/**
 * 搜索结果里命中文字的切分（`HighlightedText.vue` 用它）：按词在文本里找出所有命中，切成交替的普通片段与命中片段。
 * 词的规则同设置窗口的搜索（docs/specs/settings/settings-window.md 输出 21）：不分大小写，词之间互不影响，每个词的所有
 * 命中都算。
 */

export interface HighlightSegment {
    readonly text: string;
    readonly hit: boolean;
}

/** 词里的正则元字符按字面匹配：用户输入什么就找什么。 */
function escapeRegExp(word: string): string {
    return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 把 `text` 按 `words` 切成片段；片段首尾相接就是原文，`hit` 为真的是命中的字。词重叠时较长的优先（“字”与“字号”
 * 同时在，“字号”标成一段）。没有词或没有命中时只有一个普通片段，空文本没有片段。
 */
export function highlightSegments(text: string, words: ReadonlyArray<string>): ReadonlyArray<HighlightSegment> {
    const usable = words.filter((word) => word !== "");
    if (text === "") return [];
    if (usable.length === 0) return [{text, hit: false}];
    const pattern = new RegExp([...usable].sort((left, right) => right.length - left.length).map(escapeRegExp).join("|"), "giu");
    const segments: HighlightSegment[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const start = match.index;
        if (start > cursor) segments.push({text: text.slice(cursor, start), hit: false});
        segments.push({text: match[0], hit: true});
        cursor = start + match[0].length;
    }
    if (cursor < text.length) segments.push({text: text.slice(cursor), hit: false});
    return segments;
}
