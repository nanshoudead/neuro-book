/**
 * 原文的解码与切章（docs/specs/story/ingest.md 的“原文与切章”、验收 6）。
 */

import {describe, expect, test} from "bun:test";

import {StoryError} from "../core/errors";
import {countChars, decodeUtf8, MAX_SOURCE_BYTES, splitChapters} from "./text";

function codeOf(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        if (error instanceof StoryError) return error.code;
        throw error;
    }
}

describe("切章（验收 6）", () => {
    const fortyChars = `第五章 ${"长".repeat(37)}`;
    const fortyOneChars = `第五章 ${"长".repeat(38)}`;
    const text = [
        "诡秘之主",
        "简介：一个关于蒸汽与机械的故事。",
        "",
        "第一卷 小丑",
        "楔子",
        "  雨夜。  ",
        "第1章 绯红",
        "第三回合开始了",
        "序言里提到的那个人",
        "第 2 章",
        "第３章",
        "第二十三章绯红",
        "第一卷 小丑 第四章 笔记",
        fortyChars,
        fortyOneChars,
        "第六章 他说「好」",
        "第七章 重名",
        "正文一段。",
        "第七章 重名",
        "番外 一",
        "尾声",
    ].join("\r\n");

    test("章标题、卷标题、开头的文字各按规则处理；不像标题的行留在所在章里", () => {
        const result = splitChapters(text);
        expect(result.chapters.map(chapter => [chapter.chapter, chapter.title, chapter.paragraphs])).toEqual([
            [1, "楔子", ["楔子", "雨夜。"]],
            [2, "第1章 绯红", ["第1章 绯红", "第三回合开始了", "序言里提到的那个人"]],
            [3, "第 2 章", ["第 2 章"]],
            [4, "第３章", ["第３章"]],
            [5, "第二十三章绯红", ["第二十三章绯红"]],
            [6, "第一卷 小丑 第四章 笔记", ["第一卷 小丑 第四章 笔记"]],
            [7, fortyChars, [fortyChars, fortyOneChars, "第六章 他说「好」"]],
            [8, "第七章 重名", ["第七章 重名", "正文一段。"]],
            [9, "第七章 重名", ["第七章 重名"]],
            [10, "番外 一", ["番外 一"]],
            [11, "尾声", ["尾声"]],
        ]);
        expect(result.preambleChars).toBe(countChars("诡秘之主简介：一个关于蒸汽与机械的故事。"));
        expect(result.volumeLines).toBe(1);
        expect(countChars(fortyChars)).toBe(40);
        expect(result.chapters[0]!.sha256).toMatch(/^[0-9a-f]{64}$/u);
    });

    test("一个章标题也没有：ingest_bad_text", () => {
        expect(codeOf(() => splitChapters("只是一段文字。\n又一段。"))).toBe("ingest_bad_text");
    });
});

describe("解码", () => {
    test("UTF-8 照常解码，开头的 BOM 去掉", () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("第一章\n正文")]);
        expect(decodeUtf8(bytes)).toBe("第一章\n正文");
    });

    test("不是 UTF-8（例如 GBK）、超过 32 MiB：ingest_bad_text", () => {
        const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]); // “第一章”的 GBK 编码
        expect(codeOf(() => decodeUtf8(gbk))).toBe("ingest_bad_text");
        expect(codeOf(() => decodeUtf8(new Uint8Array(MAX_SOURCE_BYTES + 1)))).toBe("ingest_bad_text");
    });
});
