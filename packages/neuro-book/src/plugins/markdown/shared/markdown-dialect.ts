/**
 * NeuroBook Markdown 方言的标签名单、属性写法与原样语法的判据（docs/specs/workspace/markdown-dialect.md 输出 9、11–17、23–25）。
 * 编辑器的编解码器（`plugins/markdown/web/syntax/`）与字数的轻量扫描（`word-count.ts`）都从这里取，两边认法一致：
 * 新增方言标签时在这里登记（编解码器从各语法模块收集的名单与这里不同时，字数的一致性测试失败）。
 *
 * 只放两边都要的东西：标签名、属性的读与写、原样内容的判据。标签的配对、读成什么节点由编辑器的语法模块决定。
 */

import {decodeHTMLAttribute} from "entities";

/** 开闭标签各自独占一行的块级方言标签。 */
export const BLOCK_DIALECT_TAGS = ["comment", "bilingual", "align", "html"] as const;

/** 行内的方言标签（含能读的 HTML 文字标记与旧写法 `inline-comment`）。 */
export const INLINE_DIALECT_TAGS = ["comment", "inline-comment", "ruby", "span", "mark", "sup", "sub"] as const;

/** 能读的行内 HTML（输出 25）：编辑器读成粗体、斜体、删除线与换行，不是原样片段。 */
export const READABLE_INLINE_HTML = ["strong", "b", "em", "i", "del", "s", "br"] as const;

/** 没有闭标签的 HTML 元素：单独一个开标签就是完整的片段。 */
export const VOID_HTML_TAGS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * 行首出现时会开启一个 HTML 块（CommonMark 的第 1–6 类，它们还能打断段落）的写法：注释、处理指令、声明、CDATA、`<script>`
 * 这类、块级标签。
 */
export const OPENS_HTML_BLOCK = /^<(?:!--|\?|![A-Za-z]|!\[CDATA\[|(?:script|pre|style|textarea)(?:\s|>|$)|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$))/iu;

/** 单个完整的标签（开标签或闭标签）：独占一行时会开启 HTML 块（CommonMark 的第 7 类，不能打断段落，但能开始一个块）。 */
export const LONE_TAG = /^<\/?[A-Za-z][\w-]*(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?\/?>$/u;

/** 行内数学（Pandoc 的 tex_math_dollars）：开 `$` 后不是空白，闭 `$` 前不是空白、后面不是数字。不带锚点，用时自己加。 */
export const MATH_INLINE_SOURCE = String.raw`\$(?=\S)(?:\\.|[^$\\\n])*?\S\$(?!\d)|\$[^\s$]\$(?!\d)`;

/** 脚注的引用 `[^标签]`。不带锚点。 */
export const FOOTNOTE_REF_SOURCE = String.raw`\[\^[^\]\s]+\]`;

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
