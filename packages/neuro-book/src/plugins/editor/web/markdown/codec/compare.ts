/**
 * 读回校验的比较（docs/specs/workspace/markdown-dialect.md 输出 3）：重新写出的块读回来，与编辑器里的节点比。
 *
 * - 写法属性 `markdown`：编辑器里为空（新建的内容）时不比，读回的写法就是这次写成的样子；不为空时必须相同（输出 2 的“按原来的写法”）。
 *   降级到规范写法（`styles: "canonical"`）时一律不比。
 * - 强调类标记两端的空白：写出时移到了标记外面（`render/inline.ts`），比较前对编辑器的节点做同样的处理。
 * - 容器（引用、列表项、表格单元格以外的块容器）里的空段落不算：方言 Spec 规定容器里不保留空段落，写出时去掉。只剩一个空段落
 *   时它是容器的占位，照算。
 * - 其余属性、标记与文字逐个比较。
 */

import type {Mark, Node as PMNode} from "@tiptap/pm/model";

export interface CompareOptions {
    readonly styles: "keep" | "canonical";
    /** 强调类标记的类型名。 */
    readonly emphasis: ReadonlySet<string>;
    /** 不比较的属性（节点或标记类型 → 属性名）：读入时推导出来的、由跨块上下文决定的（`MarkdownLanguage.uncomparedAttrs`）。 */
    readonly ignored?: ReadonlyMap<string, ReadonlySet<string>>;
    /** 身上的标记不比较的行内节点类型（硬换行）。 */
    readonly markless?: ReadonlySet<string>;
    /** 只盖文字的标记类型（注音）：行内节点身上的它不比较。 */
    readonly textOnly?: ReadonlySet<string>;
    /** 写出时对行内内容做的“跟随”整理（`render/inline.ts`），比较前对编辑器的节点做同样的处理。 */
    readonly follow?: (items: InlineItem[]) => void;
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (!sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false;
    return true;
}

function sameAttrs(editor: Record<string, unknown>, read: Record<string, unknown>, options: CompareOptions, type: string): boolean {
    const ignored = options.ignored?.get(type);
    for (const key of new Set([...Object.keys(editor), ...Object.keys(read)])) {
        if (ignored?.has(key) === true) continue;
        if (key === "markdown" && (options.styles === "canonical" || editor[key] === null || editor[key] === undefined)) continue;
        // 原样内容在容器里（列表项、引用）读回时只能从去掉了缩进与 `>` 的文字里取，换行符归一成 `\n`；写进文件的字节不受影响。
        if (key === "raw" && typeof editor[key] === "string" && typeof read[key] === "string" && (editor[key] as string).replace(/\r\n?/gu, "\n") === (read[key] as string).replace(/\r\n?/gu, "\n")) continue;
        if (!sameValue(editor[key], read[key])) return false;
    }
    return true;
}

function sameMarks(editor: ReadonlyArray<Mark>, read: ReadonlyArray<Mark>, options: CompareOptions): boolean {
    if (editor.length !== read.length) return false;
    return editor.every((mark) => read.some((other) => other.type === mark.type && sameAttrs(mark.attrs, other.attrs, options, mark.type.name)));
}

/** 行内内容摊成逐字（文字按字、行内节点各一项），标记跟在每一项上。 */
export interface InlineItem {
    readonly char: string | null;
    readonly node: PMNode | null;
    marks: ReadonlyArray<Mark>;
}

export function flatten(parent: PMNode, markless: ReadonlySet<string> = new Set(), textOnly: ReadonlySet<string> = new Set()): InlineItem[] {
    const items: InlineItem[] = [];
    parent.forEach((child) => {
        if (child.isText) for (const char of child.text as string) items.push({char, node: null, marks: child.marks});
        // 行内节点身上的代码类标记（schema 里标了 `code`）与只盖文字的标记写不出来：行内代码与注音里只能有文字。
        else items.push({char: null, node: child, marks: markless.has(child.type.name) ? [] : child.marks.filter((mark) => (mark.type.spec as {code?: boolean}).code !== true && !textOnly.has(mark.type.name))});
    });
    return items;
}

/**
 * 硬换行（`markless`）身上的标记看不出来，改为取前后两边共有的标记：夹在一段标记中间的换行不把它断开（批注里可以有换行，
 * 断开就成了两截），在边上的换行不带标记。行内代码与注音里不能有换行：代码类标记（schema 里标了 `code`）与只盖文字的标记
 * 不跨换行。写出前（`render/inline.ts`）与比较前都用它，两边一致。
 */
export function bridge(items: InlineItem[], markless: ReadonlySet<string>, textOnly: ReadonlySet<string>): void {
    items.forEach((item, index) => {
        if (item.node === null || !markless.has(item.node.type.name)) return;
        const before = items[index - 1];
        const after = items.slice(index + 1).find((next) => next.node === null || !markless.has(next.node.type.name));
        item.marks = before === undefined || after === undefined ? [] : before.marks.filter((mark) => mark.isInSet(after.marks) && (mark.type.spec as {code?: boolean}).code !== true && !textOnly.has(mark.type.name));
    });
}

/**
 * 规范写法里标记的写法属性不起作用：去掉它，相邻的、只有写法不同的同类标记成为同一个（例如两段写法不同的行内代码挨着，
 * 只能写成一段）。写出前（`render/inline.ts`）与比较前都用它，两边一致。
 */
export function withoutStyles(items: InlineItem[]): void {
    for (const item of items) {
        item.marks = item.marks.map((mark) => (mark.attrs.markdown === null || mark.attrs.markdown === undefined ? mark : mark.type.create({...mark.attrs, markdown: null})));
    }
}

/**
 * 强调类标记覆盖的每一段，两端的空白与硬换行（`markless`）去掉这个标记：符号后面紧跟空白或换行就开不了、闭不了。写出前
 * （`render/inline.ts`）与比较前都用它，两边一致。
 */
export function expel(items: InlineItem[], emphasis: ReadonlySet<string>, markless: ReadonlySet<string> = new Set()): void {
    const isSpace = (item: InlineItem | undefined): boolean => item !== undefined && (item.char === null ? item.node !== null && markless.has(item.node.type.name) : /[ \t]/u.test(item.char));
    for (let index = 0; index < items.length; index += 1) {
        for (const mark of (items[index] as InlineItem).marks) {
            if (!emphasis.has(mark.type.name)) continue;
            if (index > 0 && mark.isInSet((items[index - 1] as InlineItem).marks)) continue;
            let end = index;
            while (end + 1 < items.length && mark.isInSet((items[end + 1] as InlineItem).marks)) end += 1;
            let first = index;
            let last = end;
            while (first <= last && isSpace(items[first])) first += 1;
            while (last >= first && isSpace(items[last])) last -= 1;
            if (first > last) continue;
            for (let at = index; at <= end; at += 1) {
                if (at < first || at > last) (items[at] as InlineItem).marks = mark.removeFromSet((items[at] as InlineItem).marks);
            }
        }
    }
}

/** 编辑器里的节点与读回的节点是不是同一个东西。 */
export function equivalent(editor: PMNode, read: PMNode, options: CompareOptions): boolean {
    if (editor.type !== read.type || !sameAttrs(editor.attrs, read.attrs, options, editor.type.name) || !sameMarks(editor.marks, read.marks, options)) return false;
    if (editor.isTextblock) {
        const markless = options.markless ?? new Set<string>();
        const left = flatten(editor, markless, options.textOnly);
        const right = flatten(read, markless, options.textOnly);
        bridge(left, markless, options.textOnly ?? new Set());
        if (options.styles === "canonical") withoutStyles(left);
        options.follow?.(left);
        expel(left, options.emphasis, markless);
        if (left.length !== right.length) return false;
        return left.every((item, index) => {
            const other = right[index] as InlineItem;
            if (item.char !== other.char) return false;
            if (item.node !== null && (other.node === null || !equivalent(item.node.mark([]), other.node.mark([]), options))) return false;
            // 硬换行身上的标记只是整理时补上的（`bridge`），看不出来，不比较。
            return (item.node !== null && markless.has(item.node.type.name)) || sameMarks(item.marks, other.marks, options);
        });
    }
    if (editor.isText) return editor.text === read.text;
    const left = blockChildren(editor);
    const right = blockChildren(read);
    if (left.length !== right.length) return false;
    return left.every((child, index) => equivalent(child, right[index] as PMNode, options));
}

const isEmptyParagraph = (node: PMNode): boolean => node.type.name === "paragraph" && node.childCount === 0;

/** 容器的子块，去掉空段落（全是空段落时留一个占位）。 */
function blockChildren(node: PMNode): PMNode[] {
    const children: PMNode[] = [];
    node.forEach((child) => children.push(child));
    const kept = children.filter((child) => !isEmptyParagraph(child));
    return kept.length === 0 && children.length > 0 ? [children[0] as PMNode] : kept;
}
