/**
 * 语法模块的形状（docs/specs/workspace/markdown-dialect.md）：每种语法一个模块，读、写与它要登记的名单只写在这个模块里。
 * 编解码器（`../codec/`）只认识这里的接口，不认识具体语法。
 */

import type {AnyExtension, JSONContent} from "@tiptap/core";
import type {MarkedExtension, Token, Tokens} from "marked";

/** 读入时交给读法的上下文。 */
export interface ReadContext {
    /** 行内单元 → 行内节点（文字、标记、行内节点）。 */
    inline(tokens: ReadonlyArray<Token>): JSONContent[];
    /** 容器里的块单元 → 块节点。容器里的空行不产出空段落（方言 Spec 的“块”定义）。 */
    blocks(tokens: ReadonlyArray<Token>): JSONContent[];
    /** 给一组行内节点加一个标记（文字与行内节点都加，已有的同名同属性标记不重复）。 */
    mark(type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent[];
    /**
     * 一个原样节点（块或行内），内容是这个单元在原文里的字节：调度器经偏移表从原文切出，所以 CRLF 等不会因为父块重新写出而变。
     * 单元必须属于正在读的这一块，并且按出现的先后调用（调度器沿原文向后查找它）。
     */
    raw(token: Token, inline: boolean): JSONContent;
}

/** 一种词法单元的读法：返回 null 表示不认领，交给下一个读法。 */
export type TokenReader = (token: Token, context: ReadContext) => JSONContent[] | null;

/** 一种语法。 */
export interface MarkdownSyntax {
    readonly name: string;
    /** schema、命令、键位与节点视图（Tiptap 扩展）。扩展自带的 `markdownTokenizer` 不会被登记，分词规则只来自 `marked`。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 块层的词法单元类型 → 读法。同一类型有多个模块认领时，先列出的模块先试。 */
    readonly read?: Readonly<Record<string, TokenReader>>;
    /** 行内的词法单元类型 → 读法（`text`、`html` 这类类型名在块层与行内都会出现，所以分两张表）。 */
    readonly readInline?: Readonly<Record<string, TokenReader>>;
    /** 登记进编解码器自己的 `Marked` 实例的扩展（分词规则、对内置分词的覆盖）。 */
    readonly marked?: ReadonlyArray<MarkedExtension>;
    /** 块级方言标签名：宽容写法的规范化与 HTML 兜底的排除名单都从这里取。 */
    readonly blockTags?: ReadonlyArray<string>;
    /** “行尾的块级方言开标签”的一段正则源码（不含首尾），属性形态必须与这个模块的块分词规则一致。 */
    readonly openTagAtLineEnd?: string;
    /** 行内方言标签名（HTML 兜底不抢的名单）。 */
    readonly inlineTags?: ReadonlyArray<string>;
}

export type {Token, Tokens};
