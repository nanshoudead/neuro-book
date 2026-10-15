/**
 * 一组语法模块组装成的“Markdown 语言”（docs/specs/workspace/markdown-dialect.md）：自己的 `Marked` 实例、读法表与方言名单。
 * 按语法模块的列表建一次，全应用共用；它不碰 schema，按 schema 的部分在 `codec/`。
 *
 * 不用全局的 `marked`：`@tiptap/markdown` 每建一个编辑器就把全部分词规则 `use()` 进全局实例一次，开得越多重复得越多。
 */

import type {AnyExtension} from "@tiptap/core";
import {Marked} from "marked";

import {createRawSyntax} from "./syntax/raw";
import type {BlockWriter, InlineWriter, MarkdownSyntax, MarkWriter, ReadResolver, TokenReader} from "./syntax/types";

export interface MarkdownLanguage {
    readonly marked: Marked;
    /** 全部语法模块的扩展，按模块顺序；编辑器与测试都用它建 schema。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 块层与行内的词法单元类型 → 读法（按模块顺序，先试先赢）。 */
    readonly readers: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
    readonly inlineReaders: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
    /** 节点与标记类型 → 写法（每种类型只能有一个模块给写法）。 */
    readonly blockWriters: ReadonlyMap<string, BlockWriter>;
    readonly inlineWriters: ReadonlyMap<string, InlineWriter>;
    readonly markWriters: ReadonlyMap<string, MarkWriter>;
    /** 读入时推导出来的属性（读回校验不比较）。 */
    readonly derivedAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 由跨块上下文决定的属性（读回校验不比较）。 */
    readonly contextAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 读回校验不比较的属性：上面两张表的并集（节点或标记类型 → 属性名）。 */
    readonly uncomparedAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 整篇读完之后的处理，按模块顺序。 */
    readonly resolvers: ReadonlyArray<ReadResolver>;
    /** 写前准备：模块名 → 准备函数。 */
    readonly prepareWrite: ReadonlyMap<string, NonNullable<MarkdownSyntax["prepareWrite"]>>;
    /** 没被编辑的块因上下文变了要重新写出的判断：模块名 → 判断。 */
    readonly contextDependents: ReadonlyMap<string, NonNullable<MarkdownSyntax["contextDependents"]>>;
    /** 身上的标记不写出、不比较的行内节点类型。 */
    readonly marklessInline: ReadonlySet<string>;
    /** 只盖文字的标记类型（`MarkWriter.textOnly`）。 */
    readonly textOnlyMarks: ReadonlySet<string>;
    /** 块级方言标签名与“行尾开标签”的正则（宽容写法用）。 */
    readonly blockTags: ReadonlyArray<string>;
    readonly openTagAtLineEnd: RegExp;
}

/** 永远匹配不到的正则：没有块级方言时用。 */
const NEVER = /$^/u;

/**
 * 组装。原样语法（`syntax/raw`）由这里追加在最后：它要知道全部方言标签，才不会抢走它们。
 *
 * `marked` 的扩展分词规则后登记的先试，所以原样语法的分词规则最先登记（最后试），各语法按列表倒序登记（列表里靠前的先试）。
 */
export function createMarkdownLanguage(syntaxes: ReadonlyArray<MarkdownSyntax>): MarkdownLanguage {
    const blockTags = syntaxes.flatMap((syntax) => syntax.blockTags ?? []);
    const inlineTags = syntaxes.flatMap((syntax) => syntax.inlineTags ?? []);
    const raw = createRawSyntax({blockTags, inlineTags});
    const all = [...syntaxes, raw];
    const marked = new Marked({gfm: true});
    for (const syntax of [...all].reverse()) for (const extension of syntax.marked ?? []) marked.use(extension);
    const table = (pick: (syntax: MarkdownSyntax) => Readonly<Record<string, TokenReader>> | undefined): Map<string, TokenReader[]> => {
        const readers = new Map<string, TokenReader[]>();
        for (const syntax of all) {
            for (const [type, reader] of Object.entries(pick(syntax) ?? {})) readers.set(type, [...(readers.get(type) ?? []), reader]);
        }
        return readers;
    };
    const writers = <W>(pick: (syntax: MarkdownSyntax) => Readonly<Record<string, W>> | undefined): Map<string, W> => {
        const map = new Map<string, W>();
        for (const syntax of all) {
            for (const [type, writer] of Object.entries(pick(syntax) ?? {})) {
                if (map.has(type)) throw new Error(`${type} 的写法登记了两次（${syntax.name}）`);
                map.set(type, writer);
            }
        }
        return map;
    };
    const opens = syntaxes.flatMap((syntax) => (syntax.openTagAtLineEnd === undefined ? [] : [syntax.openTagAtLineEnd]));
    const attrTable = (pick: (syntax: MarkdownSyntax) => Readonly<Record<string, ReadonlyArray<string>>> | undefined): Map<string, Set<string>> => {
        const map = new Map<string, Set<string>>();
        for (const syntax of all) for (const [type, names] of Object.entries(pick(syntax) ?? {})) map.set(type, new Set([...(map.get(type) ?? []), ...names]));
        return map;
    };
    const derivedAttrs = attrTable((syntax) => syntax.derivedAttrs);
    const contextAttrs = attrTable((syntax) => syntax.contextAttrs);
    const uncomparedAttrs = new Map(derivedAttrs);
    for (const [type, names] of contextAttrs) uncomparedAttrs.set(type, new Set([...(uncomparedAttrs.get(type) ?? []), ...names]));
    const byName = <T>(pick: (syntax: MarkdownSyntax) => T | undefined): Map<string, T> =>
        new Map(all.flatMap((syntax) => {
            const value = pick(syntax);
            return value === undefined ? [] : [[syntax.name, value] as [string, T]];
        }));
    return {
        marked,
        extensions: all.flatMap((syntax) => syntax.extensions),
        readers: table((syntax) => syntax.read),
        inlineReaders: table((syntax) => syntax.readInline),
        blockWriters: writers((syntax) => syntax.writeBlock),
        inlineWriters: writers((syntax) => syntax.writeInline),
        markWriters: writers((syntax) => syntax.writeMark),
        marklessInline: new Set(all.flatMap((syntax) => syntax.marklessInline ?? [])),
        textOnlyMarks: new Set(all.flatMap((syntax) => Object.entries(syntax.writeMark ?? {}).filter(([, writer]) => writer.textOnly === true).map(([type]) => type))),
        derivedAttrs,
        contextAttrs,
        uncomparedAttrs,
        resolvers: all.flatMap((syntax) => (syntax.resolve === undefined ? [] : [syntax.resolve])),
        prepareWrite: byName((syntax) => syntax.prepareWrite),
        contextDependents: byName((syntax) => syntax.contextDependents),
        blockTags,
        openTagAtLineEnd: opens.length === 0 ? NEVER : new RegExp(`<(?:${opens.join("|")})>[ \\t]*$`, "u"),
    };
}
