/**
 * 编辑器接入的读写（docs/specs/workspace/markdown-dialect.md 输出 2、“状态与转换”；docs/specs/workbench/editor.md 输出 61）：
 * 写出被接受后的写法回填（`accept`）、正文被别处改了之后的重载（`reload`）、写不出时的抢救正文（`fallback`）。事务用
 * ProseMirror 的 `Transform`，与编辑器派发的事务同一套步骤，不经 DOM。
 */

import {getSchema} from "@tiptap/core";
import {Fragment, Slice} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import type {SourceMap} from "./read";

const language = markdownLanguage();
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
        if (!result.ok) expect(result.fallback()).toBe("前\n\n文字\n");
    });
});
