/**
 * NeuroBook Markdown 方言的标签名单与属性写法（docs/specs/workspace/markdown-dialect.md 输出 11–17、23–25）。编辑器的编解码器
 * （`plugins/editor/web/markdown/syntax/`）与字数的轻量扫描都从这里取，名单只写一处：新增方言标签时在这里登记。
 *
 * 只放两边都要的东西：标签名、属性的读与写。标签的配对、读成什么节点由编辑器的语法模块决定。
 */

import {decodeHTMLAttribute} from "entities";

/** 开闭标签各自独占一行的块级方言标签。 */
export const BLOCK_DIALECT_TAGS = ["comment", "bilingual", "align", "html"] as const;

/** 行内的方言标签（含能读的 HTML 文字标记与旧写法 `inline-comment`）。 */
export const INLINE_DIALECT_TAGS = ["comment", "inline-comment", "ruby", "span", "mark", "sup", "sub"] as const;

/** 开标签里的属性串：`name="值"`、`name='值'`，或不带值的 `name`。 */
const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

/** 开标签的属性部分（标签名之后、`>` 之前）：引号里的 `>` 不算结束。 */
export const ATTRIBUTES_SOURCE = `(?:"[^"]*"|'[^']*'|[^>"'])*`;

/**
 * 读属性：名字小写，值按 HTML 属性的规则解码实体（`&quot;`、`&#10;` 等）。同名的取第一个（与浏览器一致）。
 */
export function parseAttributes(source: string): ReadonlyMap<string, string> {
    const attributes = new Map<string, string>();
    for (const matched of source.matchAll(ATTRIBUTE)) {
        const name = (matched[1] as string).toLowerCase();
        if (attributes.has(name)) continue;
        attributes.set(name, decodeHTMLAttribute(matched[2] ?? matched[3] ?? matched[4] ?? ""));
    }
    return attributes;
}

/**
 * 写属性值（放在双引号里）：`&`、`"`、`<` 与换行写成实体（输出 11）。`` ` ``、`[`、`]`、`\` 也写成实体：解析器判断链接文字的
 * 范围时不把标签当整体，属性值里的这几个字符会被当成行内代码或括号。
 */
export function escapeAttribute(value: string): string {
    return value
        .replace(/&/gu, "&amp;")
        .replace(/"/gu, "&quot;")
        .replace(/</gu, "&lt;")
        .replace(/\r\n|\r|\n/gu, "&#10;")
        .replace(/[`[\]\\]/gu, (char) => `&#${char.charCodeAt(0)};`);
}
