/**
 * Markdown 预览行（Spec 验收 30）：折叠的思考与提醒露出的那一行。反例来自设计审查与真实模型的思考摘要。
 * 会话列表的时间（验收 26）：时刻都用 `new Date(年, 月, 日, 时, 分)` 按本地时区构造，不依赖机器在哪个时区。
 */

import {describe, expect, it} from "bun:test";

import {formatListTime, markdownPreviewLine} from "./format";

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

describe("formatListTime", () => {
    const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime();

    it("同一天写时刻，前一天写昨天，同一年写月日，更早加上年", () => {
        const now = at(10, 20, 9, 30);
        expect(formatListTime(at(10, 20, 0, 5), now, "zh-CN")).toBe("00:05");
        expect(formatListTime(at(10, 19, 23, 59), now, "zh-CN")).toBe("昨天");
        expect(formatListTime(at(10, 19, 23, 59), now, "en-US")).toBe("yesterday");
        expect(formatListTime(at(10, 18), now, "zh-CN")).toBe("10月18日");
        expect(formatListTime(at(10, 18), now, "en-US")).toBe("Oct 18");
        expect(formatListTime(at(12, 31, 12, 0, 2025), now, "zh-CN")).toBe("2025年12月31日");
    });

    it("按日历日比较：凌晨看昨晚是昨天，不按 24 小时算；跨夏令时结束的那天也一样", () => {
        expect(formatListTime(at(10, 19, 23, 50), at(10, 20, 0, 10), "zh-CN")).toBe("昨天");
        // 2026-10-25 欧洲夏令时结束，那天有 25 小时。
        expect(formatListTime(at(10, 25, 0, 10), at(10, 26, 0, 30), "zh-CN")).toBe("昨天");
        expect(formatListTime(at(10, 24, 23, 50), at(10, 26, 0, 30), "zh-CN")).toBe("10月24日");
    });

    it("晚于 now 的时刻（多机时钟差）按同一天写时刻", () => {
        expect(formatListTime(at(10, 21, 8, 0), at(10, 20, 9, 30), "zh-CN")).toBe("08:00");
    });
});
