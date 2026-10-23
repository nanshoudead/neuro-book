/**
 * 在富文本里新建批注（docs/specs/workspace/markdown-dialect.md 输出 11、场景 6、7）：happy-dom 里的真实编辑器，经格式层命令
 * `addComment` 加批注，用编辑器自己的 schema 读写。
 */

import {Editor} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {EditorState} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor} from "../../codec/codec";
import type {SourceMap} from "../../codec/read";
import {defaultMarkdownLanguage} from "..";

const language = defaultMarkdownLanguage();
const editors: Editor[] = [];

afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const p = (text: string): JSONContent => ({type: "paragraph", content: [{type: "text", text}]});

/** 一个编辑器与它的读写：`open` 读入原文，`save` 写回并接受（之后的写回以这次为原文）。 */
function session(content: JSONContent[]) {
    const editor = new Editor({extensions: [...language.extensions], content: {type: "doc", content}});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    let map: SourceMap = codec.read("").map;
    return {
        editor,
        open(source: string): void {
            const read = codec.read(source);
            map = read.map;
            editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
        },
        save(): string {
            const result = codec.write(editor.state.doc, map);
            if (!result.ok) throw new Error(`写不出：${result.reason}`);
            result.record();
            return result.text;
        },
    };
}

/** 文档里第 n 次出现的这段文字的起止位置。 */
function find(doc: PMNode, text: string): {from: number; to: number} {
    let found: {from: number; to: number} | null = null;
    doc.descendants((node, pos) => {
        const at = node.isText ? (node.text as string).indexOf(text) : -1;
        if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
    });
    if (found === null) throw new Error(`找不到 ${text}`);
    return found;
}

/** 文档里各条批注（按 `key` 分组）的意见。 */
function comments(doc: PMNode): string[] {
    const bodies = new Map<unknown, string>();
    doc.descendants((node) => {
        for (const mark of node.marks) if (mark.type.name === "comment") bodies.set(mark.attrs.key, String(mark.attrs.body));
    });
    return [...bodies.values()];
}

describe("addComment（场景 6、7）", () => {
    it("跨段的选区写成分截批注；重新打开是一条；删掉第一段后意见挪到下一截；在一截中间拆段多出一截", () => {
        const {editor, open, save} = session([p("123one"), p("two"), p("three")]);
        editor.commands.setTextSelection({from: find(editor.state.doc, "one").from, to: find(editor.state.doc, "three").to});
        expect(editor.commands.addComment("意见")).toBe(true);
        const text = save();
        expect(text).toBe("123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>");

        open(text);
        expect(comments(editor.state.doc)).toEqual(["意见"]);

        editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize));
        expect(save()).toBe("<comment id=\"c1\" body=\"意见\">two</comment>\n\n<comment id=\"c1\">three</comment>");

        editor.commands.setTextSelection(find(editor.state.doc, "wo").from);
        editor.commands.splitBlock();
        expect(save()).toBe("<comment id=\"c1\" body=\"意见\">t</comment>\n\n<comment id=\"c1\">wo</comment>\n\n<comment id=\"c1\">three</comment>");
        expect(comments(editor.state.doc)).toEqual(["意见"]);
    });

    it("选中完整的两段写成块批注；再给其中一段的后半句加批注，两条正确嵌套，重新打开仍是两条", () => {
        const {editor, open, save} = session([p("甲乙"), p("丙丁")]);
        editor.commands.setTextSelection({from: find(editor.state.doc, "甲乙").from, to: find(editor.state.doc, "丙丁").to});
        editor.commands.addComment("整块");
        expect(save()).toBe("<comment body=\"整块\">\n甲乙\n\n丙丁\n</comment>");

        editor.commands.setTextSelection(find(editor.state.doc, "丁"));
        editor.commands.addComment("后半");
        const text = save();
        expect(text).toBe("<comment body=\"整块\">\n甲乙\n\n丙<comment body=\"后半\">丁</comment>\n</comment>");

        open(text);
        expect(editor.state.doc.child(0).type.name).toBe("commentBlock");
        expect(comments(editor.state.doc)).toEqual(["后半"]);
    });

    it("只在一段里的选区是行内批注；空选区不加", () => {
        const {editor, save} = session([p("她抬头看了他一眼。")]);
        editor.commands.setTextSelection(find(editor.state.doc, "看了他一眼"));
        editor.commands.addComment("节奏太快");
        expect(save()).toBe("她抬头<comment body=\"节奏太快\">看了他一眼</comment>。");
        editor.commands.setTextSelection(1);
        expect(editor.commands.addComment("空")).toBe(false);
    });

    it("选区里只有换行与空白时不加：硬换行身上的批注写不出来", () => {
        const {editor} = session([{type: "paragraph", content: [{type: "text", text: "前"}, {type: "hardBreak"}, {type: "text", text: " 后"}]}]);
        editor.commands.setTextSelection({from: 2, to: 4});
        expect(editor.commands.addComment("换行")).toBe(false);
        expect(comments(editor.state.doc)).toEqual([]);
    });

    it("先后两次跨段加批注、各自保存：先加的那条沿用写进文件的 c1，后加的是 c2，先加的那条不重写", () => {
        const {editor, save} = session([p("一甲"), p("乙二"), p("三丙"), p("丁")]);
        editor.commands.setTextSelection({from: find(editor.state.doc, "甲").from, to: find(editor.state.doc, "乙").to});
        editor.commands.addComment("旧");
        const first = save();
        expect(first).toBe("一<comment id=\"c1\" body=\"旧\">甲</comment>\n\n<comment id=\"c1\">乙</comment>二\n\n三丙\n\n丁");
        editor.commands.setTextSelection({from: find(editor.state.doc, "丙").from, to: find(editor.state.doc, "丁").to});
        editor.commands.addComment("新");
        expect(save()).toBe("一<comment id=\"c1\" body=\"旧\">甲</comment>\n\n<comment id=\"c1\">乙</comment>二\n\n三<comment id=\"c2\" body=\"新\">丙</comment>\n\n<comment id=\"c2\">丁</comment>");
    });
});

describe("粘贴进来的批注", () => {
    it("与文件里已有的 id 相同时换一个没用过的；意见相同也是另一条批注", () => {
        const {editor, open, save} = session([{type: "paragraph"}]);
        open("<comment id=\"c1\" body=\"意见\">原有</comment>\n\n<comment id=\"c1\">一截</comment>\n\n尾");
        editor.commands.setTextSelection(find(editor.state.doc, "尾").to);
        // 编辑器复制出来的 HTML：一条分截批注的每一截都带着意见与 id。
        editor.view.pasteHTML("<p><comment id=\"c1\" body=\"意见\">粘贴</comment></p><p><comment id=\"c1\" body=\"意见\">粘贴二</comment></p>");
        expect(comments(editor.state.doc)).toEqual(["意见", "意见"]);
        expect(save()).toContain("<comment id=\"c2\" body=\"意见\">粘贴</comment>\n\n<comment id=\"c2\">粘贴二</comment>");
    });

    it("在编辑器里复制两条意见相同的批注再粘贴：仍是两条，各自换新的 id", () => {
        const {editor, open, save} = session([{type: "paragraph"}]);
        open("<comment id=\"x\" body=\"意见\">甲</comment>\n\n<comment id=\"x\" body=\"意见\">乙</comment>\n\n尾");
        expect(comments(editor.state.doc)).toEqual(["意见", "意见"]);
        editor.commands.setTextSelection({from: find(editor.state.doc, "甲").from, to: find(editor.state.doc, "乙").to});
        const html = editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
        editor.commands.setTextSelection(find(editor.state.doc, "尾").to);
        editor.view.pasteHTML(html);
        expect(comments(editor.state.doc)).toHaveLength(4);
        const text = save();
        open(text);
        expect(comments(editor.state.doc)).toEqual(["意见", "意见", "意见", "意见"]);
    });
});
