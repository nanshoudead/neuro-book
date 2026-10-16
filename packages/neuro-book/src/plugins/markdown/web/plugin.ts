/**
 * `nbook.markdown` 浏览器入口（docs/specs/workspace/markdown-syntaxes.md）：提供服务 `markdownKey`，交出用 Markdown 的组件。
 *
 * 组件按需加载：语法模块、Markdown 解析器与编辑内核只从这些 `.vue` 组件引用，入口本身不引它们，所以首屏不含它们；后端的
 * 类型检查装配浏览器插件时也不展开它们（`src/types/vue-sfc.d.ts`）。
 */

import {defineAsyncComponent} from "vue";

import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {markdownKey} from "../shared/contracts";
import type {MarkdownService} from "../shared/contracts";

export const markdownBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        provides: [markdownKey],
        activate: () => {
            const service: MarkdownService = {
                components: {MarkdownControl: defineAsyncComponent(() => import("./components/MarkdownControl.vue"))},
            };
            return {services: [provide(markdownKey, service)]};
        },
    })],
};
