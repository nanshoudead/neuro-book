/**
 * 一个视图的贡献与实现，视图 id 只写一次（docs/specs/workbench/views.md）。给插件作者用，经 SDK 的
 * `@notnotype/nb-plugin-sdk/browser` 导出，与设置页的 `settingsPageContribution` 对称。
 *
 * 视图组件只收到 `context`（`ViewContext`）；入口激活时拿到的服务、远程句柄经 `implementation(props)` 交给组件。不用它时作者
 * 要自己写一个 `defineComponent` 包装，还要记得把 `import()` 得到的模块对象解开成组件。
 */

import type {Component} from "vue";

import {boundComponent} from "nbook/ui/bound-component";

import {WORKBENCH_VIEWS_POINT} from "../shared/views";
import type {ViewDeclaration} from "../shared/views";
import type {ViewImplementation} from "./contracts";

export interface ViewContribution<Id extends string> {
    readonly id: Id;
    /** 写进入口的 `contributions`。 */
    readonly contribution: {readonly capability: typeof WORKBENCH_VIEWS_POINT; readonly id: Id; readonly declaration: ViewDeclaration};
    /** 激活时交出的实现，放在 `contributions[WORKBENCH_VIEWS_POINT][id]`；`props` 在渲染时求值、作为视图组件的属性，读响应式的值时视图随之更新。 */
    implementation(props?: () => Readonly<Record<string, unknown>>): ViewImplementation;
}

export function viewContribution<const Id extends string>(options: {
    readonly id: Id;
    readonly declaration: ViewDeclaration;
    readonly load: () => Promise<Component | {readonly default: Component}>;
}): ViewContribution<Id> {
    return {
        id: options.id,
        contribution: {capability: WORKBENCH_VIEWS_POINT, id: options.id, declaration: options.declaration},
        implementation: (props) => boundComponent("PluginView", options.load, props),
    };
}
