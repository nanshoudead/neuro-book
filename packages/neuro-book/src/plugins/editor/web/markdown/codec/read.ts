/**
 * 读入（docs/specs/workspace/markdown-dialect.md 输出 1、2、9）：原文 → 编辑器的文档，并记下每个顶层节点来自哪一块原文。
 *
 * 不用 `@tiptap/markdown` 的 `MarkdownManager`：它的调度在私有方法里，引用定义只能整篇一起解析、实体会被解码两次、行内 HTML
 * 依赖 DOM。这里整篇只分词一次（引用定义表来自同一个词法器），逐个顶层单元交给语法模块的读法，读出的节点逐块校验。
 *
 * 读入永不失败：读不出、不合 schema 的块读成原样块，原文字节照留。
 */

import {Mark} from "@tiptap/pm/model";
import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import type {JSONContent} from "@tiptap/core";
import type {Token} from "marked";

import type {MarkdownLanguage} from "../language";
import type {ReadContext} from "../syntax/types";
import {normalize, segment, splitFrontmatter} from "./source";
import type {Normalized} from "./source";

/**
 * 一块原文在它那一代里的来源。写回时，节点还挂着这个来源、同一块的节点都还在、前后的邻居也没变，这一块就写原文。
 * `prev`、`next` 是这一代原文里的前后两块（第三版修订 4：相邻关系不靠序号，撤销回到旧节点时仍能判断）。
 */
export interface SourceUnit {
    /** 这一块的原文字节（不含结尾的换行）。 */
    readonly raw: string;
    /** 这一块之前的间隔的原文字节。 */
    readonly gapBefore: string;
    /** 间隔在编辑器里表示成几个空段落。 */
    readonly emptiesBefore: number;
    /** 这一块读出了几个顶层节点（一个列表可能拆成任务列表与普通列表）。 */
    readonly size: number;
    prev: SourceUnit | null;
    next: SourceUnit | null;
}

/** 一个顶层节点的来源：所属的块与它是这一块的第几个节点。 */
export interface Origin {
    readonly unit: SourceUnit;
    readonly part: number;
}

export interface ReadResult {
    /** BOM 与 frontmatter，原样。 */
    readonly prefix: string;
    /** 正文原文（空文档与整篇写回时用）。 */
    readonly body: string;
    readonly doc: PMNode;
    readonly origins: WeakMap<PMNode, Origin>;
    /** 最后一块之后的间隔原文（含文件末尾的换行）。 */
    readonly trailing: string;
    /** 原文里用得多的换行符。 */
    readonly eol: "\n" | "\r\n";
    /** 对不上任何词法单元的原文段数（诊断用）。 */
    readonly skipped: number;
    /** 读不出或不合 schema、换成原样块的块：原因（诊断用；语料测试断言它为空）。 */
    readonly problems: ReadonlyArray<string>;
}

const newlines = (gap: string): number => {
    let count = 0;
    for (let index = 0; index < gap.length; index += 1) if (gap.charCodeAt(index) === 10) count += 1;
    return count;
};

/** 方言 Spec 的“块”：两块之间 `k` 个空段落对应 `k + 1` 个空行（`k + 2` 个换行）；开头 `k` 个换行对应 `k` 个空段落。 */
export const emptiesBetween = (gap: string): number => Math.max(0, newlines(gap) - 2);
export const emptiesLeading = (gap: string): number => newlines(gap);
/** 最后一块之后：`k` 个空行对应 `k` 个空段落，最后一个换行是文件末尾的换行。 */
export const emptiesTrailing = (gap: string): number => Math.max(0, newlines(gap) - 1);

function dominantEol(body: string): "\n" | "\r\n" {
    let crlf = 0;
    let lf = 0;
    for (let index = 0; index < body.length; index += 1) {
        if (body.charCodeAt(index) !== 10) continue;
        if (index > 0 && body.charCodeAt(index - 1) === 13) crlf += 1;
        else lf += 1;
    }
    return crlf > lf ? "\r\n" : "\n";
}

/** 读法产出的 JSON → 节点。标记按施加的先后用 `addToSet` 合成，所以互斥的标记（行内代码排斥其它标记）按 schema 的规则取舍。 */
function toNode(schema: Schema, json: JSONContent): PMNode {
    const marks = (json.marks ?? []).reduce<ReadonlyArray<Mark>>((set, mark) => schema.mark(mark.type, mark.attrs).addToSet(set as Mark[]), Mark.none);
    if (json.type === "text") return schema.text(json.text ?? "", marks as Mark[]);
    const type = schema.nodes[json.type ?? ""];
    if (type === undefined) throw new RangeError(`未知的节点类型 ${json.type ?? ""}`);
    const content = (json.content ?? []).filter((child) => child.type !== "text" || (child.text ?? "") !== "").map((child) => toNode(schema, child));
    return type.create(json.attrs ?? null, content, marks as Mark[]);
}

/**
 * 读一块：调度语法模块的读法，读出的节点逐个校验。`raw` 节点的原文按单元在规范化文字里的位置从原文切出：沿块里的位置向后找，
 * 找不到（例如引用里的子块去掉了行首的 `>`）时退回单元自己的文字，这时原文里的 CR 不会保留。
 */
function readBlock(language: MarkdownLanguage, schema: Schema, normalized: Normalized, source: string, block: {readonly from: number; readonly to: number}, token: Token): PMNode[] {
    let cursor = block.from;
    const sourceOf = (value: string): string => {
        const at = normalized.text.indexOf(value, cursor);
        if (at < 0 || at + value.length > block.to) return value;
        cursor = at + value.length;
        return source.slice(normalized.toSource[at] as number, normalized.toSource[at + value.length] as number);
    };
    const context: ReadContext = {
        inline: (tokens) => tokens.flatMap((child) => readToken(child, true)),
        blocks: (tokens) => tokens.flatMap((child) => (child.type === "space" ? [] : readToken(child, false))),
        mark: (type, content, attrs) => content.map((node) => ({...node, marks: [...(node.marks ?? []), {type, attrs}]})),
        raw: (child, inline) => ({type: inline ? "rawInline" : "rawBlock", attrs: {raw: sourceOf(inline ? child.raw : child.raw.replace(/\n+$/u, ""))}}),
    };
    function readToken(child: Token, inline: boolean): JSONContent[] {
        for (const reader of (inline ? language.inlineReaders : language.readers).get(child.type) ?? []) {
            const result = reader(child, context);
            if (result !== null) return result;
        }
        // 没有读法认领：保住原文。
        return [context.raw(child, inline)];
    }
    return readToken(token, false).map((json) => {
        const node = toNode(schema, json);
        node.check();
        return node;
    });
}

/**
 * 读入整篇。`schema` 必须是编辑器自己的 schema（Tiptap 每个编辑器各建一份；不同 schema 的节点不能放进同一个文档）。
 */
export function readMarkdown(language: MarkdownLanguage, schema: Schema, source: string): ReadResult {
    const {prefix, body} = splitFrontmatter(source);
    const normalized = normalize(body, language.blockTags, language.openTagAtLineEnd);
    const tokens = language.marked.lexer(normalized.text);
    const {blocks, gaps, skipped} = segment(normalized, body, tokens);
    const origins = new WeakMap<PMNode, Origin>();
    const nodes: PMNode[] = [];
    const empty = (): PMNode => schema.nodes.paragraph!.create();
    const problems: string[] = [];
    let previous: SourceUnit | null = null;
    blocks.forEach((block, index) => {
        const gap = gaps[index] as string;
        const empties = index === 0 ? emptiesLeading(gap) : emptiesBetween(gap);
        for (let count = 0; count < empties; count += 1) nodes.push(empty());
        let read: PMNode[];
        try {
            read = block.unit === null ? [] : readBlock(language, schema, normalized, body, block, block.unit);
        } catch (error) {
            // 读入不失败（输出 9）：这一块读成原样块，原因留给诊断。读法自己的缺陷也走这里，由语料测试的 `problems` 断言发现。
            problems.push(`${block.unit?.type ?? "?"}: ${error instanceof Error ? error.message : String(error)}`);
            read = [];
        }
        if (read.length === 0) read = [schema.nodes.rawBlock!.create({raw: block.raw})];
        const unit: SourceUnit = {raw: block.raw, gapBefore: gap, emptiesBefore: empties, size: read.length, prev: previous, next: null};
        if (previous !== null) previous.next = unit;
        previous = unit;
        read.forEach((node, part) => origins.set(node, {unit, part}));
        nodes.push(...read);
    });
    const trailing = gaps[blocks.length] as string;
    if (blocks.length > 0) for (let count = emptiesTrailing(trailing); count > 0; count -= 1) nodes.push(empty());
    if (nodes.length === 0) nodes.push(empty());
    return {prefix, body, doc: schema.nodes.doc!.create(null, nodes), origins, trailing, eol: dominantEol(body), skipped, problems};
}
