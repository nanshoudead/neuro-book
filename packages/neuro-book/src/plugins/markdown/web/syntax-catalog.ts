/**
 * 外来方言的目录（docs/specs/workspace/markdown-syntaxes.md 输出 3–6）：接收 `markdown.syntaxes` 的交付，加载实现，与
 * `markdown.dialects` 的声明配对、核对标签名与撞名，得出此刻生效的外来方言。内置方言不经这里（输出 1）。
 *
 * 这个模块在插件入口里运行，不引任何语法模块、也不碰 DOM：入口的引用链要让后端的类型检查看得懂（`plugin.ts` 的模块头）。
 * 外来方言与内置方言、核心语法的 schema 撞名，要组成语言时才看得出，由 `language-registry.ts` 判、经 `report` 记下。
 */

import {shallowRef} from "vue";
import type {InjectionKey, ShallowRef} from "vue";

import type {MarkdownSyntax} from "@notnotype/nb-markdown/language/types";
import {namesOf} from "@notnotype/nb-markdown";
import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {BUILTIN_DIALECTS, MARKDOWN_DIALECTS_POINT} from "../shared/dialects";
import type {DialectDeclaration} from "../shared/dialects";
import type {MarkdownSyntaxImplementation} from "./contracts";

/** 一种生效的外来方言。 */
export interface ActiveSyntax {
    readonly id: string;
    readonly order: number;
    readonly syntax: MarkdownSyntax;
}

/** 不生效的原因（“失败与恢复”的失败码）。 */
export type InactiveCode = "missing-declaration" | "load-failed" | "tag-mismatch" | "conflict";

export type SyntaxReport = (id: string, code: InactiveCode, message: string, error?: unknown) => void;

export const syntaxCatalogKey: InjectionKey<SyntaxCatalog> = Symbol("nbook.markdown/syntax-catalog");

type Handle = ContributionHandle<Record<string, never>, MarkdownSyntaxImplementation>;

const blockTagsOf = (syntax: MarkdownSyntax): ReadonlyArray<string> => Object.keys(syntax.blockOpens ?? {});
const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => new Set(a).size === new Set(b).size && a.every((item) => b.includes(item));

const BUILTIN_TAGS: ReadonlySet<string> = new Set(Object.values(BUILTIN_DIALECTS).flatMap((declaration) => [...(declaration.blockTags ?? []), ...(declaration.inlineTags ?? [])].map((tag) => `tag:${tag}`)));

export class SyntaxCatalog {
    readonly #declarations: ContributionDeclarations;
    readonly #report: SyntaxReport;
    /** 交付了、`load()` 成功的实现：id → 交付句柄与语法模块。 */
    readonly #loaded = new Map<string, {readonly handle: Handle; readonly syntax: MarkdownSyntax}>();
    /** 每种方言上一次记下的不生效原因：同一原因不重复记诊断。 */
    readonly #reported = new Map<string, InactiveCode>();
    /**
     * 组成语言时才判出不生效的方言（`language-registry.ts`）：目录看来它们仍生效，所以重算不清这张表；方言换一次交付（撤回或重新
     * 加载）才清，同一次交付只记一次诊断。
     */
    readonly #rejected = new Set<string>();
    readonly #active: ShallowRef<ReadonlyArray<ActiveSyntax>> = shallowRef([]);

    constructor(declarations: ContributionDeclarations, report: SyntaxReport) {
        this.#declarations = declarations;
        this.#report = report;
    }

    /** 此刻生效的外来方言，按 `order`、再按 id 的码元顺序。集合变了换成新数组，组成语言按它缓存。 */
    get active(): Readonly<ShallowRef<ReadonlyArray<ActiveSyntax>>> {
        return this.#active;
    }

    receiver(): ContributionReceiver<Record<string, never>, MarkdownSyntaxImplementation> {
        return {
            published: (handle) => {
                void this.#load(handle);
            },
            // 与编辑器、语言的交付同一规则：新一次交付之后旧句柄迟到的撤回不算。
            revoke: (handle) => {
                const loaded = this.#loaded.get(handle.id);
                // 没加载成功的（加载失败、还在加载）也清掉它的记录：重新交付后再失败照常记。
                if (loaded === undefined) {
                    this.#reported.delete(handle.id);
                    this.#rejected.delete(handle.id);
                    return;
                }
                if (loaded.handle !== handle) return;
                this.#loaded.delete(handle.id);
                this.#reported.delete(handle.id);
                this.#rejected.delete(handle.id);
                this.#recompute();
            },
        };
    }

    /** 记一次不生效。同一种方言同一原因只记一次；它生效或撤回之后再不生效照常记。 */
    report(id: string, code: InactiveCode, message: string, error?: unknown): void {
        if (this.#reported.get(id) === code) return;
        this.#reported.set(id, code);
        this.#report(id, code, message, error);
    }

    /** 组成语言时判出的不生效（展开后的名字撞名、组不成语言）：同一次交付只记一次。 */
    reject(id: string, message: string, error?: unknown): void {
        if (this.#rejected.has(id)) return;
        this.#rejected.add(id);
        this.#report(id, "conflict", message, error);
    }

    async #load(handle: Handle): Promise<void> {
        let syntax: MarkdownSyntax;
        try {
            syntax = await handle.implementation().load();
        } catch (error) {
            // 加载期间撤回了：这次失败没有意义，不记。
            if (handle.published) this.report(handle.id, "load-failed", `方言 ${handle.id} 的实现加载失败，按原样保留它的写法`, error);
            return;
        }
        // 加载期间撤回了：迟到的结果丢掉。
        if (!handle.published) return;
        this.#rejected.delete(handle.id);
        this.#loaded.set(handle.id, {handle, syntax});
        this.#recompute();
    }

    #recompute(): void {
        const candidates: Array<ActiveSyntax & {readonly names: ReadonlyArray<string>}> = [];
        for (const [id, {handle, syntax}] of this.#loaded) {
            const declared = this.#declarations.get<DialectDeclaration>(MARKDOWN_DIALECTS_POINT, id);
            // 声明与实现要出自同一个插件：方言 id 只要求以插件 id 开头，插件 id 互为前缀时（`a` 与 `a.b`）只比 id 会跨插件配对。
            if (declared === null || declared.plugin !== handle.plugin) {
                this.report(id, "missing-declaration", `方言实现 ${id} 没有同一插件的同 id 已接受声明，不生效`);
                continue;
            }
            // 块级与行内分开比：声明决定字数怎么认标签，实现决定读写怎么认，两边要认成同一种。
            if (!sameSet(blockTagsOf(syntax), declared.declaration.blockTags ?? []) || !sameSet(syntax.inlineTags ?? [], declared.declaration.inlineTags ?? [])) {
                this.report(id, "tag-mismatch", `方言 ${id} 的实现交出的标签名与声明不同，不生效`);
                continue;
            }
            candidates.push({id, order: declared.declaration.order, syntax, names: namesOf(syntax)});
        }
        // 撞名：与内置方言的标签同名的只拒外来的；外来方言之间同名的全部拒绝，与交付先后无关（输出 4）。
        const owners = new Map<string, Set<string>>();
        for (const candidate of candidates) for (const name of candidate.names) owners.set(name, (owners.get(name) ?? new Set()).add(candidate.id));
        const conflicting = new Set<string>();
        for (const candidate of candidates) {
            if (candidate.names.some((name) => BUILTIN_TAGS.has(name) || (owners.get(name)?.size ?? 0) > 1)) conflicting.add(candidate.id);
        }
        for (const id of conflicting) this.report(id, "conflict", `方言 ${id} 与别的方言撞名，不生效`);
        const active = candidates
            .filter((candidate) => !conflicting.has(candidate.id))
            .map(({id, order, syntax}) => ({id, order, syntax}))
            .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        // 生效的那些清掉旧的不生效记录：之后再不生效时照常记。
        for (const {id} of active) this.#reported.delete(id);
        // 集合没变时不换数组：组成语言按数组缓存，换了就要重新组成一份一样的语言。
        const current = this.#active.value;
        if (current.length === active.length && current.every((entry, index) => entry.id === active[index]?.id && entry.syntax === active[index]?.syntax)) return;
        this.#active.value = active;
    }
}
