/**
 * 组成语言（docs/specs/workspace/markdown-syntaxes.md 输出 1、3–7）：内置方言、此刻生效的外来方言与核心语法按顺序组成一份
 * 语言。只由用 Markdown 的组件引用：它带着全部内置语法模块（有的用 DOM），不能进插件入口的引用链。
 *
 * 同一组生效的外来方言只组成一次（按 `SyntaxCatalog.active` 的数组缓存），所以同一时刻建立的视图拿到同一份语言；视图在建立时
 * 取定它，之后方言集合变了也不换（输出 7）。
 */

import {createMarkdownLanguage} from "./language";
import type {MarkdownLanguage} from "./language";
import {namesOf} from "./syntax-catalog";
import type {ActiveSyntax, SyntaxCatalog} from "./syntax-catalog";
import {builtinOrder, coreSyntax, markdownLanguage} from "./syntax";

const composed = new WeakMap<ReadonlyArray<ActiveSyntax>, MarkdownLanguage>();

export function languageFor(catalog: SyntaxCatalog): MarkdownLanguage {
    const active = catalog.active.value;
    if (active.length === 0) return markdownLanguage();
    const cached = composed.get(active);
    if (cached !== undefined) return cached;
    const builtins = builtinOrder();
    // 与内置方言、核心语法撞名的外来方言不生效，只拒外来的（输出 4）；外来方言之间的撞名目录已经判过。
    const taken = new Set([...builtins.map((entry) => entry.syntax), coreSyntax].flatMap(namesOf));
    const accepted = active.filter((entry) => {
        if (!namesOf(entry.syntax).some((name) => taken.has(name))) return true;
        catalog.report(entry.id, "conflict", `方言 ${entry.id} 与内置的语法撞名，不生效`);
        return false;
    });
    const ordered = [...builtins, ...accepted].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const language = createMarkdownLanguage([...ordered.map((entry) => entry.syntax), coreSyntax]);
    composed.set(active, language);
    return language;
}
