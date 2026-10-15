/**
 * 编解码器不依赖 DOM：浏览器里（有 `DOMParser`）与没有 DOM 时读同一份语料得到同一棵树。
 * `@tiptap/markdown` 对行内 HTML 在两种环境下走不同分支，编解码器不能这样。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";

const CORPUS = join(__dirname, "corpus");
const language = markdownLanguage();
const codec = codecFor(getSchema([...language.extensions]), language);
const parser = globalThis.DOMParser;

afterEach(() => {
    globalThis.DOMParser = parser;
});

describe("有没有 DOM 读出来都一样", () => {
    for (const name of readdirSync(CORPUS).filter((file) => file.endsWith(".md")).sort()) {
        it(name, () => {
            const source = readFileSync(join(CORPUS, name), "utf8");
            expect(typeof parser).toBe("function");
            const withDom = codec.read(source).doc.toJSON();
            // @ts-expect-error 模拟没有 DOM 的环境（bun test、服务端）。
            globalThis.DOMParser = undefined;
            expect(codec.read(source).doc.toJSON()).toEqual(withDom);
        });
    }
});
