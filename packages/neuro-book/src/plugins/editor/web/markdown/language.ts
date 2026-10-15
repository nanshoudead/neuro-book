/**
 * 一组语法模块组装成的“Markdown 语言”（docs/specs/workspace/markdown-dialect.md）：自己的 `Marked` 实例、读法表与方言名单。
 * 按语法模块的列表建一次，全应用共用；它不碰 schema，按 schema 的部分在 `codec/`。
 *
 * 不用全局的 `marked`：`@tiptap/markdown` 每建一个编辑器就把全部分词规则 `use()` 进全局实例一次，开得越多重复得越多。
 */

import type {AnyExtension} from "@tiptap/core";
import {Marked} from "marked";

import {createRawSyntax} from "./syntax/raw";
import type {MarkdownSyntax, TokenReader} from "./syntax/types";

export interface MarkdownLanguage {
    readonly marked: Marked;
    /** 全部语法模块的扩展，按模块顺序；编辑器与测试都用它建 schema。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 块层与行内的词法单元类型 → 读法（按模块顺序，先试先赢）。 */
    readonly readers: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
    readonly inlineReaders: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
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
    const opens = syntaxes.flatMap((syntax) => (syntax.openTagAtLineEnd === undefined ? [] : [syntax.openTagAtLineEnd]));
    return {
        marked,
        extensions: all.flatMap((syntax) => syntax.extensions),
        readers: table((syntax) => syntax.read),
        inlineReaders: table((syntax) => syntax.readInline),
        blockTags,
        openTagAtLineEnd: opens.length === 0 ? NEVER : new RegExp(`<(?:${opens.join("|")})>[ \\t]*$`, "u"),
    };
}
