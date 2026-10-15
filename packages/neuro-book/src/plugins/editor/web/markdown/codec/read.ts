/**
 * 读入（docs/specs/workspace/markdown-dialect.md 输出 1、2、9）：原文 → 编辑器的文档，并记下每个顶层节点来自哪一块原文。
 *
 * 不用 `@tiptap/markdown` 的 `MarkdownManager`：它的调度在私有方法里，引用定义只能整篇一起解析、实体会被解码两次、行内 HTML
 * 依赖 DOM。这里整篇只分词一次（引用定义表来自同一个词法器），逐个顶层单元交给语法模块的读法，读出的节点逐块校验。
 *
 * 读入永不失败：读不出、不合 schema 的块读成原样块，原文字节照留。
 */

import {Fragment, Mark} from "@tiptap/pm/model";
import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import type {JSONContent} from "@tiptap/core";
import type {Lexer, Token} from "marked";

import type {MarkdownLanguage} from "../language";
import type {ReadContext} from "../syntax/types";
import {normalize, segment, splitFrontmatter} from "./source";
import type {Normalized} from "./source";

/**
 * 一块原文：写回时节点还挂着它、同一块的节点都还在且按原顺序相邻，这一块就写原文。没被编辑过的块一直用读入时的这个对象；
 * 重新写出的块在写回被接受后换一个新对象（`SourceMap.record`）。
 */
export interface SourceUnit {
    /** 这一块的原文字节（不含结尾的换行）。 */
    readonly raw: string;
    /** 这一块读出了几个顶层节点（一个列表可能拆成任务列表与普通列表）。 */
    readonly size: number;
}

/** 一个顶层节点的来源：所属的块与它是这一块的第几个节点。 */
export interface Origin {
    readonly unit: SourceUnit;
    readonly part: number;
}

/** 一个间隔：原文字节与它在编辑器里表示成几个空段落。 */
export interface Gap {
    readonly raw: string;
    readonly empties: number;
}

/** 间隔登记里的开头与结尾（“文件开头 → 第一块”“最后一块 → 文件末尾”）。 */
export const START: object = Object.freeze({start: true});
export const END: object = Object.freeze({end: true});

/**
 * 一份文档的原文对照，随写回累积（方言 Spec 输出 2 的“更早的原文仍然记着”）：
 * - `origins`：顶层节点对象 → 它出现过的来源，新的在前。没被编辑的节点也可能换来源（一块原文读成几个节点，编辑了其中一个，
 *   其余的随之重新写出），旧的来源留着：撤销恢复同一块的其它旧节点时，它们仍能凑成那一块原文。`WeakMap`，不阻止回收。
 * - `gaps`：前一块 → 后一块 → 空段落数 → 间隔。按一对来源与其间的空段落数登记，历史上出现过的都留着：撤销恢复旧节点、
 *   删掉后来插入的空段落后，旧的间隔还查得到。
 */
export interface SourceMap {
    /** BOM 与 frontmatter，原样。 */
    readonly prefix: string;
    /** 原文里用得多的换行符：重新写出的块与间隔用它。 */
    readonly eol: "\n" | "\r\n";
    readonly origins: WeakMap<PMNode, ReadonlyArray<Origin>>;
    readonly gaps: WeakMap<object, Map<object, Map<number, Gap>>>;
    /** 读入时正文里没有任何块（空文件、只有空行）：正文原文；否则为 null。 */
    readonly emptyBody: string | null;
    /** 读入时文件末尾有没有换行：重新生成结尾的间隔时保持。 */
    readonly finalNewline: boolean;
}

export interface ReadResult {
    readonly doc: PMNode;
    readonly map: SourceMap;
    /** 对不上任何词法单元的原文段数（诊断用）。 */
    readonly skipped: number;
    /** 读不出或不合 schema、换成原样块的块：原因（诊断用；语料测试断言它为空）。 */
    readonly problems: ReadonlyArray<string>;
}

/** 登记一个间隔。 */
export function recordGap(map: SourceMap, before: object, after: object, gap: Gap): void {
    const inner = map.gaps.get(before) ?? new Map<object, Map<number, Gap>>();
    const byEmpties = inner.get(after) ?? new Map<number, Gap>();
    byEmpties.set(gap.empties, gap);
    inner.set(after, byEmpties);
    map.gaps.set(before, inner);
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
    // 容器的最小合法填充：内容缺了必需的节点（例如任务项开头必须是段落，原文里第一块是标题，或者容器是空的），由 schema 补上；
    // 补不上才算不合 schema（这一块读成原样块）。容器里的空段落在写出时会去掉，比较时也不算（方言 Spec 的“块”）。
    if (!type.validContent(Fragment.from(content))) {
        const filled = type.createAndFill(json.attrs ?? null, content, marks as Mark[]);
        if (filled !== null) return filled;
    }
    return type.create(json.attrs ?? null, content, marks as Mark[]);
}

/** 给一段块内容分词，并处理它排队的行内分词（`lex` 结束时才做的那一步）。 */
function lexBlocks(lexer: Lexer, src: string): Token[] {
    const tokens = lexer.blockTokens(src, []);
    const queue = lexer.inlineQueue.splice(0);
    for (const next of queue) lexer.inlineTokens(next.src, next.tokens);
    return tokens;
}

/**
 * 读一块成 JSON：调度语法模块的读法。`raw` 节点的原文按单元在规范化文字里的位置从原文切出：沿块里的位置向后找，找不到
 * （例如引用里的子块去掉了行首的 `>`）时退回单元自己的文字，这时原文里的 CR 不会保留。
 */
function readBlock(language: MarkdownLanguage, lexer: Lexer, normalized: Normalized, source: string, block: {readonly from: number; readonly to: number}, token: Token): JSONContent[] {
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
        lexBlocks: (src) => lexBlocks(lexer, src),
        lexInline: (src) => lexer.inlineTokens(src, []),
    };
    function readToken(child: Token, inline: boolean): JSONContent[] {
        for (const reader of (inline ? language.inlineReaders : language.readers).get(child.type) ?? []) {
            const result = reader(child, context);
            if (result !== null) return result;
        }
        // 没有读法认领：保住原文。
        return [context.raw(child, inline)];
    }
    return readToken(token, false);
}

/** JSON → 节点并校验；不合 schema 时抛出。 */
function build(schema: Schema, json: ReadonlyArray<JSONContent>): PMNode[] {
    return json.map((value) => {
        const node = toNode(schema, value);
        node.check();
        return node;
    });
}

/**
 * 读入整篇。`schema` 必须是编辑器自己的 schema（Tiptap 每个编辑器各建一份；不同 schema 的节点不能放进同一个文档）。
 */
export function readMarkdown(language: MarkdownLanguage, schema: Schema, source: string): ReadResult {
    const {prefix, body} = splitFrontmatter(source);
    return readBody(language, schema, prefix, body, null);
}

/** 引用定义表：标签（小写）→ 地址与标题。 */
export type Definitions = Readonly<Record<string, {readonly href: string; readonly title: string | null}>>;

/**
 * 读一段正文（没有 frontmatter）。`definitions` 不为 null 时预置进词法器：写回校验只读一个窗口，引用定义可能在窗口外面。
 */
export function readBody(language: MarkdownLanguage, schema: Schema, prefix: string, body: string, definitions: Definitions | null): ReadResult {
    const normalized = normalize(body, language.blockTags, language.openTagAtLineEnd);
    const lexer = new language.marked.Lexer(language.marked.defaults);
    if (definitions !== null) Object.assign(lexer.tokens.links, definitions);
    const tokens = lexer.lex(normalized.text);
    const {blocks, gaps, skipped} = segment(normalized, body, tokens);
    const map: SourceMap = {prefix, eol: dominantEol(body), origins: new WeakMap(), gaps: new WeakMap(), emptyBody: blocks.length === 0 ? body : null, finalNewline: /\n$|\r$/u.test(body)};
    const nodes: PMNode[] = [];
    const empty = (): PMNode => schema.nodes.paragraph!.create();
    const problems: string[] = [];
    // 读入不失败（输出 9）：读不出或不合 schema 的块读成原样块，原因留给诊断。读法自己的缺陷也走这里，由语料测试的 `problems` 断言发现。
    const fail = (block: {readonly unit: Token | null}, error: unknown): null => {
        problems.push(`${block.unit?.type ?? "?"}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    };
    const json = blocks.map((block) => {
        if (block.unit === null) return null;
        try {
            return readBlock(language, lexer, normalized, body, block, block.unit);
        } catch (error) {
            return fail(block, error);
        }
    });
    for (const resolve of language.resolvers) resolve(json.filter((value): value is JSONContent[] => value !== null));
    let previous: object = START;
    blocks.forEach((block, index) => {
        const gap = gaps[index] as string;
        const empties = index === 0 ? emptiesLeading(gap) : emptiesBetween(gap);
        for (let count = 0; count < empties; count += 1) nodes.push(empty());
        let read: PMNode[] = [];
        const value = json[index];
        if (value !== null && value !== undefined) {
            try {
                read = build(schema, value);
            } catch (error) {
                fail(block, error);
            }
        }
        if (read.length === 0) read = [schema.nodes.rawBlock!.create({raw: block.raw})];
        const unit: SourceUnit = {raw: block.raw, size: read.length};
        recordGap(map, previous, unit, {raw: gap, empties});
        previous = unit;
        read.forEach((node, part) => map.origins.set(node, [{unit, part}]));
        nodes.push(...read);
    });
    const trailing = gaps[blocks.length] as string;
    if (blocks.length > 0) {
        const empties = emptiesTrailing(trailing);
        recordGap(map, previous, END, {raw: trailing, empties});
        for (let count = 0; count < empties; count += 1) nodes.push(empty());
    }
    if (nodes.length === 0) nodes.push(empty());
    return {doc: schema.nodes.doc!.create(null, nodes), map, skipped, problems};
}
