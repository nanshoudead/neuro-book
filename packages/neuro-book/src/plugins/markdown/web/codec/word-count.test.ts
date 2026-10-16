/**
 * 字数与编解码器一致（docs/specs/workspace/markdown-dialect.md 的“副作用与数据”、docs/specs/workbench/editor.md 输出 27）：字数的
 * 轻量扫描（`nbook/plugins/markdown/shared/word-count`）不计的内容，与编解码器读成方言属性、原样块与原样片段的内容相同。对照对象是语料里每一块
 * 原文：轻量扫描数原文，编解码器一侧数读出的正文文字（提示块的标题也是正文）。Spec 写明的已知偏差所在的块不对照。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {describe, expect, it} from "bun:test";

import {BUILTIN_DIALECTS} from "nbook/plugins/markdown/shared/dialects";
import {countWords, dialectTable} from "nbook/plugins/markdown/shared/word-count";

import {BUILTIN_SYNTAXES, markdownLanguage} from "../syntax";
import {codecFor} from "./codec";

const language = markdownLanguage();
const codec = codecFor(getSchema([...language.extensions]), language);
const CORPUS = join(import.meta.dir, "corpus");
const corpus = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort();
const TABLE = dialectTable(Object.values(BUILTIN_DIALECTS).map((declaration) => ({declaration})));
const DECLARED_TAGS = Object.values(BUILTIN_DIALECTS).flatMap((declaration) => [...(declaration.blockTags ?? []), ...(declaration.inlineTags ?? [])]);

/** 读出的正文文字：块与块、换行处断开，原样与其它不含文字的节点没有字。 */
function plain(node: PMNode): string {
    if (node.isText) return node.text ?? "";
    if (node.type.name === "hardBreak") return "\n";
    if (node.isInline) return "";
    const title = node.type.name === "callout" && typeof node.attrs.title === "string" ? [node.attrs.title] : [];
    if (node.isTextblock) return [...title, node.children.map(plain).join("")].join("\n");
    return [...title, ...node.children.map(plain)].join("\n");
}

/** 一段读出的文字的字数：放进围栏，扫描不把正文里的 `<…>`、`&…;` 再当标签与实体。 */
function wordsOf(text: string): number {
    const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length + 1)));
    return countWords(`${fence}\n${text}\n${fence}`, TABLE);
}

const DIALECT_TAG = new RegExp(`^<(?:${DECLARED_TAGS.join("|")})[\\s>]`, "iu");

/**
 * 这一块里有没有 Spec 写明的已知偏差：链接与图片的地址、有序列表的编号照常计入；写法不合法、整体读成原样的方言标签里的字
 * 照常计入。
 */
function deviates(node: PMNode): boolean {
    const own = (child: PMNode): boolean =>
        child.type.name === "image" ||
        child.type.name === "orderedList" ||
        child.marks.some((mark) => mark.type.name === "link") ||
        ((child.type.name === "rawInline" || child.type.name === "rawBlock") && DIALECT_TAG.test(String(child.attrs.raw)));
    let found = own(node);
    node.descendants((child) => {
        found ||= own(child);
    });
    return found;
}

describe("字数与编解码器一致", () => {
    it("方言标签名单：每种内置方言的声明与它的语法模块交出的相同（docs/specs/workspace/markdown-syntaxes.md 输出 3）", () => {
        expect(Object.keys(BUILTIN_SYNTAXES).sort()).toEqual(Object.keys(BUILTIN_DIALECTS).sort());
        for (const [id, syntax] of Object.entries(BUILTIN_SYNTAXES)) {
            const declaration = BUILTIN_DIALECTS[id];
            expect([id, new Set(Object.keys(syntax.blockOpens ?? {}))]).toEqual([id, new Set(declaration?.blockTags ?? [])]);
            expect([id, new Set(syntax.inlineTags ?? [])]).toEqual([id, new Set(declaration?.inlineTags ?? [])]);
        }
        expect(new Set([...language.blockTags, ...language.inlineTags])).toEqual(new Set(DECLARED_TAGS));
    });

    it("语料的每一块：轻量扫描数原文，与数读出的正文文字相同（已知偏差的块除外）", () => {
        let compared = 0;
        const differences: string[] = [];
        for (const name of corpus) {
            const read = codec.read(readFileSync(join(CORPUS, name), "utf8"));
            // 一段原文可能读成几个顶层块（例如任务列表与后面的普通列表）：按原文合起来数。
            const units = new Map<object, {raw: string; nodes: PMNode[]}>();
            read.doc.forEach((node) => {
                const unit = read.map.origins.get(node)?.[0]?.unit;
                if (unit === undefined) return;
                const entry = units.get(unit) ?? {raw: unit.raw, nodes: []};
                entry.nodes.push(node);
                units.set(unit, entry);
            });
            for (const {raw, nodes} of units.values()) {
                if (nodes.some(deviates)) continue;
                compared += 1;
                const light = countWords(raw, TABLE);
                const exact = nodes.reduce((sum, node) => sum + wordsOf(plain(node)), 0);
                if (light !== exact) differences.push(`${name}：${JSON.stringify(raw)} 扫描 ${light}，正文 ${exact}`);
            }
        }
        expect(differences).toEqual([]);
        // 对照的块数不能因为偏差判断写宽而悄悄变少。
        expect(compared).toBeGreaterThan(100);
    });
});
