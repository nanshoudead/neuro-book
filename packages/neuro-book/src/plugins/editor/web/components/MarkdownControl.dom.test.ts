/**
 * MarkdownControl（同名 .md）接编解码器（docs/specs/workspace/markdown-dialect.md 输出 1–3、“状态与转换”；docs/specs/workbench/
 * editor.md 输出 12、19、61）：happy-dom 里的真实 Tiptap 编辑器，绑定来自真实的编辑器区与文档模型，文件客户端是与真实
 * Files 对过契约的内存适配器（Lab 的 `memory-files.ts`）。交出不等 150ms 的停手延迟，经句柄的 `flushPendingChange` 立即结算。
 */

import type {Editor} from "@tiptap/core";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";

import {MARKDOWN_EDITOR} from "../../shared/contracts";
import type {EditorControlHandle, TextEditorBinding} from "../../shared/contracts";
import {createEditorArea} from "../area";
import type {EditorArea} from "../area";
import MarkdownControl from "./MarkdownControl.vue";

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
async function opened(text: string, area?: {readonly area: EditorArea; readonly memory: ReturnType<typeof createMemoryFiles>}): Promise<Opened> {
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
    }}, attachTo: document.body});
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

describe("重载（“状态与转换”、editor 输出 12）", () => {
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
        expect(blocked?.fallback).toBe("甲\n\n乙\n");
        area.locate(groupId);
        const {from, to, empty} = editor.state.selection;
        expect(blocked !== undefined && !empty && from >= blocked.from && to <= blocked.to).toBe(true);
        editor.commands.deleteRange({from: 1, to: 2});
        editor.commands.insertContentAt(endOfBlock(editor, 0), "改");
        handle.flushPendingChange();
        expect(binding.blocked()).toBe(false);
        expect(binding.text.value).toBe("甲改\n\n乙\n");
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
