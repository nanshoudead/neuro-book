/**
 * Composer 编辑内核的扩展（docs/specs/ui/prompt-editor.md 输出 1、2、5、6、8、9）：真实的 Tiptap 编辑器，不挂 Vue 节点视图。
 * 由旧应用的同名测试移植（分支 `archive/legacy-ui-tuning`，`865c9f593`），期望值不变。
 */

import {afterEach, describe, expect, it} from "vitest";
import {Editor} from "@tiptap/core";
import {GapCursor} from "@tiptap/pm/gapcursor";
import {TextSelection} from "@tiptap/pm/state";
import {
    DISMISS_TRIGGER,
    createPromptExtensions,
    deleteAdjacentAtom,
    isEmptyPrompt,
    pendingLocalIds,
    promptTriggerKey,
    replaceWithBlocks,
    selectionBesideBlock,
    startBlockPosition,
    type PromptNodeContext,
} from "./prompt-editor-extensions";
import {pasteBlockNode, parsePromptInsertion, parsePromptText, pasteMarkerAttrs, tokenNode} from "./prompt-text";

const COMMANDS = ["plan"];
const TARGET = "workspace/.nbook/agent/attachments/sha256/ab/cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const editors: Editor[] = [];

const context: PromptNodeContext = {
    readonly: false,
    locale: "zh-CN",
    highlighted: null,
    attachmentState: () => null,
    activate: () => undefined,
    hover: () => undefined,
    submit: () => undefined,
};

function createEditor(text: string, resolved: Map<string, string> = new Map()): Editor {
    const editor = new Editor({
        element: document.createElement("div"),
        extensions: createPromptExtensions({
            context,
            placeholder: () => "",
            triggers: () => ["@", "$", "/"],
            commands: () => COMMANDS,
            readonly: () => false,
            resolvedTarget: (localId) => resolved.get(localId) ?? null,
            nodeViews: null,
        }),
        content: parsePromptText(text, {commands: COMMANDS}),
        coreExtensionOptions: {clipboardTextSerializer: {blockSeparator: "\n"}},
    });
    editors.push(editor);
    return editor;
}

function textOf(editor: Editor): string {
    return editor.getText({blockSeparator: "\n"});
}

/** 光标放在第 index 个段落（按文档子节点数）里 offset 处。 */
function placeCursor(editor: Editor, childIndex: number, offset: number): void {
    let pos = 0;
    for (let index = 0; index < childIndex; index += 1) {
        pos += editor.state.doc.child(index).nodeSize;
    }
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1 + offset)));
}

function insert(editor: Editor, text: string, structure = false): void {
    const {from, to} = editor.state.selection;
    const blocks = parsePromptInsertion(text, {commands: COMMANDS, before: "", after: "", firstLine: false, structure});
    editor.view.dispatch(replaceWithBlocks(editor.state.tr, from, to, blocks));
}

function insertBlock(editor: Editor, number: number, content: string): void {
    const {from, to} = editor.state.selection;
    editor.view.dispatch(replaceWithBlocks(editor.state.tr, from, to, [pasteBlockNode(number, content)]));
}

function typeText(editor: Editor, text: string): void {
    const {from, to} = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}

afterEach(() => {
    for (const editor of editors.splice(0)) {
        editor.destroy();
    }
});

describe("prompt-editor-extensions 文档与写回", () => {
    it.each([
        "",
        "\n",
        "a\n",
        "看 [第一章](chapter://c1) 与 $writer",
        "/plan 开始\n<paste id=\"1\">\nx\n\n</paste>",
        "<paste id=\"1\">\nx\n</paste>",
        "<paste id=\"1\">\nx\n</paste>\n<paste id=\"2\">\ny\n</paste>\n",
        "[paste #1] 看这里\n<paste id=\"1\">\nx\n</paste>",
        `![旧](${TARGET}) ![image #2](${TARGET})`,
    ])("getText 与原文一致：%j", (text) => {
        expect(textOf(createEditor(text))).toBe(text);
    });

    it("复制得到原文", () => {
        const editor = createEditor("a [第一章](chapter://c1) b\n<paste id=\"1\">\nx\n</paste>\nc");
        editor.commands.selectAll();
        const serializer = editor.view.someProp("clipboardTextSerializer");
        expect(serializer?.(editor.state.selection.content(), editor.view)).toBe("a [第一章](chapter://c1) b\n<paste id=\"1\">\nx\n</paste>\nc");
    });
});

describe("prompt-editor-extensions 插入", () => {
    it("单行插入留在原行，光标落在插入内容之后", () => {
        const editor = createEditor("ac");
        placeCursor(editor, 0, 1);
        insert(editor, "b $s ");
        expect(textOf(editor)).toBe("ab $s c");
        // 段落开头 1，"a"、"b"、空格、标签、空格各占 1。
        expect(editor.state.selection.from).toBe(6);
    });

    it("多行插入拆开原行", () => {
        const editor = createEditor("ad");
        placeCursor(editor, 0, 1);
        insert(editor, "b\nc");
        expect(textOf(editor)).toBe("ab\ncd");
    });

    it("粘贴块：空行处放在这一行之前，光标留在这一行", () => {
        const editor = createEditor("a\n\nb");
        placeCursor(editor, 1, 0);
        insertBlock(editor, 1, "x");
        expect(textOf(editor)).toBe("a\n<paste id=\"1\">\nx\n</paste>\n\nb");
        expect(editor.state.selection.$from.parent.textContent).toBe("");
    });

    it("粘贴块：行首放在这一行之前", () => {
        const editor = createEditor("ab");
        placeCursor(editor, 0, 0);
        insertBlock(editor, 1, "x");
        expect(textOf(editor)).toBe("<paste id=\"1\">\nx\n</paste>\nab");
        expect(editor.state.selection.$from.parentOffset).toBe(0);
    });

    it("粘贴块：行尾放在这一行之后，后面补一个空行给光标", () => {
        const editor = createEditor("ab");
        placeCursor(editor, 0, 2);
        insertBlock(editor, 1, "x");
        expect(textOf(editor)).toBe("ab\n<paste id=\"1\">\nx\n</paste>\n");
        expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    });

    it("粘贴块：行中拆开", () => {
        const editor = createEditor("ab");
        placeCursor(editor, 0, 1);
        insertBlock(editor, 1, "x");
        expect(textOf(editor)).toBe("a\n<paste id=\"1\">\nx\n</paste>\nb");
    });

    it("结构插入保留粘贴块", () => {
        const editor = createEditor("ab");
        placeCursor(editor, 0, 1);
        insert(editor, "1\n<paste id=\"3\">\nx\n</paste>\n2", true);
        expect(textOf(editor)).toBe("a1\n<paste id=\"3\">\nx\n</paste>\n2b");
    });

    it("放到开头：命令行之后、已有粘贴块之后", () => {
        expect(startBlockPosition(createEditor("x").state.doc)).toBe(0);
        const withCommand = createEditor("/plan a\nb");
        expect(withCommand.state.doc.resolve(startBlockPosition(withCommand.state.doc)).index(0)).toBe(1);
        const withBlocks = createEditor("<paste id=\"1\">\nx\n</paste>\n<paste id=\"2\">\ny\n</paste>\nz");
        expect(withBlocks.state.doc.resolve(startBlockPosition(withBlocks.state.doc)).index(0)).toBe(2);
    });
});

describe("prompt-editor-extensions 删除", () => {
    it("退格与 Delete 删除紧挨的整枚标签", () => {
        const editor = createEditor("a$s b");
        placeCursor(editor, 0, 0);
        const tokenStart = 1 + 1;
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, tokenStart + 1)));
        expect(deleteAdjacentAtom(editor.state, editor.view.dispatch, -1)).toBe(false);
        const doc = createEditor("a $s b");
        doc.view.dispatch(doc.state.tr.setSelection(TextSelection.create(doc.state.doc, 1 + 2 + 1)));
        expect(deleteAdjacentAtom(doc.state, doc.view.dispatch, -1)).toBe(true);
        expect(textOf(doc)).toBe("a  b");
        doc.view.dispatch(doc.state.tr.setSelection(TextSelection.create(doc.state.doc, 1)));
        expect(deleteAdjacentAtom(doc.state, doc.view.dispatch, 1)).toBe(false);
    });

    it("粘贴块下一行行首退格删掉整块", () => {
        const editor = createEditor("<paste id=\"1\">\nx\n</paste>\nab");
        placeCursor(editor, 1, 0);
        editor.commands.keyboardShortcut("Backspace");
        expect(textOf(editor)).toBe("ab");
    });

    it("删掉粘贴块时位置标记一起删，撤销一起回来", () => {
        const text = "[paste #1] 看\n<paste id=\"1\">\nx\n</paste>\nb";
        const editor = createEditor(text);
        placeCursor(editor, 2, 0);
        editor.commands.keyboardShortcut("Backspace");
        expect(textOf(editor)).toBe(" 看\nb");
        editor.commands.undo();
        expect(textOf(editor)).toBe(text);
    });

    it("删掉位置标记时粘贴块一起删", () => {
        const editor = createEditor("[paste #1] 看\n<paste id=\"1\">\nx\n</paste>\nb");
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
        expect(deleteAdjacentAtom(editor.state, editor.view.dispatch, -1)).toBe(true);
        expect(textOf(editor)).toBe(" 看\nb");
    });

    it("没有位置标记的粘贴块删除时不动别的", () => {
        const editor = createEditor("<paste id=\"1\">\nx\n</paste>\n<paste id=\"2\">\ny\n</paste>\na");
        placeCursor(editor, 2, 0);
        editor.commands.keyboardShortcut("Backspace");
        expect(textOf(editor)).toBe("<paste id=\"1\">\nx\n</paste>\na");
    });

    it("删光内容仍留一个段落", () => {
        const editor = createEditor("[paste #1]\n<paste id=\"1\">\nx\n</paste>");
        editor.commands.selectAll();
        editor.commands.deleteSelection();
        expect(editor.state.doc.childCount).toBeGreaterThan(0);
        expect(textOf(editor)).toBe("");
    });
});

describe("prompt-editor-extensions 空正文", () => {
    it("只有一个空段落才算空", () => {
        expect(isEmptyPrompt(createEditor("").state.doc)).toBe(true);
        expect(isEmptyPrompt(createEditor("\n").state.doc)).toBe(false);
        expect(isEmptyPrompt(createEditor("<paste id=\"1\">\nx\n</paste>").state.doc)).toBe(false);
        expect(isEmptyPrompt(createEditor("$writer").state.doc)).toBe(false);
    });
});

describe("prompt-editor-extensions 粘贴块内容", () => {
    function blockPos(editor: Editor): number {
        let found = -1;
        editor.state.doc.forEach((node, offset) => {
            if (found < 0 && node.type.name === "pasteBlock") {
                found = offset;
            }
        });
        return found;
    }

    function setContent(editor: Editor, content: string): void {
        const pos = blockPos(editor);
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...editor.state.doc.nodeAt(pos)!.attrs, content}));
    }

    it("连续改内容在撤销历史里合并成一步", () => {
        const text = "a\n<paste id=\"1\">\nx\n</paste>\nb";
        const editor = createEditor(text);
        setContent(editor, "xy");
        setContent(editor, "xyz");
        expect(textOf(editor)).toBe("a\n<paste id=\"1\">\nxyz\n</paste>\nb");
        editor.commands.undo();
        expect(textOf(editor)).toBe(text);
    });

    it("回到正文：前后是段落时落在相邻行的行尾、行首，否则放间隙光标", () => {
        const editor = createEditor("ab\n<paste id=\"1\">\nx\n</paste>\ncd");
        const {doc} = editor.state;
        const pos = blockPos(editor);
        const before = selectionBesideBlock(doc, pos, "before");
        const after = selectionBesideBlock(doc, pos, "after");
        expect(before).toBeInstanceOf(TextSelection);
        expect(doc.textBetween(0, before.from)).toBe("ab");
        expect(after.$from.parent.textContent).toBe("cd");
        expect(after.$from.parentOffset).toBe(0);

        const alone = createEditor("<paste id=\"1\">\nx\n</paste>");
        expect(selectionBesideBlock(alone.state.doc, 0, "before")).toBeInstanceOf(GapCursor);
        expect(selectionBesideBlock(alone.state.doc, 0, "after")).toBeInstanceOf(GapCursor);
    });
});

describe("prompt-editor-extensions 附件就绪", () => {
    it("重做带回的待上传节点再次转为标签", () => {
        const resolved = new Map<string, string>();
        const editor = createEditor("a");
        placeCursor(editor, 0, 1);
        const pending = {type: "pendingAttachment", attrs: {localId: "l1", kind: "image", name: "a.png", number: 1}};
        editor.view.dispatch(replaceWithBlocks(editor.state.tr, editor.state.selection.from, editor.state.selection.to, [{type: "paragraph", content: [pending]}]));
        expect(pendingLocalIds(editor.state.doc)).toEqual(new Set(["l1"]));
        expect(textOf(editor)).toBe("a");

        resolved.set("l1", TARGET);
        let pos = -1;
        editor.state.doc.descendants((node, nodePos) => {
            if (node.type.name === "pendingAttachment") {
                pos = nodePos;
            }
        });
        editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + 1, editor.schema.nodes.promptToken!.create({kind: "image", raw: `![image #1](${TARGET})`, number: 1, label: "image #1", target: TARGET})).setMeta("addToHistory", false));
        expect(textOf(editor)).toBe(`a![image #1](${TARGET})`);

        editor.commands.undo();
        expect(textOf(editor)).toBe("a");
        editor.commands.redo();
        expect(textOf(editor)).toBe(`a![image #1](${TARGET})`);
        expect(pendingLocalIds(editor.state.doc).size).toBe(0);
    });
});

describe("prompt-editor-extensions 触发", () => {
    const active = (editor: Editor) => promptTriggerKey.getState(editor.state)?.active ?? null;

    it("输入触发字符开始查询，空白结束", () => {
        const editor = createEditor("");
        typeText(editor, "@ch");
        expect(active(editor)).toMatchObject({trigger: "@", query: "ch", atStart: true, from: 1, to: 4});
        typeText(editor, " ");
        expect(active(editor)).toBeNull();
    });

    it("不在开头时 atStart 为假", () => {
        const editor = createEditor("a ");
        placeCursor(editor, 0, 2);
        typeText(editor, "/p");
        expect(active(editor)).toMatchObject({trigger: "/", query: "p", atStart: false});
    });

    it("关闭后查询不变不再打开，查询变化后重新打开", () => {
        const editor = createEditor("");
        typeText(editor, "@c");
        editor.view.dispatch(editor.state.tr.setMeta(promptTriggerKey, DISMISS_TRIGGER));
        expect(active(editor)).toBeNull();
        editor.view.dispatch(editor.state.tr.setMeta("noop", true));
        expect(active(editor)).toBeNull();
        typeText(editor, "h");
        expect(active(editor)).toMatchObject({query: "ch"});
    });

    it("紧跟标签后的触发字符不算", () => {
        const editor = createEditor("$s");
        placeCursor(editor, 0, 1);
        typeText(editor, "@x");
        expect(active(editor)).toBeNull();
    });
});

describe("prompt-editor-extensions 写完即成标签", () => {
    const tokens = (editor: Editor) => {
        const kinds: string[] = [];
        editor.state.doc.descendants((node) => {
            if (node.type.name === "promptToken") {
                kinds.push(String(node.attrs.kind));
            }
        });
        return kinds;
    };

    it("逐字打出技能写法，打完空格后变成标签，文字不变；撤销连同空格一起撤回", () => {
        const editor = createEditor("");
        for (const char of "$reviewer") {
            typeText(editor, char);
        }
        expect(tokens(editor)).toEqual([]);
        typeText(editor, " ");
        expect(tokens(editor)).toEqual(["skill"]);
        expect(textOf(editor)).toBe("$reviewer ");
        editor.commands.undo();
        expect(tokens(editor)).toEqual([]);
    });

    it("打出引用写法收尾的括号时变成标签", () => {
        const editor = createEditor("看 [第一章](chapter://c1");
        placeCursor(editor, 0, "看 [第一章](chapter://c1".length);
        typeText(editor, ")");
        expect(tokens(editor)).toEqual(["reference"]);
        expect(textOf(editor)).toBe("看 [第一章](chapter://c1)");
    });

    it("一次插入多行的内容（粘贴原文）不自动变", () => {
        const editor = createEditor("");
        editor.view.dispatch(replaceWithBlocks(editor.state.tr, 1, 1, [{type: "paragraph", content: [{type: "text", text: "$reviewer "}]}]));
        expect(tokens(editor)).toEqual([]);
    });
});

describe("prompt-editor-extensions 位置标记", () => {
    it("位置标记与粘贴块用 JSON 插入后成对", () => {
        const editor = createEditor("ab");
        placeCursor(editor, 0, 1);
        editor.view.dispatch(replaceWithBlocks(editor.state.tr, editor.state.selection.from, editor.state.selection.to, [{type: "paragraph", content: [tokenNode(pasteMarkerAttrs(1))]}]));
        editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodeFromJSON(pasteBlockNode(1, "x"))));
        expect(textOf(editor)).toBe("<paste id=\"1\">\nx\n</paste>\na[paste #1]b");
    });
});
