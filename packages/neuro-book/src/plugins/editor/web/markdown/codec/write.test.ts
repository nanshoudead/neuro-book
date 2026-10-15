/**
 * 写回（docs/specs/workspace/markdown-dialect.md 输出 2–5、10、19、20、25、场景 2、3、9）：重新写出的块的明确期望，与性质 2
 * “每块当作改过重新写出，读回与原来相同”。语言、schema 都是编辑器用的那一份。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import type {Mark, Node as PMNode} from "@tiptap/pm/model";
import {describe, expect, it} from "bun:test";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import {equivalent} from "./compare";

const language = markdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const CORPUS = join(import.meta.dir, "corpus");
const emphasis = new Set(["bold", "italic", "strike"]);

/** 把文档的第 index 个顶层节点换成内容相同的新对象（编辑器看来就是“改过了”）。 */
function touch(doc: PMNode, index: number): PMNode {
    const children: PMNode[] = [];
    doc.forEach((child, _offset, at) => children.push(at === index ? child.type.create(child.attrs, child.content, child.marks) : child));
    return doc.type.create(doc.attrs, children);
}

/** 一篇新文档（没有来源）写出来的正文。 */
function written(...blocks: PMNode[]): string {
    const read = codec.read("");
    const result = codec.write(schema.nodes.doc!.create(null, blocks), read.map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    return result.text;
}

const p = (...content: PMNode[]): PMNode => schema.nodes.paragraph!.create(null, content);
const t = (text: string, ...marks: string[]): PMNode => schema.text(text, marks.map((name) => schema.marks[name]!.create()));
const br = (): PMNode => schema.nodes.hardBreak!.create();

describe("性质 2：每块当作改过重新写出，读回与原来相同", () => {
    for (const name of readdirSync(CORPUS).filter((file) => file.endsWith(".md")).sort()) {
        it(name, () => {
            const source = readFileSync(join(CORPUS, name), "utf8");
            const read = codec.read(source);
            for (let index = 0; index < read.doc.childCount; index += 1) {
                const doc = touch(read.doc, index);
                const result = codec.write(doc, read.map);
                expect(result.ok ? null : `${name} 第 ${index} 块：${result.reason}`).toBeNull();
                if (!result.ok) continue;
                const again = codec.read(result.text).doc;
                expect(again.childCount).toBe(doc.childCount);
                for (let at = 0; at < doc.childCount; at += 1) {
                    // 写法是否保持另由明确期望测：为分开相邻的列表，后一个会换符号。
                    expect(equivalent(doc.child(at), again.child(at), {styles: "canonical", emphasis, derived: language.derivedAttrs, markless: language.marklessInline}) ? null : `${name} 第 ${index} 块改过后，第 ${at} 块读回不同：${JSON.stringify(again.child(at).toJSON())}`).toBeNull();
                }
            }
        });
    }
});

describe("写出的明确期望", () => {
    it("给中文引号里的对白加粗，写出 ** 并且读得回来（场景 2）", () => {
        expect(written(p(t("他说："), t("“走吧。”", "bold"), t("然后离开。")))).toBe("他说：**“走吧。”**然后离开。");
    });

    it("最小转义：只有行首的有序列表符号与能配对的星号被转义（输出 4、场景 3）", () => {
        expect(written(p(t("1. 不是列表，约5~6人，a_b_c，[注]，5*3=15")))).toBe("1\\. 不是列表，约5~6人，a_b_c，[注]，5*3=15");
        expect(written(p(t("5*3*2=30")))).toBe("5\\*3*2=30");
        expect(written(p(t("# 不是标题")))).toBe("\\# 不是标题");
        expect(written(p(t("- 不是列表")))).toBe("\\- 不是列表");
        expect(written(p(t("a < b & c，&nbsp; 原样")))).toBe("a < b & c，\\&nbsp; 原样");
        expect(written(p(t("C:\\path\\to")))).toBe("C:\\path\\to");
    });

    it("被编辑的块保持原来的写法：列表符号、强调符号、标题写法（输出 2）", () => {
        for (const source of ["* 甲\n* 乙\n", "1) 甲\n1) 乙\n", "他 __粗__ 与 _斜_\n", "标题\n===\n", "看[这里][r]\n\n[r]: /dest\n"]) {
            const read = codec.read(source);
            const result = codec.write(touch(read.doc, 0), read.map);
            expect(result.ok && result.text).toBe(source);
        }
    });

    it("网址文字转义开头的一个字符，不被读成自动链接", () => {
        expect(written(p(t("见 https://example.com 与 www.example.com")))).toBe("见 https\\://example.com 与 www\\.example.com");
    });

    it("硬换行：段中写单换行，段首、段末与连续时写 <br>（输出 5）", () => {
        expect(written(p(t("甲"), br(), t("乙")))).toBe("甲\n乙");
        expect(written(p(t("甲"), br()))).toBe("甲<br>");
        expect(written(p(br(), t("甲")))).toBe("<br>甲");
        expect(written(p(t("甲"), br(), br(), t("乙")))).toBe("甲<br><br>乙");
        expect(written(p(br()))).toBe("<br>");
    });

    it("不间断空格与零宽字符写成实体；行首行尾的空格写成实体（输出 4）", () => {
        expect(written(p(t("甲\u00a0乙\u200b丙")))).toBe("甲&nbsp;乙&#x200B;丙");
        expect(written(p(t("  缩进")))).toBe("&#x20; 缩进");
        expect(written(p(t("结尾 ")))).toBe("结尾&#x20;");
        expect(written(schema.nodes.heading!.create({level: 1}, [t("\u3000\u3000章")]))).toBe("# &#x3000;\u3000章");
        // 只有全角空格的一行：marked 把它当成空行，列表项会在这里断开。
        const item = schema.nodes.listItem!.create(null, [p(t("\u3000")), p(t("\u3000正文"))]);
        expect(written(schema.nodes.bulletList!.create(null, [item]))).toBe("- &#x3000;\n\n  \u3000正文");
    });

    it("强调两端的空白移到外面", () => {
        expect(written(p(t("甲"), t(" 粗 ", "bold"), t("乙")))).toBe("甲 **粗** 乙");
    });

    it("规范写法：列表、任务列表、引用、代码块、分割线、表格（输出 10、20）", () => {
        const item = (...blocks: PMNode[]): PMNode => schema.nodes.listItem!.create(null, blocks);
        expect(written(schema.nodes.bulletList!.create(null, [item(p(t("甲"))), item(p(t("乙")))]))).toBe("- 甲\n- 乙");
        expect(written(schema.nodes.orderedList!.create({start: 1}, [item(p(t("甲"))), item(p(t("乙")))]))).toBe("1. 甲\n2. 乙");
        expect(written(schema.nodes.taskList!.create(null, [schema.nodes.taskItem!.create({checked: true}, [p(t("甲"))]), schema.nodes.taskItem!.create({checked: false}, [p(t("乙"))])]))).toBe("- [x] 甲\n- [ ] 乙");
        expect(written(schema.nodes.blockquote!.create(null, [p(t("甲")), p(t("乙"))]))).toBe("> 甲\n>\n> 乙");
        expect(written(schema.nodes.blockquote!.create(null, [p()]))).toBe(">");
        expect(written(schema.nodes.codeBlock!.create({language: "js"}, [t("a ```\nb")]))).toBe("```js\na ```\nb\n```");
        expect(written(schema.nodes.codeBlock!.create({language: null}, [t("```\nb")]))).toBe("````\n```\nb\n````");
        expect(written(schema.nodes.horizontalRule!.create())).toBe("---");
        const cell = (type: string, text: string, align: string | null = null): PMNode => schema.nodes[type]!.create({align}, [p(t(text))]);
        const row = (...cells: PMNode[]): PMNode => schema.nodes.tableRow!.create(null, cells);
        expect(written(schema.nodes.table!.create(null, [row(cell("tableHeader", "a | b", "left"), cell("tableHeader", "c")), row(cell("tableCell", "1"), cell("tableCell", "2"))]))).toBe("| a \\| b | c |\n| :-- | --- |\n| 1 | 2 |");
    });

    it("容器里相邻的同类列表换符号；不能打断段落的子列表前空一行（输出 3）", () => {
        const item = (...blocks: PMNode[]): PMNode => schema.nodes.listItem!.create(null, blocks);
        const bullet = (...items: PMNode[]): PMNode => schema.nodes.bulletList!.create(null, items);
        expect(written(schema.nodes.blockquote!.create(null, [bullet(item(p(t("甲")))), bullet(item(p(t("乙"))))]))).toBe("> - 甲\n>\n> * 乙");
        // 空的列表项不能打断段落（会读成下划线式标题）。
        expect(written(bullet(item(p(t("甲")), bullet(item(p())))))).toBe("- 甲\n\n  -");
        // 只有换行的段落写成独占一行的 `<br>`，那是 HTML 块，会吞掉紧接着的一行。
        expect(written(bullet(item(p(br()), bullet(item(p(t("乙")))))))).toBe("- <br>\n\n  - 乙");
    });

    it("挨着的两段行内代码写法不同时合成一段写", () => {
        const code = (count: number): Mark => schema.marks.code!.create({markdown: count});
        expect(written(p(schema.text("甲", [code(1)]), schema.text("乙`", [code(2)])))).toBe("`` 甲乙` ``");
    });

    it("表格单元格里的换行写成 <br>，读回仍是一个单元格", () => {
        const cell = (type: string, ...content: PMNode[]): PMNode => schema.nodes[type]!.create(null, [p(...content)]);
        const row = (...cells: PMNode[]): PMNode => schema.nodes.tableRow!.create(null, cells);
        expect(written(schema.nodes.table!.create(null, [row(cell("tableHeader", t("a"))), row(cell("tableCell", t("甲"), br(), t("乙")))]))).toBe("| a |\n| --- |\n| 甲<br>乙 |");
    });

    it("空段落属于间隔：两段之间一个空段落写成两个空行；整篇只剩一个空段落写成空正文（场景 9）", () => {
        expect(written(p(t("甲")), p(), p(t("乙")))).toBe("甲\n\n\n乙");
        expect(written(p())).toBe("");
    });
});

describe("间隔与撤销", () => {
    it("在文末接着写一段：前面的块与间隔、文末的引用定义都原样（场景 8）", () => {
        const source = "看[这里][1]。\n\n[1]: https://a.com\n";
        const read = codec.read(source);
        const doc = read.doc.type.create(null, [...Array.from({length: read.doc.childCount}, (_, index) => read.doc.child(index)), p(t("新的一段"))]);
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe("看[这里][1]。\n\n[1]: https://a.com\n\n新的一段\n");
    });

    it("删掉引用定义：引用它的链接所在块没动，但读回不同，改写成行内链接", () => {
        const read = codec.read("看[这里][1]。\n\n[1]: https://a.com\n");
        const doc = read.doc.type.create(null, [read.doc.child(0)]);
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe("看[这里](https://a.com)。\n");
    });

    it("同名定义换了先后：链接的地址变了，改写成行内链接（同名的取第一条）", () => {
        // 中间隔几段，让后一条定义落在链接所在的读回窗口外面。
        const middle = "\n\n一\n\n二\n\n三\n\n四\n\n五";
        const read = codec.read(`看[这][1]。\n\n[1]: https://a.com${middle}\n\n[1]: https://b.com\n`);
        const children = Array.from({length: read.doc.childCount}, (_, index) => read.doc.child(index));
        const doc = read.doc.type.create(null, [children[0]!, children[7]!, ...children.slice(2, 7), children[1]!]);
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe(`看[这](https://a.com)。\n\n[1]: https://b.com${middle}\n\n[1]: https://a.com\n`);
    });

    it("两个同符号列表之间的段落删掉：后一个列表换符号，读回仍是两个列表", () => {
        const read = codec.read("- 甲\n\n中间\n\n- 乙\n");
        const doc = read.doc.type.create(null, [read.doc.child(0), read.doc.child(2)]);
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe("- 甲\n\n* 乙\n");
    });

    it("没闭合的代码围栏后面新写一段：代码块补上闭合", () => {
        const read = codec.read("```\ncode\n");
        const doc = read.doc.type.create(null, [read.doc.child(0), p(t("新段"))]);
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe("```\ncode\n```\n\n新段\n");
    });

    it("撤销到底：中间插过空段落、一块原文读成的两个节点只编辑过一个，写出仍与原文逐字节相同", () => {
        // 任务列表与普通列表项在原文里是一个列表，编辑器里是两个节点。
        const source = "甲\n  \n乙\n\n- [ ] 待办\n- 普通\n";
        const read = codec.read(source);
        const [first, second, tasks, rest] = Array.from({length: read.doc.childCount}, (_, index) => read.doc.child(index)) as [PMNode, PMNode, PMNode, PMNode];
        const edits = [
            read.doc.type.create(null, [first, p(), second, tasks, rest]),
            read.doc.type.create(null, [first, second, tasks.type.create(tasks.attrs, [tasks.child(0).type.create({checked: true}, tasks.child(0).content)]), rest]),
        ];
        for (const edited of edits) {
            const result = codec.write(edited, read.map);
            expect(result.ok).toBe(true);
            if (result.ok) result.record();
            expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
        }
    });

    it("撤销到底：删掉不相邻的引用定义后引用改写成了行内链接，撤销回来仍写回引用式", () => {
        const source = "看[这][2]。\n\n[1]: https://a.com\n\n[2]: https://b.com\n";
        const read = codec.read(source);
        const result = codec.write(read.doc.type.create(null, [read.doc.child(0), read.doc.child(1)]), read.map);
        expect(result.ok && result.text).toBe("看[这](https://b.com)。\n\n[1]: https://a.com\n");
        if (result.ok) result.record();
        expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
    });

    it("写回被接受后再撤销回打开时的文档：写出与原文逐字节相同", () => {
        const source = "# 标题\n正文\n\n- 甲\n- 乙\n";
        const read = codec.read(source);
        const edited = touch(read.doc, 1);
        const first = codec.write(edited, read.map);
        expect(first.ok).toBe(true);
        if (first.ok) first.record();
        expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
    });
});
