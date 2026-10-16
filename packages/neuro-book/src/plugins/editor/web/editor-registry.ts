/**
 * 编辑器的交付（docs/specs/workbench/editor.md 输出 40）：贡献点 `editor.editors` 交来的实现，按编辑器 id 给出组件此刻的
 * 状态。内置的 Markdown 与源码编辑器也声明在这个贡献点上，但组件由编辑器区直接持有（`builtins`）：编辑器区在激活时就
 * 建好、开始恢复会话，早于它自己的交付。
 */

import {defineAsyncComponent, shallowRef} from "vue";
import type {Component} from "vue";

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {EDITOR_EDITORS_POINT} from "../shared/contracts";
import type {EditorDeclaration, EditorImplementation} from "../shared/contracts";
import type {EditorCatalog} from "./editors";

export type EditorState = {readonly kind: "gone"} | {readonly kind: "pending"} | {readonly kind: "ready"; readonly component: Component};

/** 编辑器的声明（目录）与交付的实现。组件的三种状态（不在、未交付、已交付）由 `state` 给出。 */
export class EditorRegistry {
    readonly #declarations: ContributionDeclarations;
    readonly #builtins: Readonly<Record<string, Component>>;
    readonly #published = shallowRef<ReadonlyMap<string, ContributionHandle<EditorDeclaration, EditorImplementation>>>(new Map());
    /** 交付过又撤回、还没再交付的编辑器：贡献方停止了，声明还在清单里，但它不会自己回来。 */
    readonly #stopped = shallowRef<ReadonlySet<string>>(new Set());
    /** 每个交付句柄一个异步组件：同一次交付反复渲染不重新加载，换了句柄（重新激活）才重新加载。 */
    readonly #components = new WeakMap<ContributionHandle<EditorDeclaration, EditorImplementation>, Component>();

    constructor(declarations: ContributionDeclarations, builtins: Readonly<Record<string, Component>>) {
        this.#declarations = declarations;
        this.#builtins = builtins;
    }

    /** 已接受的声明；声明在清单里，插件装配后不变。 */
    readonly catalog: EditorCatalog = {
        declaration: (id) => this.#declarations.get<EditorDeclaration>(EDITOR_EDITORS_POINT, id)?.declaration ?? null,
        list: () => this.#declarations.list<EditorDeclaration>(EDITOR_EDITORS_POINT).map((descriptor) => ({id: descriptor.id, declaration: descriptor.declaration})),
    };

    receiver(): ContributionReceiver<EditorDeclaration, EditorImplementation> {
        return {
            published: (handle) => {
                this.#published.value = new Map(this.#published.value).set(handle.id, handle);
                if (this.#stopped.value.has(handle.id)) this.#stopped.value = new Set([...this.#stopped.value].filter((id) => id !== handle.id));
            },
            // 撤回不要求发布过：贡献方暂存之后激活失败也会撤回，它同样不会自己回来（“不在了”）。已经换成新一次交付的，
            // 旧句柄迟到的撤回不算。
            revoke: (handle) => {
                const current = this.#published.value.get(handle.id);
                if (current !== undefined && current !== handle) return;
                if (current !== undefined) {
                    const next = new Map(this.#published.value);
                    next.delete(handle.id);
                    this.#published.value = next;
                }
                this.#stopped.value = new Set(this.#stopped.value).add(handle.id);
            },
        };
    }

    /** 编辑器此刻的组件。响应式：在 computed 与渲染里读。 */
    state(id: string): EditorState {
        const builtin = this.#builtins[id];
        if (builtin !== undefined) return {kind: "ready", component: builtin};
        if (this.catalog.declaration(id) === null) return {kind: "gone"};
        const handle = this.#published.value.get(id);
        if (handle === undefined) return this.#stopped.value.has(id) ? {kind: "gone"} : {kind: "pending"};
        let component = this.#components.get(handle);
        if (component === undefined) {
            component = defineAsyncComponent(() => handle.implementation().load());
            this.#components.set(handle, component);
        }
        return {kind: "ready", component};
    }
}
