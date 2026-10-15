/**
 * 编解码器的读入与原样写回（docs/specs/workspace/markdown-dialect.md 输出 1、4–7、9、19、20、25、26）。语料在 `corpus/`，
 * 语言与 schema 都是编辑器用的那一份（`markdownLanguage()`、`getSchema(language.extensions)`），不经 DOM。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import {describe, expect, it} from "bun:test";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";

const language = markdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const CORPUS = join(import.meta.dir, "corpus");
const corpus = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort();

/** 读出的正文（只留结构与文字，属性里只留写法），便于写明确的期望。 */
const shape = (source: string): JSONContent[] => (codec.read(source).doc.toJSON().content ?? []) as JSONContent[];
const paragraph = (source: string): JSONContent[] => (shape(source)[0]?.content ?? []) as JSONContent[];

describe("语料：读入与原样写回", () => {
    for (const name of corpus) {
        it(`${name}：不编辑写回逐字节相等，读出的文档合 schema，没有读不出的块`, () => {
            const source = readFileSync(join(CORPUS, name), "utf8");
            const read = codec.read(source);
            expect(read.problems).toEqual([]);
            expect(() => read.doc.check()).not.toThrow();
            const written = codec.write(read.doc, read.map);
            expect(written.ok && written.text).toBe(source);
        });
    }
});

describe("读入的明确期望", () => {
    it("中文引号、括号贴着强调也是强调（输出 6）；单个 ~ 是文字（输出 7）", () => {
        expect(paragraph("他说：**“走吧。”**然后离开。")).toEqual([
            {type: "text", text: "他说："},
            {type: "text", text: "“走吧。”", marks: [{type: "bold", attrs: {markdown: "**"}}]},
            {type: "text", text: "然后离开。"},
        ]);
        expect(paragraph("约5~6人，走了7~8天。")).toEqual([{type: "text", text: "约5~6人，走了7~8天。"}]);
        expect(paragraph("~~删~~")).toEqual([{type: "text", text: "删", marks: [{type: "strike", attrs: {markdown: "~~"}}]}]);
    });

    it("段内单换行与三种硬换行写法都读成带写法的换行（输出 5）", () => {
        const breaks = paragraph("甲\n乙  \n丙\\\n丁<br>戊").filter((node) => node.type === "hardBreak").map((node) => node.attrs?.markdown);
        expect(breaks).toEqual(["newline", "spaces", "backslash", "br"]);
    });

    it("实体按 HTML5 表解码一次：&nbsp;、&amp;nbsp;、\\&nbsp; 三者不同（输出 4）", () => {
        expect(paragraph("甲&nbsp;乙")).toEqual([{type: "text", text: "甲 乙"}]);
        expect(paragraph("甲&amp;nbsp;乙")).toEqual([{type: "text", text: "甲&nbsp;乙"}]);
        expect(paragraph("甲\\&nbsp;乙")).toEqual([{type: "text", text: "甲&nbsp;乙"}]);
        expect(paragraph("&#20013;&#x200B;&unknown;")).toEqual([{type: "text", text: "中​&unknown;"}]);
    });

    it("能读的 HTML 形式的强调保持标签名；<u> 与其它标签是原样片段，++ 是文字（输出 25、26）", () => {
        expect(paragraph("<b>粗</b><em>斜</em><s>删</s>")).toEqual([
            {type: "text", text: "粗", marks: [{type: "bold", attrs: {markdown: "b"}}]},
            {type: "text", text: "斜", marks: [{type: "italic", attrs: {markdown: "em"}}]},
            {type: "text", text: "删", marks: [{type: "strike", attrs: {markdown: "s"}}]},
        ]);
        expect(paragraph("<u>下</u>、C++和C++")).toEqual([
            {type: "rawInline", attrs: {raw: "<u>下</u>"}},
            {type: "text", text: "、C++和C++"},
        ]);
    });

    it("任务项与普通项混在一起时拆成相邻的两个列表；有序列表里的复选框是文字（输出 19）", () => {
        expect(shape("- [ ] 甲\n- [X] 乙\n- 丙").map((node) => node.type)).toEqual(["taskList", "bulletList"]);
        expect(shape("- [ ] 甲\n- [X] 乙")[0]?.content?.map((item) => [item.attrs?.checked, (item.attrs?.markdown as {check: string}).check])).toEqual([[false, " "], [true, "X"]]);
        expect(shape("1. [ ] 甲")[0]?.content?.[0]?.content?.[0]?.content).toEqual([{type: "text", text: "[ ] 甲"}]);
    });

    it("任务项里的引用式链接可以用后面才定义的引用", () => {
        const item = shape("- [ ] [甲][r]\n\n[r]: /dest")[0]?.content?.[0]?.content?.[0]?.content?.[0];
        expect(item?.marks?.[0]).toMatchObject({type: "link", attrs: {href: "/dest", markdown: {style: "reference", label: "r"}}});
    });

    it("表格单元格里转义的竖线是文字；引用定义、脚注、数学、HTML 注释是原样（输出 9、20）", () => {
        const table = shape("| a \\| b | c |\n|---|---|\n| 1 | 2 |")[0];
        expect(table?.content?.[0]?.content?.[0]?.content?.[0]?.content).toEqual([{type: "text", text: "a | b"}]);
        expect(shape("[1]: https://a.b")).toEqual([{type: "rawBlock", attrs: {raw: "[1]: https://a.b"}}]);
        expect(paragraph("文[^1]、$x^2$、$5 与 $6<!-- 注 -->").filter((node) => node.type === "rawInline").map((node) => node.attrs?.raw)).toEqual(["[^1]", "$x^2$", "<!-- 注 -->"]);
    });

    it("同名的第二条引用定义读成原样块，原文不丢", () => {
        expect(shape("[1]: https://a.com\n\n[1]: https://b.com").map((node) => [node.type, node.attrs?.raw])).toEqual([["rawBlock", "[1]: https://a.com"], ["rawBlock", "[1]: https://b.com"]]);
    });

    it("空行与空段落：两块之间 k+1 个空行是 k 个空段落；开头的换行各是一个；结尾最后一个换行是文件末尾", () => {
        expect(shape("甲\n\n乙").length).toBe(2);
        expect(shape("甲\n\n\n乙").map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
        expect(shape("\n甲").length).toBe(2);
        expect(shape("甲\n").length).toBe(1);
        expect(shape("甲\n\n").length).toBe(2);
        expect(shape("")).toEqual([{type: "paragraph"}]);
    });

    it("引用里没有内容时补一个占位段落，不读成原样块", () => {
        expect(shape(">")).toEqual([{type: "blockquote", content: [{type: "paragraph"}]}]);
    });

    it("写法属性：列表符号、有序分隔符与编号方式、标题写法、代码围栏", () => {
        expect(shape("* 甲\n* 乙")[0]?.attrs?.markdown).toEqual({marker: "*"});
        expect(shape("1) 甲\n1) 乙")[0]?.attrs?.markdown).toEqual({delimiter: ")", numbering: "same"});
        expect(shape("甲\n===")[0]?.attrs?.markdown).toEqual({style: "setext", char: "="});
        expect(shape("## 甲 ##")[0]?.attrs?.markdown).toEqual({style: "atx", closing: "##"});
        expect(shape("~~~js\nx\n~~~")[0]?.attrs).toMatchObject({language: "js", markdown: {fence: "~~~"}});
    });
});
