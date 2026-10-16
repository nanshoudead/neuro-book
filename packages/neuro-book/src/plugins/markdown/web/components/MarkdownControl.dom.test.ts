/**
 * MarkdownControl（同名 .md）接编解码器（docs/specs/workspace/markdown-dialect.md 输出 1–3、“状态与转换”；docs/specs/workbench/
 * editor.md 输出 12、19、61）：happy-dom 里的真实 Tiptap 编辑器，绑定来自真实的编辑器区与文档模型，文件客户端是与真实
 * Files 对过契约的内存适配器（Lab 的 `memory-files.ts`）。交出不等 150ms 的停手延迟，经句柄的 `flushPendingChange` 立即结算。
 */

import type {Editor} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";

import {MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle, TextEditorBinding} from "nbook/plugins/editor/shared/contracts";
import {createEditorArea} from "nbook/plugins/editor/web/area";
import type {EditorArea} from "nbook/plugins/editor/web/area";
import {codecFor} from "../codec/codec";
import {markdownLanguage} from "../syntax";
import {createAssetUrls, markdownAssetsKey} from "../parts/asset-urls";
import {SyntaxCatalog, syntaxCatalogKey} from "../syntax-catalog";
import MarkdownControl from "./MarkdownControl.vue";

/** nbook.markdown 交组件时给的方言目录（`web/plugin.ts`）：这里没有外来方言。 */
const catalog = new SyntaxCatalog({get: () => null, list: () => []}, () => undefined);
/**
 * 图片地址服务：字节路由的 URL 换成可读的 `/raw/<地址>`（真实的 `rawUrl` 带作品与代次，见 `asset-urls.test.ts`）；这里不看
 * 磁盘变化。
 */
const assets = createAssetUrls({rawUrl: (address) => `/raw/${address}`, watch: () => () => undefined});

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface Opened {
    readonly area: EditorArea;
    readonly memory: ReturnType<typeof createMemoryFiles>;
    readonly binding: TextEditorBinding;
    readonly editor: Editor;
    readonly handle: EditorControlHandle;
    readonly groupId: string;
}

/** 打开 `a.md`（正文 `text`），挂一个 Markdown 控件到活动组。 */
async function opened(text: string, area?: {readonly area: EditorArea; readonly memory: ReturnType<typeof createMemoryFiles>}, onError?: (error: unknown) => void): Promise<Opened> {
    const memory = area?.memory ?? createMemoryFiles({project: [["a.md", text]], user: []});
    const editorArea = area?.area ?? createEditorArea({files: memory.files, clock: systemClock, workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    if (area === undefined) {
        cleanups.push(() => memory.dispose());
        cleanups.push(() => editorArea.dispose());
        editorArea.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
    }
    const groupId = editorArea.groups.activeGroup.value;
    const binding = await waitUntil("文档读到", () => {
        const found = editorArea.binding(groupId);
        return found?.kind === "text" && editorArea.documentOf(groupId)?.status.value === "ready" ? found : null;
    });
    let handle: EditorControlHandle | null = null;
    const host = editorArea.controlSlot(groupId, MARKDOWN_EDITOR);
    // 句柄交给编辑器区（与 `EditorGroup` 一样），区域的定位、结算经它找到控件。
    const wrapper = mount(MarkdownControl, {props: {binding, host, readonly: false, visible: true, label: "a.md", onReady: (ready: EditorControlHandle | null) => {
        handle = ready;
        editorArea.registerHandle(groupId, MARKDOWN_EDITOR, ready);
    }}, attachTo: document.body, global: {provide: {[syntaxCatalogKey as symbol]: catalog, [markdownAssetsKey as symbol]: assets}, ...(onError === undefined ? {} : {config: {errorHandler: onError}})}});
    cleanups.push(() => wrapper.unmount());
    const editor = (host.state as {editor: Editor}).editor;
    return {area: editorArea, memory, binding, editor, handle: handle as unknown as EditorControlHandle, groupId};
}

/** 第 n 个顶层块里第一个文本块的末尾。 */
function endOfBlock(editor: Editor, index: number): number {
    let end = -1;
    editor.state.doc.forEach((node, offset, at) => {
        if (at !== index) return;
        if (node.isTextblock) end = offset + 1 + node.content.size;
        node.descendants((child, pos) => {
            if (end < 0 && child.isTextblock) end = offset + 1 + pos + 1 + child.content.size;
            return end < 0;
        });
    });
    return end;
}

describe("交出（方言 Spec 输出 1–3）", () => {
    it("打开不编辑、结算：正文不变；只改一块：只有那一块重新写出，其余字节不变", async () => {
        const source = "* 甲\r\n\r\n<ruby>汉<rt>hàn</rt></ruby>字\r\n\r\n乙\r\n";
        const {editor, handle, binding} = await opened(source);
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
        editor.commands.insertContentAt(endOfBlock(editor, 2), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 甲\r\n\r\n<ruby>汉<rt>hàn</rt></ruby>字\r\n\r\n乙改\r\n");
    });

    it("写回被接受后写法固定（输出 2）：为分开相邻列表换了符号的新列表，删掉前一个列表再改它，仍写 `*`", async () => {
        const {editor, handle, binding} = await opened("- 甲\n\n正文\n");
        // 把“正文”一段换成一个新列表（编辑器的“转为列表”会并进前一个列表，这里要的是两个相邻的列表）。
        const {schema, doc} = editor.state;
        const list = schema.nodes.bulletList!.create(null, schema.nodes.listItem!.create(null, schema.nodes.paragraph!.create(null, schema.text("正文"))));
        editor.view.dispatch(editor.state.tr.replaceWith(doc.child(0).nodeSize, doc.content.size, list));
        handle.flushPendingChange();
        expect(binding.text.value).toBe("- 甲\n\n* 正文\n");
        editor.commands.deleteRange({from: 0, to: editor.state.doc.child(0).nodeSize});
        editor.commands.insertContentAt(endOfBlock(editor, 0), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 正文改\n");
    });

    it("删光正文后默认块是段落，写成空正文", async () => {
        const {editor, handle, binding} = await opened("甲\n\n乙\n");
        editor.commands.selectAll();
        editor.commands.deleteSelection();
        expect(editor.state.doc.child(0).type.name).toBe("paragraph");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("");
    });
});

describe("显示（方言 Spec 输出 23）", () => {
    it("带 `-` 的提示块一开始折叠，点标题展开、再点折叠；折叠状态不写回文件；没有折叠标记的不能折叠", async () => {
        const source = "> [!WARNING]- 伏笔\n> 她早就知道。\n\n> [!NOTE]\n> 普通。\n";
        const {handle, binding} = await opened(source);
        const [foldable, plain] = [...document.querySelectorAll<HTMLElement>(".nb-callout")];
        const content = (callout: HTMLElement | undefined): HTMLElement => callout?.querySelector(".nb-callout__content") as HTMLElement;
        expect(content(foldable).hidden).toBe(true);
        foldable?.querySelector<HTMLElement>(".nb-callout__label")?.click();
        expect(content(foldable).hidden).toBe(false);
        expect(foldable?.querySelector(".nb-callout__toggle")?.getAttribute("aria-expanded")).toBe("true");
        foldable?.querySelector<HTMLElement>(".nb-callout__toggle")?.click();
        expect(content(foldable).hidden).toBe(true);
        plain?.querySelector<HTMLElement>(".nb-callout__label")?.click();
        expect(content(plain).hidden).toBe(false);
        expect((plain?.querySelector(".nb-callout__toggle") as HTMLElement).hidden).toBe(true);
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
    });

    it("折叠的提示块里看不见的内容不会被悄悄改掉：在后一段段首退格并进去、或光标移进去，它就展开", async () => {
        const {editor} = await opened("> [!WARNING]- 伏笔\n> 内容\n\n后一段\n");
        const content = (): HTMLElement => document.querySelector(".nb-callout__content") as HTMLElement;
        expect(content().hidden).toBe(true);
        editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);
        expect(content().hidden).toBe(true);
        editor.commands.joinBackward();
        expect(editor.state.doc.childCount).toBe(1);
        expect(content().hidden).toBe(false);

        const second = await opened("> [!WARNING]- 伏笔\n> 内容\n\n后一段\n");
        second.editor.commands.setTextSelection(3);
        expect((document.querySelectorAll(".nb-callout__content")[1] as HTMLElement).hidden).toBe(false);
    });

    it("同一个编辑器换到另一份文档：提示块按新文档的折叠标记显示，不沿用前一份的", async () => {
        const {editor} = await opened("> [!NOTE] 甲\n> 内容\n");
        expect((document.querySelector(".nb-callout__content") as HTMLElement).hidden).toBe(false);
        // 控件换文档时的做法（`load`）：按新正文建编辑状态。
        const read = codecFor(editor.schema, markdownLanguage()).read("> [!WARNING]- 乙\n> 内容\n");
        editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
        expect((document.querySelector(".nb-callout__content") as HTMLElement).hidden).toBe(true);
    });
});

describe("卸载", () => {
    it("编辑器区先释放了实例（组关闭、Lab 切走）再卸载控件：卸载前的结算照常写出，不报错", async () => {
        const errors: unknown[] = [];
        const {editor, binding, area, groupId} = await opened("甲\n", undefined, (error) => errors.push(error));
        editor.commands.insertContentAt(endOfBlock(editor, 0), "乙");
        area.controlSlot(groupId, MARKDOWN_EDITOR).dispose?.();
        // 最后登记的清理是卸载控件（见 `opened`）：文档还在，只卸载控件。
        cleanups.pop()?.();
        expect(errors).toEqual([]);
        expect(binding.text.value).toBe("甲乙\n");
    });
});

describe("重载（“状态与转换”、editor 输出 12）", () => {
    it("有批注的文件：别处只改了末段，本组之前的输入仍能撤销，撤销后末段保留别处的修改", async () => {
        const {editor, handle, binding, memory, area, groupId} = await opened("<comment body=\"意见\">甲</comment>\n\n中间\n\n尾\n");
        editor.commands.insertContentAt(endOfBlock(editor, 1), "改");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("<comment body=\"意见\">甲</comment>\n\n中间改\n\n尾\n");
        // 保存之后磁盘的新内容才直接换进正文（没保存时只提示磁盘变了）。
        expect(await area.documents.save(area.documentOf(groupId)!)).toEqual({ok: true});
        memory.externalWrite("project://a.md", "<comment body=\"意见\">甲</comment>\n\n中间改\n\n尾外改\n");
        await waitUntil("重载", () => editor.state.doc.textContent.includes("尾外改"));
        editor.commands.undo();
        expect(editor.state.doc.textContent).toBe("甲中间尾外改");
    });

    it("磁盘的新内容：只换不同的那一段，之后只改一块时其余块按新原文写回", async () => {
        const {editor, handle, binding, memory} = await opened("* 甲&amp;\n\n乙\n");
        // 新内容里也有重新写出时会变的写法（`&amp;` 会写成 `&`）：只有按新原文写回时才保持。
        memory.externalWrite("project://a.md", "* 甲&amp;\n\n丙&amp;\n\n戊\n");
        await waitUntil("重载", () => editor.state.doc.textContent.includes("戊"));
        editor.commands.insertContentAt(endOfBlock(editor, 2), "丁");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("* 甲&amp;\n\n丙&amp;\n\n戊丁\n");
    });
});

describe("写不出（editor 输出 61）", () => {
    /** 在第一块开头放一个会开启 HTML 块的原样片段：哪一级写法都读不回来。 */
    const breakFirst = (editor: Editor): void => {
        editor.commands.insertContentAt(1, {type: "rawInline", attrs: {raw: "<div>"}});
    };

    it("这次输入不交，文档记下写不出并能定位；改好之后交出成功即解除", async () => {
        const {editor, handle, binding, area, groupId} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        expect(binding.text.value).toBe("甲\n\n乙\n");
        const blocked = area.documentOf(groupId)?.blocked.value.get(binding.token);
        expect(blocked?.fallback).toBe("\\<div>甲\n\n乙\n");
        // 组顶部的提示写明是哪一块：第几块与开头几个字。
        expect([blocked?.index, blocked?.excerpt]).toEqual([1, "甲"]);
        area.locate(groupId);
        const {from, to, empty} = editor.state.selection;
        expect(blocked !== undefined && !empty && from >= blocked.from && to <= blocked.to).toBe(true);
        editor.commands.deleteRange({from: 1, to: 2});
        editor.commands.insertContentAt(endOfBlock(editor, 0), "改");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(false);
        expect(binding.text.value).toBe("甲改\n\n乙\n");
    });

    it("写不出期间文档的正文被别处改了：这个视图不随之更新，保留自己的内容（editor 输出 61）", async () => {
        const {editor, handle, binding, memory} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        editor.commands.insertContentAt(endOfBlock(editor, 1), "改");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        memory.externalWrite("project://a.md", "甲\n\n乙外\n");
        await waitUntil("文档换成磁盘内容", () => binding.text.value === "甲\n\n乙外\n");
        expect(editor.state.doc.textContent).toBe("甲乙改");
        expect(binding.blocked()).toBe(true);
    });

    it("采用当前正文：丢弃这个视图的输入，按文档的正文重载", async () => {
        const {editor, handle, binding, area, groupId} = await opened("甲\n\n乙\n");
        breakFirst(editor);
        editor.commands.insertContentAt(endOfBlock(editor, 1), "也改了");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(true);
        area.unblock(groupId);
        await waitUntil("重载", () => !editor.state.doc.textContent.includes("也改了"));
        expect(editor.state.doc.textContent).toBe("甲乙");
        handle.flushPendingChange();
        expect(binding.text.value).toBe("甲\n\n乙\n");
    });
});

describe("引用小块与图片（方言 Spec 输出 18、27）", () => {
    it("指向作品里文件的链接是一个引用小块，被批注盖住一半时也是一个；文字照常可编辑，写回不变；外部链接仍是普通链接", async () => {
        const source = "见[<comment body=\"意见\">林</comment>雪](设定/林雪.md)与[官网](https://example.com)。\n";
        const {editor, handle, binding} = await opened(source);
        const root = editor.view.dom;
        expect(root.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
        expect(root.querySelectorAll(".nb-chip-link--end")).toHaveLength(1);
        expect([...root.querySelectorAll("[data-reference-link]")].map((element) => element.textContent).join("")).toBe("林雪");
        expect(root.querySelector(".nb-chip-link__icon svg[data-file-icon]")?.getAttribute("data-icon")).toBe("markdown");
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
        // 在链接文字中间打字：仍是同一个链接、同一个小块。
        let inside = -1;
        editor.state.doc.descendants((node, pos) => {
            if (inside < 0 && node.isText && node.text === "雪") inside = pos + 1;
        });
        editor.commands.insertContentAt(inside, "儿");
        handle.flushPendingChange();
        // 重新写出时批注写在最外层（它的优先级最高），链接的原文可能拆成两个 `[…](…)`；读回仍是同一个链接，仍是一个小块。
        const linked = (doc: PMNode): string[] => {
            const runs: string[] = [];
            doc.descendants((node) => {
                const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href as string | undefined;
                if (node.isText && href !== undefined) runs.push(`${node.text ?? ""}→${href}`);
            });
            return runs;
        };
        expect(linked(codecFor(editor.schema, markdownLanguage()).read(binding.text.value).doc)).toEqual(linked(editor.state.doc));
        expect(root.querySelectorAll(".nb-chip-link__icon")).toHaveLength(1);
    });

    it("图片按所在文件的目录解析，经文件服务显示；作品根以外的不显示、写明原因；不编辑写回不变", async () => {
        const source = "![封面](images/a.png) ![外面](../外面.png)\n";
        const {editor, handle, binding} = await opened(source);
        await waitUntil("图片显示", () => editor.view.dom.querySelector("img"));
        expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe("/raw/project://images/a.png");
        expect(editor.view.dom.querySelector("[data-markdown-image][data-state='none']")?.textContent?.trim()).toBe("外面（不在作品里，不显示）");
        handle.flushPendingChange();
        expect(binding.text.value).toBe(source);
    });
});

