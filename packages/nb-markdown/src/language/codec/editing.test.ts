/**
 * 编辑器接入的读写（docs/specs/workspace/markdown-dialect.md 输出 2、“状态与转换”；docs/specs/workbench/editor.md 输出 61）：
 * 写出被接受后的写法回填（`accept`）、正文被别处改了之后的重载（`reload`）、写不出时的抢救正文（`fallback`）。事务用
 * ProseMirror 的 `Transform`，与编辑器派发的事务同一套步骤，不经 DOM。
 */

import {getSchema} from "@tiptap/core";
import {Fragment, Slice} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {closeHistory, history, undo} from "@tiptap/pm/history";
import {EditorState} from "@tiptap/pm/state";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";

import {defaultMarkdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import type {SourceMap} from "./read";

const language = defaultMarkdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);

const p = (text: string): PMNode => schema.nodes.paragraph!.create(null, text === "" ? null : schema.text(text));
const bullets = (...items: string[]): PMNode => schema.nodes.bulletList!.create(null, items.map((text) => schema.nodes.listItem!.create(null, p(text))));

/** 写出并被接受（编辑器的做法）：返回写出的正文与回填后的文档。 */
function accepted(doc: PMNode, map: SourceMap): {text: string; doc: PMNode} {
    const result = codec.write(doc, map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    const tr = new Transform(doc);
    result.accept(tr);
    return {text: result.text, doc: tr.doc};
}

/** 在第 index 个顶层块里第一个文本块的末尾接上文字。 */
function append(doc: PMNode, index: number, text: string): PMNode {
    let end = -1;
    doc.forEach((node, offset, at) => {
        if (at !== index) return;
        if (node.isTextblock) end = offset + 1 + node.content.size;
        node.descendants((child, pos) => {
            if (end < 0 && child.isTextblock) end = offset + 1 + pos + 1 + child.content.size;
            return end < 0;
        });
    });
    return new Transform(doc).insert(end, schema.text(text)).doc;
}

describe("写法回填（输出 2：新加的内容一旦写回，写法就固定下来）", () => {
    it("为分开相邻列表换了符号的新列表：写回后删掉前一个列表、再改它，仍写 `*`", () => {
        const read = codec.read("- 甲\n\n正文\n");
        const edited = read.doc.replace(read.doc.child(0).nodeSize, read.doc.content.size, new Slice(Fragment.from(bullets("乙")), 0, 0));
        const first = accepted(edited, read.map);
        expect(first.text).toBe("- 甲\n\n* 乙\n");
        const removed = new Transform(first.doc).delete(0, first.doc.child(0).nodeSize).doc;
        expect(accepted(append(removed, 0, "丙"), read.map).text).toBe("* 乙丙\n");
    });

    it("回填只改写法：结构与文字不变，不再编辑时写出与上一次逐字节相同；批注的身份不变", () => {
        const read = codec.read("<comment body=\"意见\">批注</comment>\n");
        const edited = append(read.doc, 0, "，**新**");
        const first = accepted(new Transform(edited).addMark(edited.content.size - 3, edited.content.size - 1, schema.marks.bold!.create()).doc, read.map);
        const key = (doc: PMNode): unknown => doc.child(0).child(0).marks.find((mark) => mark.type.name === "comment")?.attrs.key;
        expect(first.doc.textContent).toBe("批注，**新**");
        expect(key(first.doc)).toBe(key(read.doc));
        const again = codec.write(first.doc, read.map);
        expect(again.ok && again.text).toBe(first.text);
    });
});

describe("真实撤销（输出 2：撤销回打开时的状态再写回，字节与打开时相同）", () => {
    /** 每个文字节点里第一个字之后的位置。 */
    const textPositions = (state: EditorState): number[] => {
        const found: number[] = [];
        state.doc.descendants((node, pos) => {
            if (node.isText) found.push(pos + 1);
        });
        return found;
    };

    /** 编辑器的做法：每步输入进撤销历史，写出被接受后回填（不进历史）；最后撤销到底再写出。 */
    function editThenUndo(source: string, steps: ReadonlyArray<(state: EditorState) => number>): string {
        const read = codec.read(source);
        let state = EditorState.create({doc: read.doc, plugins: [history()]});
        steps.forEach((at, step) => {
            state = state.apply(closeHistory(state.tr.insertText(`改${String(step)}`, at(state))));
            const written = codec.write(state.doc, read.map);
            if (!written.ok) throw new Error(written.reason);
            const tr = state.tr;
            written.accept(tr);
            state = state.apply(tr.setMeta("addToHistory", false));
        });
        while (undo(state, (tr) => {
            state = state.apply(tr);
        }));
        const again = codec.write(state.doc, read.map);
        if (!again.ok) throw new Error(again.reason);
        return again.text;
    }

    it("撤销重建出的是内容相同的新节点：仍写回原文（实体、转义、下划线式标题、表格的对齐行、属性的单引号）", () => {
        for (const source of ["甲&amp;乙\n\n丙\n", "他__说__了 \\* 号\n", "Title\n=====\n\n正文\n", "| a | b |\n|---|:-:|\n| 1 | 22 |\n", "开<comment id='c1' body='意见'>one</comment>\r\n \r\n<comment id='c1'>two</comment>\r\n"]) {
            expect(editThenUndo(source, [(state) => textPositions(state)[0] as number, (state) => textPositions(state).at(-1) as number])).toBe(source);
        }
    });
});

describe("重载（“状态与转换”：外部修改后重新读入，哪些块被编辑过按新的原文重新计）", () => {
    // 第一块用实体写：重新写出时会写成 `&`，写原文才保持 `&amp;`。
    const before = "* 甲&amp;\n\n乙\n\n丙\n";
    const after = "* 甲&amp;\n\n乙\n\n丙丁\n";

    it("只换不同的那一段：没变的块还是编辑器里原来的节点，不编辑写出等于新正文；之后只改一块，其余写新原文", () => {
        const read = codec.read(before);
        const tr = new Transform(read.doc);
        const map = codec.reload(tr, after);
        expect(tr.doc.child(0)).toBe(read.doc.child(0));
        expect(tr.doc.eq(codec.read(after).doc)).toBe(true);
        const unchanged = codec.write(tr.doc, map);
        expect(unchanged.ok && unchanged.text).toBe(after);
        expect(accepted(append(tr.doc, 1, "改"), map).text).toBe("* 甲&amp;\n\n乙改\n\n丙丁\n");
    });

    it("撤销越过重载回到之前的节点：它们按被编辑过的块写出，读回与那时相同；新原文里没变的块字节不变", () => {
        const read = codec.read(before);
        const edited = append(read.doc, 2, "戊");
        const tr = new Transform(edited);
        const map = codec.reload(tr, after);
        // 撤销到重载之前的文档（撤销历史里的节点）。
        const undone = codec.write(edited, map);
        expect(undone.ok && undone.text).toBe("* 甲&amp;\n\n乙\n\n丙戊\n");
        expect(undone.ok && codec.read(undone.text).doc.eq(edited)).toBe(true);
    });

    it("有批注时只换不同的那一段：没变的批注还是编辑器里原来的节点（身份不因重新读入而变）", () => {
        const read = codec.read("<comment body=\"意见\">甲</comment>\n\n中间\n\n尾\n");
        const tr = new Transform(read.doc);
        codec.reload(tr, "<comment body=\"意见\">甲</comment>\n\n中间\n\n尾外改\n");
        expect(tr.doc.child(0)).toBe(read.doc.child(0));
        expect(tr.doc.child(1)).toBe(read.doc.child(1));
        expect(tr.doc.textContent).toBe("甲中间尾外改");
    });

    it("frontmatter 也按新正文", () => {
        const read = codec.read("---\na: 1\n---\n甲\n");
        const tr = new Transform(read.doc);
        const map = codec.reload(tr, "---\na: 2\n---\n甲\n");
        const result = codec.write(append(tr.doc, 0, "乙"), map);
        expect(result.ok && result.text).toBe("---\na: 2\n---\n甲乙\n");
    });
});

describe("写不出时的抢救正文（editor 输出 61）", () => {
    it("写不出的那一块换成纯文字，其余照常写出", () => {
        // 段首是会开启 HTML 块的原样片段：读回会成为 HTML 块（方言 Spec 输出 9），哪一级写法都写不出。
        const read = codec.read("前\n\n后\n");
        const blocked = schema.nodes.paragraph!.create(null, [schema.nodes.rawInline!.create({raw: "<div>"}), schema.text("文字")]);
        const doc = read.doc.replace(read.doc.child(0).nodeSize, read.doc.content.size, new Slice(Fragment.from(blocked), 0, 0));
        const result = codec.write(doc, read.map);
        expect(result.ok).toBe(false);
        // 原样片段的原文也作为文字留下（转义后读回仍是这几个字）。
        if (!result.ok) expect(result.fallback()).toBe("前\n\n\\<div>文字\n");
    });

    it("没闭合的原样块吞掉了后面新写的一段：原样块的原文与新的一段都作为文字留下", () => {
        const read = codec.read("前\n\n<!-- 没闭合的注释\n");
        const doc = read.doc.copy(read.doc.content.addToEnd(schema.nodes.paragraph!.create(null, schema.text("新写的一段"))));
        const result = codec.write(doc, read.map);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const rescued = result.fallback();
            expect(rescued).toContain("没闭合的注释");
            expect(rescued).toContain("新写的一段");
            expect(rescued.startsWith("前\n\n")).toBe(true);
        }
    });

    it("两块写不出：各自换成纯文字，中间正常的粗体与代码块照常写出", () => {
        const read = codec.read("甲\n\n**粗体**\n\n```js\nconsole.log(1)\n```\n\n乙\n");
        const broken = (text: string): PMNode => schema.nodes.paragraph!.create(null, [schema.nodes.rawInline!.create({raw: "<div>"}), schema.text(text)]);
        const children: PMNode[] = [];
        read.doc.forEach((node, _offset, index) => children.push(index === 0 ? broken("甲") : index === read.doc.childCount - 1 ? broken("乙") : node));
        const result = codec.write(schema.nodes.doc!.create(null, children), read.map);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fallback()).toBe("\\<div>甲\n\n**粗体**\n\n```js\nconsole.log(1)\n```\n\n\\<div>乙\n");
    });
});
