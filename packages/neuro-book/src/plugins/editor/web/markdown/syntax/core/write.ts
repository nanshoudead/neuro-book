/**
 * 核心语法的写法（docs/specs/workspace/markdown-dialect.md 输出 2、5、10、19、20、25）：块、行内节点与标记写回 Markdown。
 * 有写法属性时按它写（`context.style`），没有或降级为规范写法时按输出 10 的规范写法。写不出的结构抛 `Unrepresentable`。
 */

import type {Mark, Node as PMNode} from "@tiptap/pm/model";

import type {BlockWriter, InlineWriter, MarkWriter, WriteContext} from "../types";
import {LONE_TAG, OPENS_HTML_BLOCK} from "../raw";
import {normalizeLabel, Unrepresentable} from "../types";

/** 写出的列表开头的符号（无序的 `-`、`*`、`+`，有序的分隔符）；不是列表时为 null。 */
const leadingMarker = (text: string): string | null => /^(?:\d+([.)])|([-*+]))(?:[ \t]|$)/mu.exec(text.split("\n", 1)[0] as string)?.slice(1).find((part) => part !== undefined) ?? null;

/**
 * 容器里的子块：空段落不保留（方言 Spec 的“块”），只剩一个空段落时它是占位，写成空串。相邻的两个列表符号相同时会读成一个
 * 列表（方言 Spec 输出 3），后一个换符号；子块里的列表从不轮换的写法开始，不沿用外层的轮换。
 */
export function children(node: PMNode, context: WriteContext): string[] {
    const blocks: PMNode[] = [];
    node.forEach((child) => {
        if (!(child.type.name === "paragraph" && child.childCount === 0)) blocks.push(child);
    });
    const out: string[] = [];
    for (const child of blocks) {
        let text = context.block(child, 0);
        const previous = out.length === 0 ? null : leadingMarker(out[out.length - 1] as string);
        for (let times = 1; times < MARKERS.length && previous !== null && leadingMarker(text) === previous; times += 1) text = context.block(child, times);
        out.push(text);
    }
    return out;
}

/** 给续行加缩进：第一行接在符号后面，空行保持空。 */
function indent(text: string, first: string, rest: string): string {
    return text.split("\n").map((line, index) => (index === 0 ? first + line : line === "" ? "" : rest + line)).join("\n").replace(/[ \t]+$/u, "") || first.trimEnd();
}

interface ListStyle {
    readonly marker?: string;
    readonly delimiter?: string;
    readonly numbering?: "same" | "sequential";
}

/** 写出的列表能不能紧接着段落写（只换一行）：空的列表项、不从 1 开始的有序列表不能打断段落，会被读成段落的续行或下划线式标题。 */
const interruptsParagraph = (text: string): boolean => /^(?:[-*+]|1[.)])[ \t]+\S/u.test(text);

/**
 * 列表项的写出：子块之间紧凑时只换一行（段落后接子列表），一项里有两个以上的非列表块时必须空行（这会让整个列表变松散）。
 */
function list(node: PMNode, context: WriteContext, markerOf: (index: number, item: PMNode) => string): string {
    const items: Array<{marker: string; blocks: string[]; kinds: string[]; leadingEmpty: boolean}> = [];
    node.forEach((item, _offset, index) => {
        const kinds: string[] = [];
        item.forEach((child) => {
            if (!(child.type.name === "paragraph" && child.childCount === 0)) kinds.push(child.type.name);
        });
        const first = item.firstChild;
        const leadingEmpty = item.type.name === "taskItem" && first !== null && first.type.name === "paragraph" && first.childCount === 0;
        items.push({marker: markerOf(index, item), blocks: children(item, context), kinds, leadingEmpty});
    });
    const loose = items.some((item) => item.kinds.filter((kind) => !kind.endsWith("List")).length > 1);
    return items.map((item) => {
        // 只换一行的前提：后一块是能打断段落的列表，前一块不以 `<` 开头（`<br>` 这类独占一行时是 HTML 块，会吞掉下一行）。
        const tight = (index: number): boolean => !loose && item.kinds[index]?.endsWith("List") === true && interruptsParagraph(item.blocks[index] as string) && !(item.blocks[index - 1] as string).startsWith("<");
        const body = item.blocks.map((block, index) => (index === 0 ? block : (tight(index) ? "\n" : "\n\n") + block)).join("");
        const width = " ".repeat(item.marker.replace(/\[[ xX]\] $/u, "").length);
        // 任务项的第一段是空的（还没写字）：复选框单独一行，其余的块从下一行起（和复选框同一行的块只会被读成文字）。
        // 复选框那一行在解析器看来是段落，紧接着写的列表也要能打断段落。
        if (item.leadingEmpty) {
            if (body === "") return item.marker.trimEnd();
            const separator = item.kinds[0]?.endsWith("List") === true && !interruptsParagraph(item.blocks[0] as string) ? "\n\n" : "\n";
            return `${item.marker.trimEnd()}${separator}${indent(body, width, width)}`;
        }
        return indent(body, item.marker, width);
    }).join(loose ? "\n\n" : "\n");
}

const MARKERS = ["-", "*", "+"];

/** 无序列表的符号按 `alternate` 轮换。 */
const rotate = (marker: string, times: number): string => MARKERS[(Math.max(0, MARKERS.indexOf(marker)) + times) % MARKERS.length] as string;

const bulletMarker = (context: WriteContext, node: PMNode): string => rotate(context.style<ListStyle>(node)?.marker ?? "-", context.options.alternate);

const blocks: Readonly<Record<string, BlockWriter>> = {
    paragraph: (node, context) => context.inline(node),
    heading: (node, context) => {
        const level = node.attrs.level as number;
        const style = context.style<{style: "atx" | "setext"; closing?: string}>(node);
        const content = context.inline(node, {heading: true});
        // `#` 式标题只能有一行；内容跨行（里面有跨行的原样片段）时，一、二级标题改用下划线式，其余写不出。
        const multiline = content.includes("\n");
        if (multiline && level > 2) throw new Unrepresentable("三级以下的标题不能跨行");
        if ((style?.style === "setext" || multiline) && level <= 2 && content !== "") return `${content}\n${(level === 1 ? "=" : "-").repeat(3)}`;
        if (content === "") return "#".repeat(level);
        return `${"#".repeat(level)} ${content}${style?.closing === undefined ? "" : ` ${style.closing}`}`;
    },
    blockquote: (node, context) => {
        const body = children(node, context).join("\n\n");
        return body === "" ? ">" : body.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
    },
    bulletList: (node, context) => {
        const marker = bulletMarker(context, node);
        return list(node, context, () => `${marker} `);
    },
    orderedList: (node, context) => {
        const style = context.style<ListStyle>(node);
        const start = (node.attrs.start as number | null) ?? 1;
        const base = style?.delimiter ?? ".";
        const delimiter = context.options.alternate % 2 === 1 ? (base === ")" ? "." : ")") : base;
        return list(node, context, (index) => `${style?.numbering === "same" ? start : start + index}${delimiter} `);
    },
    taskList: (node, context) => {
        // 新加的项（没有写法）跟随同一个列表里已有的项：符号相同，勾选写成同样大小写的 `x`（输出 2 的“跟随”）。
        type TaskStyle = {marker?: string; check?: string};
        const styles: TaskStyle[] = [];
        node.forEach((item) => {
            const style = context.style<TaskStyle>(item);
            if (style !== null) styles.push(style);
        });
        const marker = styles[0]?.marker;
        const upper = styles.find((style) => style.check === "x" || style.check === "X")?.check === "X";
        return list(node, context, (_index, item) => {
            const style = context.style<TaskStyle>(item);
            const checked = item.attrs.checked === true;
            const check = checked ? ((style?.check ?? (upper ? "X" : "x")) === "X" ? "X" : "x") : " ";
            return `${rotate(style?.marker ?? marker ?? "-", context.options.alternate)} [${check}] `;
        });
    },
    codeBlock: (node, context) => {
        const style = context.style<{fence?: string; indented?: boolean}>(node);
        const content = node.textContent;
        const language = (node.attrs.language as string | null) ?? "";
        if (style?.indented === true && content !== "" && !/^\s*\n|\n\s*$/u.test(content) && language === "") {
            return content.split("\n").map((line) => (line === "" ? "" : `    ${line}`)).join("\n");
        }
        let char = style?.fence?.[0] === "~" ? "~" : "`";
        if (char === "`" && language.includes("`")) char = "~";
        const longest = Math.max(0, ...content.split("\n").map((line) => new RegExp(`^ {0,3}(${char}+)`, "u").exec(line)?.[1]?.length ?? 0));
        const fence = char.repeat(Math.max(3, style?.fence?.length ?? 3, longest + 1));
        return `${fence}${language}\n${content === "" ? "" : `${content}\n`}${fence}`;
    },
    horizontalRule: (node, context) => context.style<string>(node) ?? "---",
    table: (node, context) => {
        const rows: string[][] = [];
        const aligns: Array<string | null> = [];
        node.forEach((row, _offset, rowIndex) => {
            const cells: string[] = [];
            row.forEach((cell) => {
                if (rowIndex === 0 && cell.type.name !== "tableHeader") throw new Unrepresentable("表格没有表头行");
                if ((cell.attrs.colspan as number) !== 1 || (cell.attrs.rowspan as number) !== 1) throw new Unrepresentable("表格有合并的单元格");
                if (cell.childCount !== 1) throw new Unrepresentable("单元格里不止一段");
                if (rowIndex === 0) aligns.push((cell.attrs.align as string | null) ?? null);
                cells.push(context.inline(cell.child(0), {table: true}));
            });
            rows.push(cells);
        });
        const width = aligns.length;
        const line = (cells: ReadonlyArray<string>): string => `| ${Array.from({length: width}, (_, index) => cells[index] ?? "").join(" | ")} |`;
        const delimiter = `| ${aligns.map((align) => (align === "left" ? ":--" : align === "right" ? "--:" : align === "center" ? ":-:" : "---")).join(" | ")} |`;
        return [line(rows[0] ?? []), delimiter, ...rows.slice(1).map(line)].join("\n");
    },
};

const hardBreak: InlineWriter = (node, context, around) => {
    if (around.place.table === true || around.place.heading === true) return "<br>";
    // 单换行、两空格、反斜杠在段首、段末与挨着另一个换行时读不回来（输出 5）：这些位置写 `<br>`，几个相邻的换行写在同一行，
    // `<br>` 不会单独占一行（单独一行的 `<br>` 会被读成 HTML 块）。
    if (around.previous === null || around.next === null || around.previous.type.name === "hardBreak" || around.next.type.name === "hardBreak") return "<br>";
    // 换行后面紧跟会开启 HTML 块的原样片段：换了行它会打断段落，写 `<br>` 留在同一行。挨着单个完整标签的原样片段时也写
    // `<br>`：标签独占一行会被读成 HTML 块（`../raw` 的 `LONE_TAG`）。
    const raw = (other: PMNode): string | null => (other.type.name === "rawInline" ? String(other.attrs.raw ?? "") : null);
    const nextRaw = raw(around.next);
    const previousRaw = raw(around.previous);
    if (nextRaw !== null && (OPENS_HTML_BLOCK.test(nextRaw) || LONE_TAG.test(nextRaw))) return "<br>";
    if (previousRaw !== null && LONE_TAG.test(previousRaw)) return "<br>";
    switch (context.style<string>(node)) {
        case "spaces":
            return "  \n";
        case "backslash":
            return "\\\n";
        case "br":
            return "<br>";
        default:
            return "\n";
    }
};

/** 链接与图片地址：含空白、尖括号或括号不配对时写成 `<地址>`。 */
function destination(href: string): string {
    let depth = 0;
    let balanced = true;
    for (const char of href) {
        if (char === "(") depth += 1;
        else if (char === ")" && --depth < 0) balanced = false;
    }
    if (/[\s<>]/u.test(href) || !balanced || depth !== 0 || href === "") return `<${href.replace(/[<>\\]/gu, (char) => `\\${char}`)}>`;
    return href.replace(/\\(?=[!-/:-@[-`{-~])/gu, "\\\\");
}

const title = (value: string | null | undefined): string => (value === null || value === undefined || value === "" ? "" : ` "${value.replace(/["\\]/gu, (char) => `\\${char}`)}"`);

interface LinkStyle {
    readonly style?: "inline" | "reference" | "collapsed" | "shortcut" | "angle" | "bare";
    readonly label?: string;
}

/** 链接这一段最终用哪种写法：引用式要定义还在，自动链接要文字就是地址，否则行内。 */
function linkForm(mark: Mark, context: WriteContext, text: string): LinkStyle["style"] {
    const style = context.style<LinkStyle>(mark);
    const href = mark.attrs.href as string;
    // 引用式要定义还在、并且地址就是这个链接的地址（同名定义取全篇第一条，换了顺序地址会变）。
    const defines = (label: string): boolean => context.definitions.get(normalizeLabel(label)) === href;
    switch (style?.style) {
        case "reference":
            return defines(style.label ?? "") ? "reference" : "inline";
        case "collapsed":
        case "shortcut":
            return defines(text) ? style.style : "inline";
        case "angle":
            return text === href || `mailto:${text}` === href ? "angle" : "inline";
        case "bare":
            return text === href || `http://${text}` === href || `mailto:${text}` === href ? "bare" : "inline";
        default:
            return "inline";
    }
}

const emphasisPair = (markdown: string, html: string, context: WriteContext, mark: Mark): {open: string; close: string} => {
    const style = context.style<string>(mark);
    // 记下的写法是标签名（`strong`、`B`，大小写照原文）还是符号（`**`、`_`）。
    const tag = context.options.htmlEmphasis ? html : style !== null && /^[a-z]+$/iu.test(style) ? style : null;
    if (tag !== null) return {open: `<${tag}>`, close: `</${tag}>`};
    const delimiter = style ?? markdown;
    return {open: delimiter, close: delimiter};
};

const marks: Readonly<Record<string, MarkWriter>> = {
    bold: {
        emphasis: true,
        open: (mark, context) => emphasisPair("**", "strong", context, mark).open,
        close: (mark, context) => emphasisPair("**", "strong", context, mark).close,
    },
    italic: {
        emphasis: true,
        open: (mark, context) => emphasisPair("*", "em", context, mark).open,
        close: (mark, context) => emphasisPair("*", "em", context, mark).close,
    },
    strike: {
        emphasis: true,
        open: (mark, context) => emphasisPair("~~", "del", context, mark).open,
        close: (mark, context) => emphasisPair("~~", "del", context, mark).close,
    },
    code: {
        verbatim: () => true,
        // 行内代码里只能是文字：盖住它的格式写在反引号外面。
        textOnly: true,
        open: (mark, context, run) => {
            const longest = Math.max(0, ...(run.text.match(/`+/gu) ?? []).map((ticks) => ticks.length));
            const ticks = "`".repeat(Math.max(longest + 1, context.style<number>(mark) ?? 1));
            const pad = run.text.startsWith("`") || run.text.endsWith("`") || (/^ .*[^ ].* $/u.test(run.text)) ? " " : "";
            return ticks + pad;
        },
        close: (mark, context, run) => {
            const longest = Math.max(0, ...(run.text.match(/`+/gu) ?? []).map((ticks) => ticks.length));
            const ticks = "`".repeat(Math.max(longest + 1, context.style<number>(mark) ?? 1));
            const pad = run.text.startsWith("`") || run.text.endsWith("`") || (/^ .*[^ ].* $/u.test(run.text)) ? " " : "";
            return pad + ticks;
        },
    },
    link: {
        verbatim: (mark, context, run) => {
            const form = linkForm(mark, context, run.text);
            return form === "angle" || form === "bare";
        },
        open: (mark, context, run) => {
            const form = linkForm(mark, context, run.text);
            return form === "angle" ? "<" : form === "bare" ? "" : "[";
        },
        close: (mark, context, run) => {
            const form = linkForm(mark, context, run.text);
            switch (form) {
                case "angle":
                    return ">";
                case "bare":
                    return "";
                case "reference":
                    return `][${context.style<LinkStyle>(mark)?.label ?? ""}]`;
                case "collapsed":
                    return "][]";
                case "shortcut":
                    return "]";
                default:
                    return `](${destination(mark.attrs.href as string)}${title(mark.attrs.title as string | null)})`;
            }
        },
    },
};

/**
 * 图片：说明是纯文字（读入时按 CommonMark 取说明的纯文字，见 `index.ts` 的 `plainText`），按正文的规则转义，方括号一律转义
 * （说明在 `![…]` 里，不配对的 `]` 会提前结束它）。
 */
const image: InlineWriter = (node, context) => {
    const alt = context.escape(String(node.attrs.alt ?? "")).replace(/(?<!\\)[[\]]/gu, (char) => `\\${char}`);
    const style = context.style<LinkStyle>(node);
    if (style?.style === "reference" && context.definitions.get(normalizeLabel(style.label ?? "")) === String(node.attrs.src ?? "")) return `![${alt}][${style.label}]`;
    return `![${alt}](${destination(String(node.attrs.src ?? ""))}${title(node.attrs.title as string | null)})`;
};

export const coreWriters = {blocks, inline: {hardBreak, image} as Readonly<Record<string, InlineWriter>>, marks};
