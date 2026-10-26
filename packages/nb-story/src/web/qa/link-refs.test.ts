/**
 * 回答正文里的出处改成链接：只改纯文字，代码、链接、HTML、裸网址里的不动；全角写法照认、标点不变；流式时文末的先不改。
 */

import {describe, expect, test} from "bun:test";

import {defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";

import {linkRefs} from "./link-refs";

const lexer = () => defaultMarkdownLanguage().lexer();

describe("出处改成链接", () => {
    test("纯文字里的改，别处的不动", () => {
        const text = "见 38.12，`39.1` 与 [40.1](x) 和 https://a.b/1.2 以及 <span>41.2</span>\n\n```\n42.1\n```\n\n| 列 | 码 |\n|---|---|\n| 43.1 | `44.1` |\n\n- 45.1 **46.1—46.3**\n";
        expect(linkRefs(text, lexer)).toBe("见 [38.12](paragraph://38.12)，`39.1` 与 [40.1](x) 和 https://a.b/1.2 以及 <span>41.2</span>\n\n```\n42.1\n```\n\n| 列 | 码 |\n|---|---|\n| [43.1](paragraph://43.1) | `44.1` |\n\n- [45.1](paragraph://45.1) **[46.1—46.3](paragraph://46.1—46.3)**\n");
    });

    test("全角与连字符范围：链接文字保持原样，地址用标准写法；中文标点不变", () => {
        expect(linkRefs("见第３８．１２段，（另见20.3-20.5）：好！", lexer)).toBe("见第[３８．１２](paragraph://38.12)段，（另见[20.3-20.5](paragraph://20.3—20.5)）：好！");
    });

    test("流式：文末的出处可能没写完，先不改；后面有字了再改", () => {
        expect(linkRefs("读到 38.1", lexer, {streaming: true})).toBe("读到 38.1");
        expect(linkRefs("读到 38.12。", lexer, {streaming: true})).toBe("读到 [38.12](paragraph://38.12)。");
        expect(linkRefs("读到 38.12", lexer)).toBe("读到 [38.12](paragraph://38.12)");
    });

    test("没有出处时原样返回", () => {
        expect(linkRefs("没有出处的回答。", lexer)).toBe("没有出处的回答。");
    });
});
