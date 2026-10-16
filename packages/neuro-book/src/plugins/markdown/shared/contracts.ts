/**
 * `nbook.markdown` 对其它插件公开的合同（docs/specs/workspace/markdown-syntaxes.md）：方言的两个贡献点、服务键与它的形状、字数。
 *
 * 服务只交组件。语言、编解码器与语法模块只在这些组件里用，组件第一次挂上时才加载，引用本合同的插件与首屏都不带它们。
 * 贡献方言实现的插件按类型引用 `nbook/plugins/markdown/web/contracts` 的 `MarkdownSyntaxImplementation`。
 */

import type {Component} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export {MARKDOWN_DIALECTS_POINT, MARKDOWN_SYNTAXES_POINT, validateDialectDeclaration, validateSyntaxContribution} from "./dialects";
export type {DialectDeclaration} from "./dialects";
export {countWords, dialectTable} from "./word-count";
export type {DialectTable} from "./word-count";

export interface MarkdownComponents {
    /** Markdown 富文本控件，按编辑器区的控件合同（`nbook/plugins/editor/shared/contracts.ts`）收属性、交句柄。 */
    readonly MarkdownControl: Component;
    /** Markdown 展示器（docs/specs/ui/markdown-display.md）。 */
    readonly MarkdownDisplay: Component;
    /** 行内小块（`web/components/InlineChip.md`）。 */
    readonly InlineChip: Component;
    /** Markdown 里的一张图片（`web/components/MarkdownImage.md`）。 */
    readonly MarkdownImage: Component;
}

export interface MarkdownService {
    readonly components: MarkdownComponents;
}

export const markdownKey: ServiceKey<MarkdownService> = defineServiceKey<MarkdownService>("nbook.markdown/markdown");
