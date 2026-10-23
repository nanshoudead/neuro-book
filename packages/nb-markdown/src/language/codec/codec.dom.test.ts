/**
 * 编解码器不依赖 DOM：浏览器里（有 `DOMParser`）与没有 DOM 时读同一份语料得到同一棵树。
 * `@tiptap/markdown` 对行内 HTML 在两种环境下走不同分支，编解码器不能这样。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import {afterEach, describe, expect, it} from "vitest";

import {defaultMarkdownLanguage} from "../syntax";
import {codecFor} from "./codec";

const CORPUS = join(__dirname, "corpus");
const language = defaultMarkdownLanguage();
const codec = codecFor(getSchema([...language.extensions]), language);
const parser = globalThis.DOMParser;

/** 批注的 `key` 每次读入都新分配（只在内存里区分批注）：按出现的先后换成编号再比。 */
function withoutKeys(json: unknown): unknown {
    const keys = new Map<unknown, number>();
    return JSON.parse(JSON.stringify(json), (name, value: unknown) => {
        if (name !== "key" || value === null) return value;
        if (!keys.has(value)) keys.set(value, keys.size);
        return keys.get(value);
    });
}

afterEach(() => {
    globalThis.DOMParser = parser;
});

describe("有没有 DOM 读出来都一样", () => {
    for (const name of readdirSync(CORPUS).filter((file) => file.endsWith(".md")).sort()) {
        it(name, () => {
            const source = readFileSync(join(CORPUS, name), "utf8");
            expect(typeof parser).toBe("function");
            const withDom = withoutKeys(codec.read(source).doc.toJSON());
            // @ts-expect-error 模拟没有 DOM 的环境（bun test、服务端）。
            globalThis.DOMParser = undefined;
            expect(withoutKeys(codec.read(source).doc.toJSON())).toEqual(withDom);
        });
    }
});
