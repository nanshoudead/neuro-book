/**
 * 外来方言晚到（docs/specs/workspace/markdown-syntaxes.md 输出 6、7、8 与验收 1）：真实内核的浏览器实例里，拥有者用产品的
 * 贡献点定义与 `SyntaxCatalog`，测试方言插件不启动即激活、由测试激活。Markdown 控件挂在真实的编辑器区与文档模型上（文件客户端
 * 是 Lab 的内存适配器），控件拿到的方言目录与产品里 `nbook.markdown` 交组件时给的是同一种。
 */

import type {Editor} from "@tiptap/core";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle, TextEditorBinding} from "nbook/plugins/editor/shared/contracts";
import {createEditorArea} from "nbook/plugins/editor/web/area";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";

import {descriptor} from "../../plugin";
import {MARKDOWN_SYNTAXES_POINT, validateSyntaxContribution} from "../../shared/contracts";
import {dialectsPoint} from "../../shared/plugin";
import {SyntaxCatalog, syntaxCatalogKey} from "../syntax-catalog";
import {kbdDialectPlugin} from "../testing/kbd-dialect";
import MarkdownControl from "./MarkdownControl.vue";

const silent = {error: () => undefined};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 起一个浏览器实例：拥有者与 `nbook.markdown` 的浏览器定义同样的贡献点与内置声明；测试方言等测试激活。 */
async function start(): Promise<{readonly catalog: SyntaxCatalog; readonly deliver: () => Promise<void>}> {
    let catalog: SyntaxCatalog | null = null;
    const owner: PluginDefinition = {
        id: descriptor.id,
        contributionPoints: [dialectsPoint, {id: MARKDOWN_SYNTAXES_POINT, implementation: "required", validate: validateSyntaxContribution}],
        contributions: descriptor.contributions ?? [],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [MARKDOWN_SYNTAXES_POINT],
            activate: (context) => {
                catalog = new SyntaxCatalog(context.declarations, () => undefined);
                return {receivers: {[MARKDOWN_SYNTAXES_POINT]: catalog.receiver()}};
            },
        }],
    };
    const identity = {location: "browser" as const, instanceId: "late-dialect"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, owner, kbdDialectPlugin({activationEvents: []})], requiredPlugins: [diagnostics.id, descriptor.id], gates: []},
    );
    cleanups.push(async () => {
        await application.stop();
    });
    await application.startup;
    const ready = catalog as SyntaxCatalog | null;
    if (ready === null) throw new Error("拥有者没有激活");
    return {
        catalog: ready,
        deliver: async () => {
            expect(await application.plugins.activate({plugin: "test.kbd", entry: "browser"})).toMatchObject({status: "activated"});
            await waitUntil("方言生效", () => (ready.active.value.length === 1 ? true : null));
        },
    };
}

/** 打开 `a.md` 并挂一个 Markdown 控件（与 `EditorGroup` 一样把句柄交给编辑器区）。 */
async function opened(text: string, catalog: SyntaxCatalog): Promise<{readonly editor: Editor; readonly handle: EditorControlHandle; readonly binding: TextEditorBinding}> {
    const memory = createMemoryFiles({project: [["a.md", text]], user: []});
    const area = createEditorArea({files: memory.files, clock: systemClock, workspaceKey: "test", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    cleanups.push(() => memory.dispose());
    cleanups.push(() => area.dispose());
    area.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
    const groupId = area.groups.activeGroup.value;
    const binding = await waitUntil("文档读到", () => {
        const found = area.binding(groupId);
        return found?.kind === "text" && area.documentOf(groupId)?.status.value === "ready" ? found : null;
    });
    let handle: EditorControlHandle | null = null;
    const host = area.controlSlot(groupId, MARKDOWN_EDITOR);
    const wrapper = mount(MarkdownControl, {props: {binding, host, readonly: false, visible: true, label: "a.md", onReady: (ready: EditorControlHandle | null) => {
        handle = ready;
        area.registerHandle(groupId, MARKDOWN_EDITOR, ready);
    }}, attachTo: document.body, global: {provide: {[syntaxCatalogKey as symbol]: catalog}}});
    cleanups.push(() => wrapper.unmount());
    return {editor: (host.state as {editor: Editor}).editor, handle: handle as unknown as EditorControlHandle, binding};
}

const marksOf = (editor: Editor): string[] => {
    const names: string[] = [];
    editor.state.doc.descendants((node) => {
        for (const mark of node.marks) names.push(mark.type.name);
    });
    return names;
};
const rawOf = (editor: Editor): string[] => {
    const raws: string[] = [];
    editor.state.doc.descendants((node) => {
        if (node.type.name === "rawInline") raws.push(String(node.attrs.raw));
    });
    return raws;
};

const SOURCE = "按 <kbd>Ctrl</kbd> 保存。\n";

describe("Spec workspace.markdown-syntaxes 验收 1：外来方言晚到", () => {
    it("交付之后新建的编辑器认得它；已打开的编辑器不变，还没交出的输入照常交出，原样片段的字节不变", async () => {
        const {catalog, deliver} = await start();
        const before = await opened(SOURCE, catalog);
        expect(rawOf(before.editor)).toEqual(["<kbd>Ctrl</kbd>"]);
        // 已打开的编辑器里有一处还没交出的输入（停手延迟之内）。
        before.editor.commands.insertContentAt(before.editor.state.doc.child(0).nodeSize - 1, "吧");

        await deliver();
        const after = await opened(SOURCE, catalog);
        expect(marksOf(after.editor)).toEqual(["test-kbd"]);
        expect(rawOf(after.editor)).toEqual([]);

        // 已打开的那个实例仍是建立时的语言：`<kbd>` 还是原样片段，输入交出后字节只多了那个字。
        expect(rawOf(before.editor)).toEqual(["<kbd>Ctrl</kbd>"]);
        before.handle.flushPendingChange();
        expect(before.binding.text.value).toBe("按 <kbd>Ctrl</kbd> 保存。吧\n");
        // 新的实例按方言写回：编辑后 `<kbd>` 由方言的写法写出。
        after.editor.commands.insertContentAt(after.editor.state.doc.child(0).nodeSize - 1, "吧");
        after.handle.flushPendingChange();
        expect(after.binding.text.value).toBe("按 <kbd>Ctrl</kbd> 保存。吧\n");
    });
});
