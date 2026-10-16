/**
 * 展示器里需要专门样子的节点（docs/specs/ui/markdown-display.md 输出 2、5、8）：提示块、可渲染 HTML 与图片。外观与编辑器的节点
 * 视图由同一套函数画（`buildCallout`、`renderHtmlEmbedElement`、`MarkdownImage`），交互接到展示器自己：折叠只记在这次显示里，
 * 点图片经 `activate` 交给宿主。别的节点（包括外来方言的）按 schema 的 `renderHTML` 显示。
 */

import type {Node as PMNode} from "@tiptap/pm/model";
import {h, render} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import MarkdownImage from "../components/MarkdownImage.vue";
import type {ResolveAsset} from "../components/MarkdownImage.vue";
import {buildCallout} from "../syntax/callout";
import {renderHtmlEmbedElement} from "../syntax/html-embed";

export type DisplayActivation =
    | {readonly kind: "reference"; readonly target: string}
    | {readonly kind: "link"; readonly href: string}
    | {readonly kind: "image"; readonly address: string};

export interface StaticViewHost {
    readonly document: Document;
    readonly locale: DisplayLocale;
    readonly resolveAsset: ResolveAsset | undefined;
    activate(activation: DisplayActivation): void;
}

export interface StaticView {
    readonly dom: HTMLElement;
    /** 子块放在这里（渲染器递归填入）。 */
    readonly contentDOM?: HTMLElement;
    /** 释放监听、沙箱与图片；块被替换或展示器卸载时调用一次。 */
    destroy?(): void;
}

export type StaticViewFactory = (node: PMNode, host: StaticViewHost) => StaticView;

const HTML_LABELS: Readonly<Record<DisplayLocale, {render: string; viewSource: string; caption: string}>> = {
    "zh-CN": {render: "渲染", viewSource: "查看源码", caption: "HTML"},
    "en-US": {render: "Render", viewSource: "View Source", caption: "HTML"},
};

export const STATIC_VIEWS: Readonly<Record<string, StaticViewFactory>> = {
    callout: (node, host) => {
        let folded = node.attrs.fold === "-";
        const element = buildCallout(host.document, () => {
            folded = !folded;
            element.render(node, folded);
        });
        element.render(node, folded);
        return {dom: element.dom, contentDOM: element.content};
    },
    htmlEmbed: (node, host) => {
        const wrapper = host.document.createElement("div");
        wrapper.className = "nb-html-embed";
        let rendered = false;
        let teardown: (() => void) | null = null;
        const draw = (): void => {
            teardown?.();
            teardown = renderHtmlEmbedElement(wrapper, String(node.attrs.html ?? ""), rendered, {resolveLabels: () => HTML_LABELS[host.locale]}, () => {
                rendered = !rendered;
                draw();
            });
        };
        draw();
        return {dom: wrapper, destroy: () => teardown?.()};
    },
    image: (node, host) => {
        const dom = host.document.createElement("span");
        dom.className = "nb-markdown-image-node";
        const src = String(node.attrs.src ?? "");
        render(h(MarkdownImage, {src, alt: String(node.attrs.alt ?? ""), title: (node.attrs.title as string | null) ?? null, locale: host.locale, resolveAsset: host.resolveAsset, onActivate: () => host.activate({kind: "image", address: src})}), dom);
        return {dom, destroy: () => render(null, dom)};
    },
};
