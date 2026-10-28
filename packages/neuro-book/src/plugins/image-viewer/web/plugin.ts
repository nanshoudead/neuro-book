/**
 * `nbook.image-viewer` 浏览器入口（docs/specs/workbench/image-viewer.md）：向编辑器区的贡献点 `editor.editors` 交一个按字节
 * 显示的编辑器。声明在清单里，编辑器区据此为 png 这类文件选它（选择只看声明）；控件第一次挂上时才加载组件。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {EDITOR_EDITORS_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditorDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {Written} from "nbook/shared/convention-keys";

import {descriptor} from "../plugin";

export const IMAGE_EDITOR = "nbook.image-viewer.image";

const DECLARATION: Written<EditorDeclaration, "title"> = {
    selector: {extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]},
    priority: "default",
    input: "bytes",
};

export const imageViewerBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 启动即交付：恢复会话时图片标签不必等按需激活。
        activationEvents: ["onStartup"],
        contributions: [{capability: EDITOR_EDITORS_POINT, id: IMAGE_EDITOR, declaration: DECLARATION}],
        activate: () => ({
            contributions: {[EDITOR_EDITORS_POINT]: {[IMAGE_EDITOR]: {load: async () => (await import("./components/ImageViewer.vue")).default}}},
        }),
    })],
};
