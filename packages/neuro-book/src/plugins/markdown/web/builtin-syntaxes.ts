/**
 * 内置方言的实现（docs/specs/workspace/markdown-syntaxes.md 输出 1）：声明在 `../shared/dialects.ts`（id 是
 * `nbook.markdown.<名字>`，浏览器与项目两个位置都登记），实现是 nb-markdown 的内置语法模块。两边的名字与 `order` 由
 * `word-count.test.ts` 逐项核对。
 */

import {builtinSyntaxes} from "@notnotype/nb-markdown/language";
import type {MarkdownSyntax} from "@notnotype/nb-markdown/language";

export interface BuiltinEntry {
    readonly id: string;
    readonly order: number;
    readonly syntax: MarkdownSyntax;
}

/** 内置方言，按 `order` 排好，带声明 id（外来方言按 id 与它们排先后）。 */
export const builtinOrder = (): ReadonlyArray<BuiltinEntry> => builtinSyntaxes().map((entry) => ({id: `nbook.markdown.${entry.name}`, order: entry.order, syntax: entry.syntax}));
