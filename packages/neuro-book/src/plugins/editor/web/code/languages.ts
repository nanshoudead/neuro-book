/**
 * 语言（docs/specs/workbench/editor.md 输出 43–45）：贡献点 `editor.languages` 的声明与交付，以及把它们登记进 Monaco。
 *
 * 登记的做法与 Monaco 自己的 `registerLanguage`（`basic-languages/_.contribution.js`）相同：声明（id、别名、扩展名、
 * 文件名、首行、mimetypes）一次登记全部，分词规则经 `registerTokensProviderFactory` 在第一次遇到这门语言时才加载，编辑规则
 * 在 `onLanguageEncountered` 时设上。HTML 的 `<script>`、Markdown 的代码块按名字或 mimetype 找嵌入的语言，要求被嵌入的
 * 语言事先登记过声明，所以不能等打开那种文件时才登记。
 */

import type {InjectionKey} from "vue";

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {DisplayText} from "nbook/shared/localized-text";

import {EDITOR_LANGUAGES_POINT, SOURCE_EDITOR_LANGUAGE_IDS} from "../../shared/contracts";
import type {LanguageDeclaration, LanguageDefinition, LanguageImplementation} from "../../shared/contracts";
import {editorText} from "../../shared/text";

/** 与 `load-monaco.ts` 的同名类型相同；不从那里引：它带着浏览器全局与 worker 模块，后端的类型检查看不懂。 */
type MonacoApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

/** 生成的 Monaco 自带语言表的一行（`monaco-languages.ts`）。 */
export interface MonacoLanguageEntry {
    readonly id: string;
    readonly declaration: LanguageDeclaration;
    load(): Promise<{readonly language: LanguageDefinition["language"]; readonly conf: LanguageDefinition["configuration"]}>;
}

/** Monaco 自带语言的实现：模块里的 `language` 与 `conf` 换成合同的形状。 */
export function monacoLanguageImplementation(entry: MonacoLanguageEntry): LanguageImplementation {
    return {
        load: async () => {
            const module = await entry.load();
            return {format: "monarch", language: module.language, configuration: module.conf};
        },
    };
}

/** 源码编辑器自带、不经贡献点的语言（`SOURCE_EDITOR_LANGUAGE_IDS`）显示的名字。 */
const SOURCE_EDITOR_LANGUAGE_NAMES: ReadonlyMap<string, DisplayText> = new Map<string, DisplayText>([
    ["plaintext", editorText("languages.plaintext")],
    ["json", "JSON"],
]);

/** 编辑器区把语言交给源码编辑器控件：控件合同里没有这一项，只有内置的源码编辑器用。 */
export const editorLanguagesKey: InjectionKey<LanguageRegistry> = Symbol("nbook.editor.languages");

type LanguageHandle = ContributionHandle<LanguageDeclaration, LanguageImplementation>;

export class LanguageRegistry {
    readonly #declarations: ContributionDeclarations;
    readonly #report: (error: unknown, language: string) => void;
    readonly #published = new Map<string, LanguageHandle>();
    /** 交付过又撤回的语言：之后来要规则的给 null，不等它回来。 */
    readonly #stopped = new Set<string>();
    /** 规则还没交付时来要的：交付或撤回时 settle。 */
    readonly #waiting = new Map<string, Array<(handle: LanguageHandle | null) => void>>();
    /** 每个交付句柄一份加载：同一门语言的分词规则与编辑规则共用一次 `load()`。 */
    readonly #loads = new WeakMap<LanguageHandle, Promise<LanguageDefinition | null>>();
    /** 已经登记进 Monaco 的语言 id。Monaco 在页面里只有一份，登记不能撤回。 */
    readonly #installed = new Set<string>();

    constructor(declarations: ContributionDeclarations, report: (error: unknown, language: string) => void) {
        this.#declarations = declarations;
        this.#report = report;
    }

    receiver(): ContributionReceiver<LanguageDeclaration, LanguageImplementation> {
        return {
            published: (handle) => {
                this.#published.set(handle.id, handle);
                this.#stopped.delete(handle.id);
                this.#settle(handle.id, handle);
            },
            // 与编辑器的交付同一规则（`editor-registry.ts`）：撤回不要求发布过，新一次交付之后旧句柄迟到的撤回不算。
            revoke: (handle) => {
                const current = this.#published.get(handle.id);
                if (current !== undefined && current !== handle) return;
                this.#published.delete(handle.id);
                this.#stopped.add(handle.id);
                this.#settle(handle.id, null);
            },
        };
    }

    /** 这门语言已登记（源码编辑器自带，或贡献的声明已被接受）。 */
    has(id: string): boolean {
        return SOURCE_EDITOR_LANGUAGE_IDS.includes(id) || this.#declarations.get(EDITOR_LANGUAGES_POINT, id) !== null;
    }

    /** 显示的名字：声明的第一个别名；没登记的显示 id 本身。 */
    name(id: string): DisplayText {
        return SOURCE_EDITOR_LANGUAGE_NAMES.get(id) ?? this.#declarations.get<LanguageDeclaration>(EDITOR_LANGUAGES_POINT, id)?.declaration.aliases[0] ?? id;
    }

    /** 全部已登记的语言 id。 */
    list(): ReadonlyArray<string> {
        return [...SOURCE_EDITOR_LANGUAGE_IDS, ...this.#declarations.list(EDITOR_LANGUAGES_POINT).map((descriptor) => descriptor.id)];
    }

    /** 把还没登记进 Monaco 的已接受声明登记进去；建模型之前调用，Monaco 按文件名识别语言时才看得到它们。 */
    install(monaco: MonacoApi): void {
        for (const {id, declaration} of this.#declarations.list<LanguageDeclaration>(EDITOR_LANGUAGES_POINT)) {
            if (this.#installed.has(id)) continue;
            this.#installed.add(id);
            monaco.languages.register({
                id,
                aliases: [...declaration.aliases],
                ...(declaration.extensions === undefined ? {} : {extensions: declaration.extensions.map((extension) => `.${extension}`)}),
                ...(declaration.filenames === undefined ? {} : {filenames: [...declaration.filenames]}),
                ...(declaration.firstLine === undefined ? {} : {firstLine: declaration.firstLine}),
                ...(declaration.mimetypes === undefined ? {} : {mimetypes: [...declaration.mimetypes]}),
            });
            monaco.languages.registerTokensProviderFactory(id, {create: async () => (await this.#load(id))?.language ?? null});
            monaco.languages.onLanguageEncountered(id, () => {
                void this.#load(id).then((definition) => {
                    if (definition !== null) monaco.languages.setLanguageConfiguration(id, definition.configuration);
                });
            });
        }
    }

    #settle(id: string, handle: LanguageHandle | null): void {
        const waiting = this.#waiting.get(id);
        this.#waiting.delete(id);
        for (const resolve of waiting ?? []) resolve(handle);
    }

    /** 这门语言的规则：还没交付的等交付；撤回了的、加载失败的为 null（失败记诊断，这门语言按纯文本显示）。 */
    async #load(id: string): Promise<LanguageDefinition | null> {
        let handle = this.#published.get(id) ?? null;
        if (handle === null && !this.#stopped.has(id)) {
            handle = await new Promise<LanguageHandle | null>((resolve) => {
                this.#waiting.set(id, [...(this.#waiting.get(id) ?? []), resolve]);
            });
        }
        if (handle === null) return null;
        let loading = this.#loads.get(handle);
        if (loading === undefined) {
            const current = handle;
            loading = current.implementation().load().then((definition) => {
                if (definition.format !== "monarch") throw new Error(`Unsupported language format: ${String(definition.format)}`);
                return definition;
            }).catch((error: unknown) => {
                this.#report(error, current.id);
                return null;
            });
            this.#loads.set(handle, loading);
        }
        return loading;
    }
}
