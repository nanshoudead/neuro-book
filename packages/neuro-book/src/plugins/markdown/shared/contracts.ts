/**
 * `nbook.markdown` 对其它插件公开的合同（docs/specs/workspace/markdown-syntaxes.md）：服务键与它的形状、字数。
 *
 * 服务只交组件。语言、编解码器与语法模块只在这些组件里用，组件第一次挂上时才加载，引用本合同的插件与首屏都不带它们。
 */

import type {Component} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface MarkdownComponents {
    /** Markdown 富文本控件，按编辑器区的控件合同（`nbook/plugins/editor/shared/contracts.ts`）收属性、交句柄。 */
    readonly MarkdownControl: Component;
}

export interface MarkdownService {
    readonly components: MarkdownComponents;
}

export const markdownKey: ServiceKey<MarkdownService> = defineServiceKey<MarkdownService>("nbook.markdown/markdown");

export {countWords} from "./word-count";
