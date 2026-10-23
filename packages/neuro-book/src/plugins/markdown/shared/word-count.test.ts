/**
 * 写作字数（docs/specs/workbench/editor.md 输出 27；不计的方言与原样内容见 docs/specs/workspace/markdown-dialect.md 的“副作用与
 * 数据”）。与编辑器读出的正文逐块对照的一致性测试在 `plugins/markdown/web/word-count.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {BUILTIN_DIALECTS} from "./dialects";
import {countWords, dialectTable} from "./word-count";

/** 内置方言的声明表：产品里每个实例都有它们（插件描述的顶层贡献）。 */
const BUILTIN = dialectTable(Object.values(BUILTIN_DIALECTS).map((declaration) => ({declaration})));
const count = (text: string): number => countWords(text, BUILTIN);

describe("字数", () => {
    it("汉字、假名、谚文每字计 1；拉丁字母与数字连在一起算一个词，可夹撇号与连字符", () => {
        expect(count("他把灯放低一些。")).toBe(7);
        expect(count("ひらがなカタカナ한국어")).toBe(11);
        expect(count("Don't stop, well-known 2026 rain’s end")).toBe(6);
    });

    it("中文与数字、字母紧挨着时分开数", () => {
        expect(count("第3章写于2026年")).toBe(7);
        expect(count("用Monaco写")).toBe(3);
    });

    it("标点、空白与 Markdown 标记不计；开头的 frontmatter 不计，正文里的分隔线照常不计", () => {
        expect(count("# 标题\n\n- **加粗** 与 _斜体_\n\n> 引用")).toBe(9);
        expect(count("---\ntitle: 第三章\ntags: [a, b]\n---\n\n雨下了一整夜。")).toBe(6);
        expect(count("---\r\ntitle: x\r\n---\r\n雨")).toBe(1);
        expect(count("甲\n\n---\n\n乙")).toBe(2);
        expect(count("")).toBe(0);
    });

    it("开头的 BOM 不挡 frontmatter：文件服务保留 BOM 的正文与去掉 BOM 的正文字数相同", () => {
        expect(count("﻿---\ntitle: Hidden\n---\n正文")).toBe(2);
        expect(count("---\ntitle: Hidden\n---\n正文")).toBe(2);
        expect(count("﻿雨")).toBe(1);
    });

    it("方言标签与属性不计（批注意见、注音、译文、颜色、对齐），标签中间的正文照常计", () => {
        expect(count("她抬头<comment body=\"节奏太快\">看了他一眼</comment>，按 <kbd>Ctrl</kbd> 保存。")).toBe(11);
        expect(count("<comment id=\"c1\" body=\"整段的意见\">\n老人走向祭坛。\n</comment>")).toBe(6);
        expect(count("<ruby text=\"hàn zì\">汉字</ruby>与<ruby>汉字<rt>hàn zì</rt></ruby>")).toBe(5);
        expect(count("<bilingual text=\"老人缓缓走向祭坛。\">\nThe old man walked.\n</bilingual>")).toBe(4);
        expect(count("<span style=\"color: red\">红字</span>与<mark style=\"background-color: yellow\">黄底</mark>，x<sup>2</sup>")).toBe(6);
        expect(count("<align value=\"center\">\n居中\n</align>")).toBe(2);
        expect(count("正文<strong>粗</strong><br>Word<BR/>Next")).toBe(5);
    });

    it("原样块与原样片段不计：方言之外的 HTML、HTML 注释、数学、脚注、引用定义与可渲染 HTML", () => {
        expect(count("按 <kbd>Ctrl</kbd> 与 <u>下划线</u> 保存<!-- 注释 -->。Vec<String> 列表")).toBe(7);
        expect(count("甲\n\n<div>\n块级 HTML\n</div>\n\n乙")).toBe(2);
        expect(count("<details>\n<summary>展开</summary>\n\n内容\n</details>\n\n乙")).toBe(1);
        expect(count("<script>\nlet 脚本;\n\n</script>\n乙")).toBe(1);
        expect(count("<!--\n多行\n注释\n-->\n乙")).toBe(1);
        expect(count("<kbd>\n没配上的标签独占一行\n\n乙")).toBe(1);
        expect(count("公式 $x^2$ 与 $5，价格 $3 和 $4。\n\n$$\na+b\n$$")).toBe(9);
        expect(count("正文[^1]。\n\n[^1]: 脚注内容。\n    续行。\n\n乙")).toBe(3);
        expect(count("甲\n\n[定义]: https://example.com/a\n  \"下一行的标题\"\n[另一个]: <b c>\n\n乙")).toBe(2);
        // 地址另起一行、标题跨行的定义同样整块不计；同一行地址后面跟着不是标题的字时不是定义。
        expect(count("[r]:\n  /dest\n")).toBe(0);
        expect(count("[r]: /dest\n  \"多行\n  标题\"\n")).toBe(0);
        expect(count("[r]: /dest 不是标题\n")).toBe(6);
        expect(count("<html>\n卡片的字\n\n空行后的字\n</html>\n\n正文<html>\n粘着的\n</html>")).toBe(2);
    });

    it("代码里的字照常计，其中的标签与实体是文字；围栏的语言名不计", () => {
        expect(count("`<comment body=\"x\">y</comment>` 与 `` `<sup>` ``")).toBe(7);
        expect(count("```js\n<b>粗</b> &amp;\n```")).toBe(4);
        expect(count("> ```\n> <!-- 不是注释 -->\n> ```")).toBe(4);
    });

    it("提示块的类型与任务项的勾选框是标记，不计；实体按解码后的字计，转义的字符是文字", () => {
        expect(count("> [!NOTE]- 折叠的标题\n> 内容")).toBe(7);
        // 标题是原文，按字面计：里面的 `$…$`、标签不当语法。
        expect(count("> [!NOTE] $伏笔$\n> 正文")).toBe(4);
        expect(count("> [!NOTE] <kbd>伏笔</kbd>\n> 正文")).toBe(6);
        expect(count("> 引用\n> [!NOTE] 不在第一行")).toBe(8);
        expect(count("- [ ] todo\n- [x] done")).toBe(2);
        expect(count("&#20013;&#25991;&copy;&nbsp;")).toBe(2);
        expect(count("\\<kbd> 与 \\&lt;")).toBe(3);
        expect(count("见 <https://a.example> 与 <me@b.cn>")).toBe(8);
    });

    it("方言的标签按声明计（docs/specs/workspace/markdown-syntaxes.md 输出 9）：声明了只去掉标签，skip 的连同中间的字去掉，没有声明的是原样片段", () => {
        const text = "按 <kbd>Ctrl</kbd> 保存。";
        const builtins = Object.values(BUILTIN_DIALECTS).map((declaration) => ({declaration}));
        const counted = dialectTable([...builtins, {declaration: {order: 80, inlineTags: ["kbd"]}}]);
        const skipped = dialectTable([...builtins, {declaration: {order: 80, inlineTags: ["kbd"], tagWords: [{tag: "kbd", content: "skip"}]}}]);
        expect(count(text)).toBe(3);
        expect(countWords(text, counted)).toBe(4);
        expect(countWords(text, skipped)).toBe(3);
        // 指纹只随计法变：计法相同的两份声明表指纹相同（输出 10、runtime.projects 输出 16）。
        expect(counted.fingerprint).not.toBe(BUILTIN.fingerprint);
        expect(skipped.fingerprint).toBe(BUILTIN.fingerprint);
        expect(dialectTable(builtins).fingerprint).toBe(BUILTIN.fingerprint);
    });

    it("病态输入不是平方级：几万个没闭合的 `<html>`、只有一个闭标签的成串开标签都很快数完", () => {
        for (const text of ["<html>\n\n正文\n\n".repeat(8000), `前${"<kbd>".repeat(8000)}字</kbd>后`, "$$\n\n甲\n\n".repeat(8000)]) {
            const started = performance.now();
            count(text);
            // 平方级时这几种要几秒到十几秒；上限放宽到 1 秒，只拦数量级。
            expect(performance.now() - started).toBeLessThan(1000);
        }
    });
});
