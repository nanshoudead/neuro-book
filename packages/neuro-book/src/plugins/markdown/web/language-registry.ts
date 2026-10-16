/**
 * 组成语言（docs/specs/workspace/markdown-syntaxes.md 输出 1、3–7）：内置方言、此刻生效的外来方言与核心语法按顺序组成一份
 * 语言。只由用 Markdown 的组件引用：它带着全部内置语法模块（有的用 DOM），不能进插件入口的引用链。
 *
 * 同一组生效的外来方言只组成一次（按 `SyntaxCatalog.active` 的数组缓存），所以同一时刻建立的视图拿到同一份语言；视图在建立时
 * 取定它，之后方言集合变了也不换（输出 7）。
 */

import {flattenExtensions} from "@tiptap/core";

import {createMarkdownLanguage} from "./language";
import type {MarkdownLanguage} from "./language";
import {namesOf} from "./syntax-catalog";
import type {ActiveSyntax, SyntaxCatalog} from "./syntax-catalog";
import {builtinOrder, coreSyntax, markdownLanguage} from "./syntax";
import {createRawSyntax} from "./syntax/raw";
import type {MarkdownSyntax} from "./syntax/types";

const composed = new WeakMap<ReadonlyArray<ActiveSyntax>, MarkdownLanguage>();

/**
 * 一种语法占用的全部名字：目录判的那些（标签、顶层扩展、写法），加上组合扩展展开后的子扩展（`StarterKit` 里的 `bold`）。
 * 展开要用 Tiptap 的扩展机制，所以在这里判，不在不碰编辑内核的目录里判。
 */
const fullNamesOf = (syntax: MarkdownSyntax): ReadonlyArray<string> => [...new Set([...namesOf(syntax), ...flattenExtensions([...syntax.extensions]).map((extension) => `type:${extension.name}`)])];

/** 内置方言、核心语法与组装时追加的原样语法占用的名字；原样语法的名字与它认哪些标签无关。 */
let reserved: ReadonlySet<string> | null = null;
const reservedNames = (): ReadonlySet<string> => {
    reserved ??= new Set([...builtinOrder().map((entry) => entry.syntax), coreSyntax, createRawSyntax({blockTags: [], inlineTags: []})].flatMap(fullNamesOf));
    return reserved;
};

export function languageFor(catalog: SyntaxCatalog): MarkdownLanguage {
    const active = catalog.active.value;
    if (active.length === 0) return markdownLanguage();
    const cached = composed.get(active);
    if (cached !== undefined) return cached;
    const language = compose(catalog, active);
    composed.set(active, language);
    return language;
}

/**
 * 与内置、核心或原样语法撞名的外来方言不生效，只拒外来的；外来方言之间按展开后的名字撞名的两边都不生效（输出 4）。目录已按
 * 顶层名字判过外来方言之间的撞名，这里补上展开后才看得出的。
 */
function compose(catalog: SyntaxCatalog, active: ReadonlyArray<ActiveSyntax>): MarkdownLanguage {
    const taken = reservedNames();
    const names = new Map(active.map((entry) => [entry.id, fullNamesOf(entry.syntax)]));
    const owners = new Map<string, string[]>();
    for (const [id, list] of names) for (const name of list) owners.set(name, [...(owners.get(name) ?? []), id]);
    const accepted = active.filter((entry) => {
        const list = names.get(entry.id) ?? [];
        if (list.some((name) => taken.has(name))) {
            catalog.reject(entry.id, `方言 ${entry.id} 与内置的语法撞名，不生效`);
            return false;
        }
        const clash = list.find((name) => (owners.get(name)?.length ?? 0) > 1);
        if (clash === undefined) return true;
        catalog.reject(entry.id, `方言 ${entry.id} 与 ${(owners.get(clash) ?? []).filter((id) => id !== entry.id).join("、")} 撞名（${clash}），不生效`);
        return false;
    });
    const builtins = builtinOrder();
    const ordered = [...builtins, ...accepted].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    try {
        return createMarkdownLanguage([...ordered.map((entry) => entry.syntax), coreSyntax]);
    } catch (error) {
        // 上面的名字判断之外仍组不成（外来方言的读写规则互相矛盾）：外来方言全部不生效，视图照常用内置的语言建立。
        for (const entry of accepted) catalog.reject(entry.id, `方言 ${entry.id} 与别的语法组不成一份语言，不生效`, error);
        return markdownLanguage();
    }
}
