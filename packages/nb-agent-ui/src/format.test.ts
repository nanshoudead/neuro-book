/**
 * Markdown 预览行（Spec 验收 30）：折叠的思考与提醒露出的那一行。反例来自设计审查与真实模型的思考摘要。
 */

import {describe, expect, it} from "bun:test";

import {markdownPreviewLine} from "./format";

describe("markdownPreviewLine", () => {
    it.each([
        ["**Finding 南嘉鱼 and the secret matrix**", "Finding 南嘉鱼 and the secret matrix"],
        // 真实记录（nb-story 问答日志）里模型把几段粗体小标题首尾相接写在一个思考块里。
        ["**Gathering later chapter arcs****Checking later chapter summaries**\n\n正文", "Gathering later chapter arcs"],
        ["## 第一节 ##", "第一节"],
        ["\n\n> - [x] 完成 **了**", "完成 了"],
        ["1) 第一步：*读*目录", "第一步：*读*目录"],
        ["他说：**“走吧。”**然后离开。", "他说：“走吧。”然后离开。"],
        ["==高亮== 与 ~~删~~ 与 <mark>标</mark>", "高亮 与 删 与 标"],
        ["_强调_ 与 *斜体* 与 __粗__", "强调 与 斜体 与 粗"],
        ["[链接](http://x) 与 ![图](a.png) 与 <https://a.b>", "链接 与 图 与 https://a.b"],
        ["```ts\nconst a = 1\n```", "const a = 1"],
        ["---\n| a | b |\n真正的第一行", "真正的第一行"],
    ])("%j → %j", (input, expected) => {
        expect(markdownPreviewLine(input)).toBe(expected);
    });

    it.each([
        "看 `a****b` 与 `**x**`",
        "snake_case_name 与 读取_章节_摘要",
        "2 * 3 * 4",
        "#伏笔 要回收",
        "*注：见下",
        "-5℃ 的早晨",
    ])("不误伤：%j", (input) => {
        expect(markdownPreviewLine(input)).toBe(input.replace(/`/gu, ""));
    });

    it("反斜杠转义还原成字符，不当作标记", () => {
        expect(markdownPreviewLine("\\*不是强调\\* 与 \\# 号")).toBe("*不是强调* 与 # 号");
    });

    it("流式生成到一半时不留落单的标记", () => {
        expect(markdownPreviewLine("**Finding X")).toBe("Finding X");
        expect(markdownPreviewLine("**Gathering arcs*")).toBe("Gathering arcs");
        expect(markdownPreviewLine("**Gathering arcs**")).toBe("Gathering arcs");
    });

    it("空文字与只有空白时给空串", () => {
        expect(markdownPreviewLine("")).toBe("");
        expect(markdownPreviewLine("  \n \n")).toBe("");
    });
});
