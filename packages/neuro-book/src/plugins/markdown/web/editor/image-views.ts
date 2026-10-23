/**
 * 编辑器里的图片（docs/specs/workspace/markdown-dialect.md 输出 18；外观见 nb-markdown 的 `display/MarkdownImage.md`）：节点视图是普通 DOM，
 * 用 Vue 的 `render()` 把 `MarkdownImage` 挂进去。控件用的是 `@tiptap/core` 的编辑器、没有 `EditorContent`，Tiptap 的 Vue
 * 节点视图挂不上，所以不用它。
 *
 * 视图经 ProseMirror 插件的 `nodeViews` 给出：图片节点在语言的 schema 里（核心语法），视图属于编辑器界面，不进语法模块。
 */

import {Extension} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin} from "@tiptap/pm/state";
import type {EditorView, NodeView} from "@tiptap/pm/view";
import {h, render} from "vue";

import {MarkdownImage} from "@notnotype/nb-markdown/display";
import type {ResolveAsset} from "@notnotype/nb-markdown/display";

import type {MarkdownViewHost} from "./view-host";

function imageView(initial: PMNode, view: EditorView, host: MarkdownViewHost): NodeView {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "nb-markdown-image-node";
    dom.contentEditable = "false";
    let node = initial;
    let refresh = 0;
    let watched: string | null = null;
    let stopWatching: (() => void) | null = null;
    const src = (): string => String(node.attrs.src ?? "");
    // 函数只建一次：`MarkdownImage` 按它、地址与 `refresh` 重新取 URL，重画时不能每次都换。
    const resolveAsset: ResolveAsset | undefined = host.assets === null ? undefined : async (address) => {
        const resolved = host.assets?.resolve(host.base(), address) ?? null;
        return resolved === null ? null : {url: resolved.url, release: () => undefined};
    };
    const draw = (): void => {
        // 磁盘上的文件变了就重新取（换了地址才换订阅）。
        const address = host.assets?.resolve(host.base(), src())?.address ?? null;
        if (address !== watched) {
            stopWatching?.();
            watched = address;
            stopWatching = address === null || host.assets === null ? null : host.assets.onChange(address, () => {
                refresh += 1;
                draw();
            });
        }
        render(h(MarkdownImage, {src: src(), alt: String(node.attrs.alt ?? ""), title: (node.attrs.title as string | null) ?? null, locale: host.locale(), resolveAsset, refresh, missing: host.imageMissing}), dom);
    };
    draw();
    return {
        dom,
        update: (next) => {
            if (next.type !== node.type) return false;
            node = next;
            draw();
            return true;
        },
        selectNode: () => dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
        // 里面的 DOM 归 Vue 管。
        ignoreMutation: () => true,
        destroy: () => {
            stopWatching?.();
            render(null, dom);
        },
    };
}

export const MarkdownImageViews = Extension.create<{host: MarkdownViewHost | null}>({
    name: "markdownImageViews",
    addOptions() {
        return {host: null};
    },
    addProseMirrorPlugins() {
        const host = this.options.host;
        if (host === null) return [];
        return [new Plugin({props: {nodeViews: {image: (node, view) => imageView(node, view, host)}}})];
    },
});
