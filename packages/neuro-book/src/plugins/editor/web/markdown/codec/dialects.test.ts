/**
 * 方言的明确期望（docs/specs/workspace/markdown-dialect.md 输出 9、11–17、23、24）：读出什么树、新建的内容写成什么字符串、
 * 改过的块怎样写回。往返性质在 `properties.test.ts` 与 `write.test.ts`，这里逐条写死 Spec 的例子与踩过的情形。
 */

import {getSchema} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import type {Mark, Node as PMNode} from "@tiptap/pm/model";
import {Transform} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import {equivalent} from "./compare";

const language = markdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const emphasis = new Set([...language.markWriters].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
const compareOptions = {styles: "canonical" as const, emphasis, ignored: language.uncomparedAttrs, markless: language.marklessInline, textOnly: language.textOnlyMarks};

const shape = (source: string): JSONContent[] => (codec.read(source).doc.toJSON().content ?? []) as JSONContent[];
const paragraph = (source: string): JSONContent[] => (shape(source)[0]?.content ?? []) as JSONContent[];
const children = (doc: PMNode): PMNode[] => Array.from({length: doc.childCount}, (_, index) => doc.child(index));

/** 每块都换成内容相同的新对象（编辑器看来都改过了）后写回。 */
function rewritten(source: string): string {
    const read = codec.read(source);
    const doc = read.doc.type.create(null, children(read.doc).map((child) => child.type.create(child.attrs, child.content, child.marks)));
    const result = codec.write(doc, read.map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    return result.text;
}

/** 一篇新文档（没有来源）写出来的正文，并断言读回与它相同。 */
function written(...blocks: PMNode[]): string {
    const doc = schema.nodes.doc!.create(null, blocks);
    const result = codec.write(doc, codec.read("").map);
    if (!result.ok) throw new Error(`写不出：${result.reason}`);
    const again = codec.read(result.text).doc;
    expect(again.childCount).toBe(doc.childCount);
    children(doc).forEach((child, index) => expect(equivalent(child, again.child(index), compareOptions)).toBe(true));
    return result.text;
}

const p = (...content: PMNode[]): PMNode => schema.nodes.paragraph!.create(null, content);
const t = (text: string, ...marks: Mark[]): PMNode => schema.text(text, marks);
const br = (): PMNode => schema.nodes.hardBreak!.create();
const mark = (name: string, attrs?: Record<string, unknown>): Mark => schema.marks[name]!.create(attrs);
const comment = (body: string, key: string, id: string | null = null): Mark => mark("comment", {body, key, id});
const commentOf = (node: JSONContent | undefined): Record<string, unknown> | undefined => node?.marks?.find((value) => value.type === "comment")?.attrs;

describe("批注（输出 11）", () => {
    it("行内批注不拆散句子；旧写法 <inline-comment> 能读，改过后写成 <comment>", () => {
        const source = "她抬头<comment body=\"这里节奏太快\">看了他一眼</comment>。";
        expect(shape(source)).toHaveLength(1);
        expect(commentOf(paragraph(source)[1])).toMatchObject({id: null, body: "这里节奏太快"});
        expect(rewritten(source)).toBe(source);
        expect(rewritten("前文<inline-comment body=\"需要核对\">原文</inline-comment>后文")).toBe("前文<comment body=\"需要核对\">原文</comment>后文");
    });

    it("块批注：开闭标签各自独占一行，中间可以有多块", () => {
        const source = "<comment body=\"整段视角混乱，需要重写\">\n老人走向祭坛。\n\n风里带着灰烬的味道。\n</comment>";
        const [block] = shape(source);
        expect(block).toMatchObject({type: "commentBlock", attrs: {body: "整段视角混乱，需要重写"}});
        expect(block?.content).toHaveLength(2);
        expect(rewritten(source)).toBe(source);
    });

    it("分截：同一个 id 的各截读成一条批注，意见取带 body 的那一截", () => {
        const doc = shape("123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>");
        const segments = doc.map((block) => commentOf(block.content?.at(-1)));
        expect(segments.map((attrs) => attrs?.body)).toEqual(["意见", "意见", "意见"]);
        expect(new Set(segments.map((attrs) => attrs?.key)).size).toBe(1);
    });

    it("没有 body 的截归之前最近的同 id 截，之前没有时归之后第一个，都没有时意见为空", () => {
        const doc = shape("<comment id=\"c2\">前</comment>\n\n<comment id=\"c2\" body=\"后面的意见\">后</comment>\n\n<comment id=\"c3\">孤</comment>");
        const [first, second, third] = doc.map((block) => commentOf(block.content?.[0]));
        expect(first?.body).toBe("后面的意见");
        expect(first?.key).toBe(second?.key);
        expect(third?.body).toBe("");
    });

    it("同一个 id 的几截带着不同的 body 时读成几条批注", () => {
        const doc = shape("<comment id=\"c1\" body=\"甲\">一</comment>\n\n<comment id=\"c1\">二</comment>\n\n<comment id=\"c1\" body=\"乙\">三</comment>");
        const keys = doc.map((block) => commentOf(block.content?.[0])?.key);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it("跨段的新批注写成分截：每段同一个 id，body 只在第一截；id 取文件里没用过的最小的 c 加数字", () => {
        const one = comment("意见", "a");
        expect(written(p(t("123"), t("one", one)), p(t("two", one)), p(t("three", one)))).toBe(
            "123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>",
        );
        const two = comment("新的", "b");
        expect(written(p(t("旧", comment("旧的", "c", "c1"))), p(t("甲", two)), p(t("乙", two)))).toBe(
            "<comment id=\"c1\" body=\"旧的\">旧</comment>\n\n<comment id=\"c2\" body=\"新的\">甲</comment>\n\n<comment id=\"c2\">乙</comment>",
        );
    });

    it("上一次写回分配的 id 沿用：前面新出现一条分截批注时，已经写好的那条不改号", () => {
        const one = comment("旧", "a");
        const doc = schema.nodes.doc!.create(null, [p(t("甲", one)), p(t("乙", one))]);
        const read = codec.read("");
        const first = codec.write(doc, read.map);
        expect(first.ok && first.text).toBe("<comment id=\"c1\" body=\"旧\">甲</comment>\n\n<comment id=\"c1\">乙</comment>");
        if (first.ok) first.record();
        const two = comment("新", "b");
        const second = codec.write(doc.type.create(null, [p(t("丙", two)), p(t("丁", two)), ...children(doc)]), read.map);
        expect(second.ok && second.text).toBe("<comment id=\"c2\" body=\"新\">丙</comment>\n\n<comment id=\"c2\">丁</comment>\n\n<comment id=\"c1\" body=\"旧\">甲</comment>\n\n<comment id=\"c1\">乙</comment>");
    });

    it("带意见的那一截所在的块被删掉：意见挪到剩下的第一截（上下文依赖，没编辑的块也重新写出）", () => {
        const read = codec.read("123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>\n");
        const doc = read.doc.type.create(null, children(read.doc).slice(1));
        const result = codec.write(doc, read.map);
        expect(result.ok && result.text).toBe("<comment id=\"c1\" body=\"意见\">two</comment>\n\n<comment id=\"c1\">three</comment>\n");
    });

    it("没有意见的截在前、带意见的截在后：不编辑时原样写回", () => {
        const source = "<comment id=\"c2\">前</comment>\n\n<comment id=\"c2\" body=\"后面的意见\">后</comment>\n";
        const read = codec.read(source);
        expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
    });

    it("两条批注重叠：在重叠的边界处拆成截，标签正确嵌套，读回仍是两条", () => {
        const outer = comment("外", "a");
        const inner = comment("内", "b");
        const text = written(p(t("甲", outer), t("乙", outer, inner), t("丙", inner)));
        expect(text).toBe("<comment body=\"外\">甲<comment id=\"c1\" body=\"内\">乙</comment></comment><comment id=\"c1\">丙</comment>");
    });

    it("属性值里的 \"、&、< 与换行写成实体，读回不变", () => {
        const body = "有\"引号\"与&和<尖括号>\n换行`[]\\";
        const text = written(p(t("转义", comment(body, "a"))));
        expect(text).toBe("<comment body=\"有&quot;引号&quot;与&amp;和&lt;尖括号>&#10;换行&#96;&#91;&#93;&#92;\">转义</comment>");
        expect(commentOf(paragraph(text)[0])?.body).toBe(body);
    });

    it("行内代码与代码块里的 </comment> 不是闭标签（输出 21）；段内换行可以在批注里", () => {
        const source = "<comment body=\"甲\">a `</comment>` b</comment>";
        expect(paragraph(source).map((node) => commentOf(node)?.body)).toEqual(["甲", "甲", "甲"]);
        const lines = paragraph("<comment body=\"跨\">第一行\n第二行</comment>");
        expect(lines.map((node) => [node.type, commentOf(node)?.body])).toEqual([["text", "跨"], ["hardBreak", "跨"], ["text", "跨"]]);
        expect(rewritten("<comment body=\"跨\">第一行\n第二行</comment>")).toBe("<comment body=\"跨\">第一行\n第二行</comment>");
    });

    it("别的标签属性值里的反引号不算行内代码，批注照常配对；表格里属性值的 | 写成 \\|", () => {
        // 两处属性值里的反引号之间夹着闭标签：当成行内代码就配不上了。
        expect(paragraph("<comment body=\"甲\"><ruby text=\"`x\">注</ruby></comment>与<ruby text=\"`y\">字</ruby>").map((node) => commentOf(node)?.body)).toEqual(["甲", undefined, undefined]);
        const cell = (type: string, content: PMNode[]): PMNode => schema.nodes[type]!.create(null, [p(...content)]);
        const row = (...cells: PMNode[]): PMNode => schema.nodes.tableRow!.create(null, cells);
        expect(written(schema.nodes.table!.create(null, [row(cell("tableHeader", [t("头")])), row(cell("tableCell", [t("格", comment("a|b", "a"))]))]))).toBe("| 头 |\n| --- |\n| <comment body=\"a\\|b\">格</comment> |");
    });

    it("配不上的标签保住原文：跨空行截断的块是原样块加闭标签的原样片段", () => {
        expect(shape("<comment>\npara1\n\npara2</comment>").map((block) => block.type)).toEqual(["rawBlock", "paragraph"]);
        expect(rewritten("<comment>\npara1\n\npara2</comment>")).toBe("<comment>\npara1\n\npara2</comment>");
        expect(shape("<comment>\na</comment>x</comment>")[0]?.type).toBe("rawBlock");
    });
});

describe("注音（输出 12）", () => {
    it("属性写法、<rt> 写法与没有注音的 <ruby> 都能读，改过后保持原来的写法", () => {
        const source = "远处站着<ruby text=\"hàn zì\">汉字</ruby>先生，<ruby>汉字<rt>hàn zì</rt></ruby>，<ruby>无</ruby>。";
        expect(paragraph(source).filter((node) => node.marks?.some((value) => value.type === "markdownRuby")).map((node) => node.marks?.[0]?.attrs?.text)).toEqual(["hàn zì", "hàn zì", ""]);
        expect(rewritten(source)).toBe(source);
    });

    it("注音的正文里有格式时整体为原样片段；单独成段的注音不被读成原样块", () => {
        expect(paragraph("<ruby text=\"x\">**粗**</ruby>")[0]?.type).toBe("rawInline");
        expect(shape("<ruby text=\"hàn zì\">汉字</ruby>")[0]?.type).toBe("paragraph");
    });

    it("新建的注音写成 text 属性；格式只盖住一部分时注音在格式外面断开，读回仍是一个注音", () => {
        const ruby = mark("markdownRuby", {text: "hàn zì"});
        expect(written(p(t("汉字", ruby)))).toBe("<ruby text=\"hàn zì\">汉字</ruby>");
        expect(written(p(t("汉", ruby, mark("bold")), t("字", ruby)))).toBe("**<ruby text=\"hàn zì\">汉</ruby>**<ruby text=\"hàn zì\">字</ruby>");
    });
});

describe("双语对照与对齐（输出 13、14）", () => {
    it("双语对照块读成带译文的块，原样写回", () => {
        const source = "<bilingual text=\"老人缓缓走向祭坛。\">\nThe old man walked toward the altar.\n</bilingual>";
        expect(shape(source)[0]).toMatchObject({type: "markdownBilingual", attrs: {text: "老人缓缓走向祭坛。"}});
        expect(rewritten(source)).toBe(source);
        expect(written(schema.nodes.markdownBilingual!.create({text: "译\"文"}, [p(t("原文"))]))).toBe("<bilingual text=\"译&quot;文\">\n原文\n</bilingual>");
    });

    it("对齐：同一行的写法等于只含一段的块，保持这种写法；后面的段落与行内 HTML 照常读", () => {
        const source = "<align value=\"center\">*— 在记忆断裂的地方，世界重新开始。—*</align>\n\n林屿睁开眼睛。<mark>符号在移动。</mark>";
        const doc = shape(source);
        expect(doc.map((block) => block.type)).toEqual(["markdownAlign", "paragraph"]);
        expect(doc[0]?.attrs?.align).toBe("center");
        expect(rewritten(source)).toBe(source);
    });

    it("块里一行以 ``` 开头、后面又有反引号：不是代码围栏，闭标签照常配对", () => {
        expect(shape("<align value=\"center\">\n``` `` ```甲\n</align>")[0]?.type).toBe("markdownAlign");
    });

    it("value 只能是 left、center、right、justify：left 照原样保留，其它值整体为原样块；新建的对齐写成块", () => {
        expect(shape("<align value=\"left\">\n左\n</align>")[0]).toMatchObject({type: "markdownAlign", attrs: {align: "left"}});
        expect(shape("<align value=\"bad\">\n丙\n</align>")[0]?.type).toBe("rawBlock");
        expect(written(schema.nodes.markdownAlign!.create({align: "right"}, [p(t("甲")), p(t("乙"))]))).toBe("<align value=\"right\">\n甲\n\n乙\n</align>");
    });
});

describe("文字标记（输出 15、24）", () => {
    it("颜色、高亮、上下标；不合规定的标签整体为原样片段", () => {
        const types = (source: string): Array<string | undefined> => paragraph(source).map((node) => node.marks?.[0]?.type ?? node.type);
        expect(types("<mark>高</mark><span style=\"color: #ef4444\">红</span><sup>2</sup><sub>3</sub>")).toEqual(["markdownHighlight", "markdownTextColor", "markdownSuperscript", "markdownSubscript"]);
        expect(types("<span>无色</span><span style=\"color: var(--x)\">引用</span><span style=\"color: red; font-size: 2em\">两条</span><sub a=\"1\">x</sub>")).toEqual(["rawInline", "rawInline", "rawInline", "rawInline"]);
        const source = "有<mark>高亮</mark>和<SPAN Style=\"color:red\">红字</SPAN>。";
        expect(rewritten(source)).toBe(source);
    });

    it("上标与下标、上标与上标互斥：给已有上标的文字再加上标，仍只有一个", () => {
        const doc = codec.read("x<sup>2</sup>").doc;
        const added = new Transform(doc).addMark(2, 3, mark("markdownSuperscript")).doc;
        expect(added.child(0).child(1).marks.map((value) => value.type.name)).toEqual(["markdownSuperscript"]);
        expect(new Transform(doc).addMark(2, 3, mark("markdownSubscript")).doc.child(0).child(1).marks.map((value) => value.type.name)).toEqual(["markdownSubscript"]);
    });

    it("==文本== 是高亮，按 CJK 友好的规则开闭；a == b 不是；写回保持 ==，新建的写成 <mark>", () => {
        expect(paragraph("他说：==“走吧。”==然后")[1]).toEqual({type: "text", text: "“走吧。”", marks: [{type: "markdownHighlight", attrs: {color: null, markdown: "=="}}]});
        expect(paragraph("a == b 与 ===x===")).toEqual([{type: "text", text: "a == b 与 ===x==="}]);
        expect(rewritten("他说：==“走吧。”==然后")).toBe("他说：==“走吧。”==然后");
        expect(written(p(t("高", mark("markdownHighlight"))))).toBe("<mark>高</mark>");
        expect(written(p(t("黄", mark("markdownHighlight", {color: "yellow"}))))).toBe("<mark style=\"background-color: yellow\">黄</mark>");
        expect(written(p(t("红", mark("markdownTextColor", {color: "#ff0000"}))))).toBe("<span style=\"color: #ff0000\">红</span>");
    });
});

describe("可渲染 HTML（输出 16）", () => {
    it("<html> 块的内容原样读写，里面的 ``` 不开代码围栏；内容里有独占一行的 </html> 时写不出", () => {
        const source = "<html>\n<div class=\"card\">状态面板</div>\n```\n<script>console.log(1)</script>\n</html>\n\n正文<comment body=\"x\">\n块\n</comment>\n";
        const doc = shape(source);
        expect(doc[0]).toEqual({type: "htmlEmbed", attrs: {html: "<div class=\"card\">状态面板</div>\n```\n<script>console.log(1)</script>"}});
        // 后面的宽容写法照常拆开：<html> 块里的 ``` 没有让后面的行都算进围栏。
        expect(doc.map((block) => block.type)).toEqual(["htmlEmbed", "paragraph", "commentBlock"]);
        const result = codec.write(schema.nodes.doc!.create(null, [schema.nodes.htmlEmbed!.create({html: "<p>\n</html>\n</p>"})]), codec.read("").map);
        expect(result.ok).toBe(false);
    });
});

describe("宽容写法（输出 17）", () => {
    it("开标签黏在正文后面、下面有闭标签：读成正文一段加一个块；不编辑原样写回，改过后补一个空行", () => {
        const source = "正文<comment body=\"x\">\n跨行的块\n</comment>\n";
        expect(shape(source).map((block) => block.type)).toEqual(["paragraph", "commentBlock"]);
        const read = codec.read(source);
        expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
        expect(rewritten(source)).toBe("正文\n\n<comment body=\"x\">\n跨行的块\n</comment>\n");
    });

    it("只有容器符号在前、下面没有闭标签、在代码围栏里时不拆", () => {
        expect(shape("> <comment body=\"y\">\n> 内容\n> </comment>")[0]?.content?.[0]?.type).toBe("commentBlock");
        expect(shape("没闭合<bilingual text=\"x\">\n悬尾").map((block) => block.type)).toEqual(["paragraph"]);
        expect(shape("```\n正文<comment>\n```\n</comment>\n")[0]?.type).toBe("codeBlock");
    });

    it("段末黏着开标签的段落被挪到闭标签上面：这一段重新写出，换行写成 <br>，开标签不再在行尾", () => {
        // 中间隔几段，闭标签在这一段的读回窗口外面，只有整篇检查看得到。
        const middle = "一\n\n二\n\n三\n\n四\n\n五\n\n六\n\n";
        const read = codec.read(`<align value="center">\n甲\n</align>\n\n${middle}没闭合<align value="center">\n悬尾\n`);
        const [align, ...rest] = children(read.doc) as [PMNode, ...PMNode[]];
        const glued = rest.pop() as PMNode;
        const result = codec.write(read.doc.type.create(null, [glued, ...rest, align]), read.map);
        expect(result.ok && result.text).toBe(`没闭合<align value="center"><br>悬尾\n\n${middle}<align value="center">\n甲\n</align>\n`);
    });
});

describe("提示块（输出 23）", () => {
    it("第一行是 [!类型]：类型、折叠标记与标题；不在第一行时是普通引用", () => {
        expect(shape("> [!WARNING]- 伏笔\n> 内容")[0]).toMatchObject({type: "callout", attrs: {type: "WARNING", fold: "-", title: "伏笔"}});
        expect(shape("> [!note]")[0]).toMatchObject({type: "callout", attrs: {type: "note", fold: null, title: null}});
        expect(shape("> 普通\n> [!NOTE] 不在第一行")[0]?.type).toBe("blockquote");
    });

    it("写回保持类型的大小写与折叠标记；新建的写成 > [!NOTE]", () => {
        expect(rewritten("> [!tip]+ 标题\n> 内容一\n>\n> 内容二")).toBe("> [!tip]+ 标题\n> 内容一\n>\n> 内容二");
        expect(written(schema.nodes.callout!.create(null, [p(t("甲"))]))).toBe("> [!NOTE]\n> 甲");
        expect(written(schema.nodes.callout!.create(null, [p()]))).toBe("> [!NOTE]");
    });
});

describe("原样（输出 9）", () => {
    it("方言之外的行内标签与伪标签是原样片段；独占一行的 <br> 是只有换行的一段", () => {
        expect(paragraph("按下 <key-combo keys=\"ctrl+s\">保存</key-combo> 即可。")[1]).toEqual({type: "rawInline", attrs: {raw: "<key-combo keys=\"ctrl+s\">保存</key-combo>"}});
        expect(paragraph("返回值是 Vec<String> 列表。")[1]).toEqual({type: "rawInline", attrs: {raw: "<String>"}});
        expect(shape("第一行\n\n<br>\n\n第二行").map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    });

    it("单个完整标签的原样片段不独占一行：挨着它的换行写成 <br>；整段只有它时写不出", () => {
        const raw = (): PMNode => schema.nodes.rawInline!.create({raw: "<bilingual text=\"x\">"});
        expect(written(p(raw(), br(), t("悬尾")))).toBe("<bilingual text=\"x\"><br>悬尾");
        expect(written(p(t("前"), br(), raw()))).toBe("前<br><bilingual text=\"x\">");
        const result = codec.write(schema.nodes.doc!.create(null, [p(raw())]), codec.read("").map);
        expect(result.ok).toBe(false);
    });
});
