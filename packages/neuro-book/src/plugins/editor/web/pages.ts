/**
 * 编辑区的页面（docs/specs/workbench/editor.md 输出 33）：贡献点 `editor.pages` 交来的不对应文件的标签。注册表记下交付的
 * 句柄，按 id 给出标题与组件；组件每次经句柄取实现，贡献撤回后内核拒绝，不再用旧实现。页面标签的地址是 `page://<id>`，
 * 不是资源地址：不读文档、不进会话记录。
 */

import {defineAsyncComponent, defineComponent, h, shallowRef} from "vue";
import type {Component} from "vue";

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {EDITOR_PAGES_POINT} from "../shared/contracts";
import type {EditorPageDeclaration} from "../shared/contracts";

const PAGE_SCHEME = "page://";

/** 页面组件加载期间的占位：空的，只标 aria-busy。 */
const PAGE_LOADING = defineComponent({
    name: "EditorPageLoading",
    setup: () => () => h("div", {"aria-busy": "true", "data-editor-page-loading": ""}),
});

export const pageAddress = (id: string): string => `${PAGE_SCHEME}${id}`;

/** 页面标签的页面 id；文件标签为 null。 */
export const pageIdOf = (address: string): string | null => (address.startsWith(PAGE_SCHEME) ? address.slice(PAGE_SCHEME.length) : null);

/** 页面组件收到的 `context` 属性。 */
export interface EditorPageContext {
    /** 这部作品在本窗口最近打开的地址，最近在前（输出 31）；没有绑定项目时为空。 */
    readonly recent: ReadonlyArray<string>;
}

export interface EditorPageImplementation {
    /** 只取得组件定义；实例由编辑区创建，组件收到 `{context: EditorPageContext}`。 */
    load(): Promise<Component>;
}

/** 编辑组渲染页面标签要的东西。 */
export interface EditorPageSource {
    /** 页面标题；声明已不在（贡献方停了）时为 null。 */
    title(id: string, locale: DisplayLocale): string | null;
    /** 页面组件；还没交付实现时为 null。 */
    component(id: string): Component | null;
    readonly context: EditorPageContext;
}

export class EditorPageRegistry {
    readonly #declarations: ContributionDeclarations;
    readonly #published = shallowRef<ReadonlyMap<string, ContributionHandle<EditorPageDeclaration, EditorPageImplementation>>>(new Map());
    /** 每个交付句柄一个异步组件：同一次交付反复渲染不重新加载，换了句柄（重新激活）才重新加载。 */
    readonly #components = new WeakMap<ContributionHandle<EditorPageDeclaration, EditorPageImplementation>, Component>();

    constructor(declarations: ContributionDeclarations) {
        this.#declarations = declarations;
    }

    receiver(): ContributionReceiver<EditorPageDeclaration, EditorPageImplementation> {
        return {
            published: (handle) => {
                this.#published.value = new Map(this.#published.value).set(handle.id, handle);
            },
            revoke: (handle) => {
                if (this.#published.value.get(handle.id) !== handle) return;
                const next = new Map(this.#published.value);
                next.delete(handle.id);
                this.#published.value = next;
            },
        };
    }

    declaration(id: string): EditorPageDeclaration | null {
        return this.#declarations.get<EditorPageDeclaration>(EDITOR_PAGES_POINT, id)?.declaration ?? null;
    }

    /** 交付了实现、可以打开的页面。响应式：在 computed 与 watch 里读。 */
    available(id: string): boolean {
        return this.#published.value.has(id);
    }

    /** 交付了实现、声明要在作品第一次打开时自动打开的页面，按 id。 */
    firstVisitPages(): string[] {
        return [...this.#published.value.values()].filter((handle) => handle.declaration.openOnFirstVisit === true).map((handle) => handle.id).sort();
    }

    source(context: EditorPageContext): EditorPageSource {
        return {
            title: (id, locale) => {
                const declaration = this.declaration(id);
                return declaration === null ? null : localize(declaration.title, locale);
            },
            component: (id) => {
                const handle = this.#published.value.get(id);
                if (handle === undefined) return null;
                let component = this.#components.get(handle);
                if (component === undefined) {
                    // 加载期间放一个标了 aria-busy 的空占位（立即显示，不等缺省的 200 毫秒）：标签内容还没出来，读屏与截图工具
                    // （page:shot）据此知道这里还在加载。
                    component = defineAsyncComponent({loader: () => handle.implementation().load(), loadingComponent: PAGE_LOADING, delay: 0});
                    this.#components.set(handle, component);
                }
                return component;
            },
            context,
        };
    }
}
