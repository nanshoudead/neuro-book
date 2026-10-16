/**
 * `nbook.markdown` 浏览器入口（docs/specs/workspace/markdown-syntaxes.md）：拥有方言的两个贡献点，接收外来方言的实现，提供服务
 * `markdownKey` 交出用 Markdown 的组件。
 *
 * 组件按需加载：语法模块、Markdown 解析器与编辑内核只从这些 `.vue` 组件引用，入口本身不引它们，所以首屏不含它们；后端的
 * 类型检查装配浏览器插件时也不展开它们（`src/types/vue-sfc.d.ts`）。方言目录与图片地址服务经组件的包装交给 Markdown 控件
 * （`syntaxCatalogKey`、`markdownAssetsKey`）。
 */

import {defineAsyncComponent, defineComponent, h, provide as provideToChildren} from "vue";
import type {Component} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {filesKey} from "nbook/plugins/files/shared/contracts";

import {descriptor} from "../plugin";
import {markdownKey, MARKDOWN_SYNTAXES_POINT, validateSyntaxContribution} from "../shared/contracts";
import type {MarkdownService} from "../shared/contracts";
import {dialectsPoint} from "../shared/plugin";
import {createAssetUrls, markdownAssetsKey} from "./parts/asset-urls";
import type {AssetUrls} from "./parts/asset-urls";
import {SyntaxCatalog, syntaxCatalogKey} from "./syntax-catalog";

/** 包一层：给组件交方言目录与图片地址服务；属性、事件与插槽原样转给它。 */
function withHost(catalog: SyntaxCatalog, assets: AssetUrls, name: string, load: () => Promise<Component>): Component {
    const inner = defineAsyncComponent(load);
    return defineComponent({
        name,
        inheritAttrs: false,
        setup: (_props, {attrs, slots}) => {
            provideToChildren(syntaxCatalogKey, catalog);
            provideToChildren(markdownAssetsKey, assets);
            return () => h(inner, attrs, slots);
        },
    });
}

export const markdownBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [dialectsPoint, {id: MARKDOWN_SYNTAXES_POINT, implementation: "required", validate: validateSyntaxContribution}],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: filesKey}],
        provides: [markdownKey],
        receives: [MARKDOWN_SYNTAXES_POINT],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const catalog = new SyntaxCatalog(context.declarations, (id, code, message, error) => {
                diagnostics.record({level: "warn", event: "markdown.dialect.inactive", message, ...(error === undefined ? {} : {error}), data: {dialect: id, code}, source: {plugin: descriptor.id}});
            });
            const assets = createAssetUrls(context.services.require(filesKey));
            context.signal.addEventListener("abort", () => assets.dispose(), {once: true});
            const service: MarkdownService = {
                components: {
                    MarkdownControl: withHost(catalog, assets, "MarkdownControlHost", async () => (await import("./components/MarkdownControl.vue")).default),
                    MarkdownDisplay: withHost(catalog, assets, "MarkdownDisplayHost", async () => (await import("./components/MarkdownDisplay.vue")).default),
                    InlineChip: defineAsyncComponent(async () => (await import("./components/InlineChip.vue")).default),
                    MarkdownImage: defineAsyncComponent(async () => (await import("./components/MarkdownImage.vue")).default),
                },
            };
            return {services: [provide(markdownKey, service)], receivers: {[MARKDOWN_SYNTAXES_POINT]: catalog.receiver()}};
        },
    })],
};
