/**
 * 内置的语法模块：核心语法与内置方言（docs/specs/workspace/markdown-syntaxes.md 输出 1）。内置方言的声明在
 * `shared/dialects.ts`，这里按同一个 id 给出实现；外来方言由 `../language-registry.ts` 与它们一起组成语言。
 */

import {BUILTIN_DIALECTS} from "../../shared/dialects";
import {createMarkdownLanguage} from "../language";
import type {MarkdownLanguage} from "../language";
import {alignSyntax} from "./align";
import {bilingualSyntax} from "./bilingual";
import {calloutSyntax} from "./callout";
import {commentSyntax} from "./comment";
import {coreSyntax} from "./core";
import {htmlEmbedSyntax} from "./html-embed";
import {rubySyntax} from "./ruby";
import {textMarksSyntax} from "./text-marks";
import type {MarkdownSyntax} from "./types";

/** 内置方言的实现，键是 `BUILTIN_DIALECTS` 里的声明 id。 */
export const BUILTIN_SYNTAXES: Readonly<Record<string, MarkdownSyntax>> = {
    "nbook.markdown.comment": commentSyntax,
    "nbook.markdown.callout": calloutSyntax,
    "nbook.markdown.align": alignSyntax,
    "nbook.markdown.bilingual": bilingualSyntax,
    "nbook.markdown.html-embed": htmlEmbedSyntax,
    "nbook.markdown.ruby": rubySyntax,
    "nbook.markdown.text-marks": textMarksSyntax,
};

export {coreSyntax};

/** 内置方言按声明的 `order` 排好（相同按 id 的码元顺序），核心语法在最后。 */
export function builtinOrder(): ReadonlyArray<{readonly id: string; readonly order: number; readonly syntax: MarkdownSyntax}> {
    return Object.entries(BUILTIN_SYNTAXES)
        .map(([id, syntax]) => ({id, order: (BUILTIN_DIALECTS[id] as {order: number}).order, syntax}))
        .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

let shared: MarkdownLanguage | null = null;

/** 只有内置方言与核心语法的语言（第一次用时建）：没有外来方言时的语言，编解码器的测试也用它。 */
export function markdownLanguage(): MarkdownLanguage {
    shared ??= createMarkdownLanguage([...builtinOrder().map((entry) => entry.syntax), coreSyntax]);
    return shared;
}
