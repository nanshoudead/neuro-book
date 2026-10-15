/**
 * 写回的随机性质（docs/specs/workspace/markdown-dialect.md 输出 1–5）：
 *
 * - 随机新建：随机生成的文档写出后读回，与原文档相同，且不出现写不出（性质 4）。
 * - 真实编辑序列（性质 5）：对语料文档施加随机的 ProseMirror 编辑，每一步写回（成功就 `record`，模拟提交被接受），整篇重读后
 *   与编辑后的文档相同；离这一步的编辑足够远的块（不挨着被编辑的块），原文字节仍在写出里。
 *
 * 种子固定，失败可以复现；本地要换种子时设 `MARKDOWN_PROPERTY_SEED`。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getSchema} from "@tiptap/core";
import type {Mark, Node as PMNode} from "@tiptap/pm/model";
import {Transform, findWrapping} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";
import fc from "fast-check";

import {markdownLanguage} from "../syntax";
import {LONE_TAG, OPENS_HTML_BLOCK} from "../syntax/raw";
import {codecFor} from "./codec";
import {equivalent} from "./compare";

const language = markdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const CORPUS = join(import.meta.dir, "corpus");
const sources = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort().map((name) => readFileSync(join(CORPUS, name), "utf8"));
const seed = Number(process.env.MARKDOWN_PROPERTY_SEED ?? 20261015);
const emphasis = new Set([...language.markWriters].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
const compareOptions = {styles: "canonical" as const, emphasis, ignored: language.uncomparedAttrs, markless: language.marklessInline, textOnly: language.textOnlyMarks};

/** 读回的整篇与文档是否相同（顶层逐个比，空段落也算）。 */
function sameDoc(doc: PMNode, text: string): string | null {
    const again = codec.read(text).doc;
    // 整篇没有内容时，几个空段落都读成一个（没有块就没有间隔）。
    const blank = (node: PMNode): boolean => node.childCount > 0 && Array.from({length: node.childCount}, (_, index) => node.child(index)).every((child) => child.type.name === "paragraph" && child.childCount === 0);
    if (blank(doc) && blank(again)) return null;
    if (again.childCount !== doc.childCount) return `块数不同：${doc.childCount} → ${again.childCount}`;
    for (let index = 0; index < doc.childCount; index += 1) {
        if (!equivalent(doc.child(index), again.child(index), compareOptions)) return `第 ${index} 块不同：${JSON.stringify(doc.child(index).toJSON())} → ${JSON.stringify(again.child(index).toJSON())}`;
    }
    return null;
}

// 文字里故意混进会被读成语法的字符。
const alphabet = fc.constantFrom("甲", "乙", "，", "。", "“", "”", "a", "1", " ", "*", "_", "~", "=", "[", "]", "(", ")", "<", ">", "&", "\\", "#", "-", "+", ".", "!", "$", "|", "`", ":", "/", "w");
const text = fc.array(alphabet, {minLength: 1, maxLength: 8}).map((chars) => chars.join(""));
const markNames = ["bold", "italic", "strike", "code"] as const;

let comments = 0;
/** 方言的标记：每次调用新建一个（批注带新的 `key`，是一条新批注）。 */
const dialectMarks: ReadonlyArray<(value: string) => Mark> = [
    (value) => schema.marks.comment!.create({body: `意见${value}`, key: `test-${(comments += 1)}`}),
    () => schema.marks.markdownHighlight!.create(),
    () => schema.marks.markdownHighlight!.create({color: "yellow"}),
    (value) => schema.marks.markdownRuby!.create({text: value}),
    () => schema.marks.markdownTextColor!.create({color: "#ff0000"}),
    () => schema.marks.markdownSuperscript!.create(),
];

describe("随机新建：写出读回相同，不出现写不出", () => {
    const inline = fc.array(fc.oneof(
        {weight: 6, arbitrary: fc.tuple(text, fc.subarray([...markNames])).map(([value, marks]) => schema.text(value, (marks.includes("code") ? ["code"] : marks).map((name) => schema.marks[name]!.create())))},
        {weight: 2, arbitrary: fc.tuple(text, fc.nat({max: dialectMarks.length - 1}), fc.subarray(["bold", "italic"])).map(([value, which, marks]) => schema.text(value, [(dialectMarks[which] as (value: string) => Mark)(value), ...marks.map((name) => schema.marks[name]!.create())]))},
        {weight: 1, arbitrary: fc.constant(null).map(() => schema.nodes.hardBreak!.create())},
        {weight: 1, arbitrary: text.map((value) => schema.text(value, [schema.marks.link!.create({href: "https://example.com/a"})]))},
    ), {minLength: 1, maxLength: 5});
    const paragraph = inline.map((content) => schema.nodes.paragraph!.create(null, content));
    const block = fc.oneof(
        {weight: 5, arbitrary: paragraph},
        {weight: 1, arbitrary: fc.tuple(fc.integer({min: 1, max: 3}), inline).map(([level, content]) => schema.nodes.heading!.create({level}, content.filter((node) => node.type.name !== "hardBreak")))},
        {weight: 1, arbitrary: fc.array(paragraph, {minLength: 1, maxLength: 3}).map((items) => schema.nodes.bulletList!.create(null, items.map((item) => schema.nodes.listItem!.create(null, [item]))))},
        {weight: 1, arbitrary: fc.array(paragraph, {minLength: 1, maxLength: 2}).map((items) => schema.nodes.taskList!.create(null, items.map((item, index) => schema.nodes.taskItem!.create({checked: index % 2 === 0}, [item]))))},
        {weight: 1, arbitrary: fc.array(paragraph, {minLength: 1, maxLength: 2}).map((items) => schema.nodes.blockquote!.create(null, items))},
        {weight: 1, arbitrary: fc.array(alphabet, {maxLength: 12}).map((chars) => schema.nodes.codeBlock!.create(null, chars.length === 0 ? [] : [schema.text(chars.join(""))]))},
        // 提示块的标题由界面设置：首尾没有空白，空的是 null。
        {weight: 1, arbitrary: fc.tuple(fc.array(paragraph, {minLength: 1, maxLength: 2}), text, fc.constantFrom("NOTE", "warning"), fc.constantFrom(null, "-", "+")).map(([items, title, type, fold]) => schema.nodes.callout!.create({type, title: title.trim() === "" ? null : title.trim(), fold}, items))},
        {weight: 1, arbitrary: fc.tuple(fc.array(paragraph, {minLength: 1, maxLength: 2}), text).map(([items, body]) => schema.nodes.commentBlock!.create({body}, items))},
        {weight: 1, arbitrary: fc.tuple(fc.array(paragraph, {minLength: 1, maxLength: 2}), fc.constantFrom("center", "right", "justify", "left")).map(([items, align]) => schema.nodes.markdownAlign!.create({align}, items))},
        {weight: 1, arbitrary: fc.tuple(fc.array(paragraph, {minLength: 1, maxLength: 2}), text).map(([items, translation]) => schema.nodes.markdownBilingual!.create({text: translation}, items))},
        {weight: 1, arbitrary: fc.array(alphabet, {maxLength: 12}).map((chars) => schema.nodes.htmlEmbed!.create({html: chars.join("")}))},
        {weight: 1, arbitrary: fc.tuple(inline, inline).map(([head, body]) => schema.nodes.table!.create(null, [
            schema.nodes.tableRow!.create(null, [schema.nodes.tableHeader!.create(null, [schema.nodes.paragraph!.create(null, head)])]),
            schema.nodes.tableRow!.create(null, [schema.nodes.tableCell!.create(null, [schema.nodes.paragraph!.create(null, body)])]),
        ]))},
    );
    it("400 篇", () => {
        fc.assert(fc.property(fc.array(block, {minLength: 1, maxLength: 5}), (blocks) => {
            const doc = schema.nodes.doc!.create(null, blocks);
            // GFM 表格里行内代码不能有“反斜杠加竖线”（切单元格时它总被当成转义的竖线），这是格式本身表达不了的，按写不出处理是对的。
            let pipeInTableCode = false;
            doc.descendants((node, _pos, parent) => {
                if (node.isText && parent?.type.name === "paragraph" && node.marks.some((mark) => mark.type.name === "code") && (node.text as string).includes("\\|")) pipeInTableCode ||= doc.resolve(0) !== null && insideTable(doc, node);
            });
            fc.pre(!pipeInTableCode);
            const result = codec.write(doc, codec.read("").map);
            expect(result.ok ? null : result.reason).toBeNull();
            if (result.ok) expect(sameDoc(doc, result.text)).toBeNull();
        }), {numRuns: 400, seed, verbose: 2});
    });
});

/**
 * 挨着这一步编辑的顶层下标（编辑后的文档里）：内容块是新的、或它前后的内容块与中间的空段落数变了，它与前后的内容块都算。
 */
function nearEdit(before: PMNode, after: PMNode): Set<number> {
    // 邻居按内容块算（空段落是间隔）：前后的内容块与中间的空段落数。
    const isEmpty = (node: PMNode): boolean => node.type.name === "paragraph" && node.childCount === 0;
    const near = new Set<number>();
    // 每个内容块：前后的内容块是不是同一个对象、中间的空段落数是否一样。
    const identity = (doc: PMNode): Map<PMNode, [PMNode | null, number, PMNode | null, number]> => {
        const content: Array<{node: PMNode; empties: number}> = [];
        let empties = 0;
        doc.forEach((node) => {
            if (isEmpty(node)) empties += 1;
            else {
                content.push({node, empties});
                empties = 0;
            }
        });
        const map = new Map<PMNode, [PMNode | null, number, PMNode | null, number]>();
        content.forEach(({node, empties: before}, index) => {
            const next = content[index + 1];
            map.set(node, [content[index - 1]?.node ?? null, before, next?.node ?? null, next?.empties ?? empties]);
        });
        return map;
    };
    const was = identity(before);
    const is = identity(after);
    after.forEach((node, _offset, index) => {
        if (isEmpty(node)) return;
        const a = was.get(node);
        const b = is.get(node) as [PMNode | null, number, PMNode | null, number];
        if (a === undefined || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) {
            // 它与前后的内容块（中间的空段落一起）都算挨着编辑。
            let start = index;
            while (start > 0 && (start === index || isEmpty(after.child(start)))) start -= 1;
            let end = index;
            while (end < after.childCount - 1 && (end === index || isEmpty(after.child(end)))) end += 1;
            for (let at = start; at <= end; at += 1) near.add(at);
        }
    });
    // 上下文变了（引用定义有增删改）：含引用式链接的块按规则会改写成行内链接，也算挨着编辑。
    const definitions = (doc: PMNode): string => {
        const raws: string[] = [];
        doc.forEach((node) => {
            if (node.type.name === "rawBlock" && /^ {0,3}\[[^\]]+\]:/u.test(String(node.attrs.raw))) raws.push(String(node.attrs.raw));
        });
        return raws.join("\n");
    };
    if (definitions(before) !== definitions(after)) {
        after.forEach((node, _offset, index) => {
            let usesReference = false;
            node.descendants((child) => {
                if (child.marks.some((mark) => mark.type.name === "link" && ["reference", "collapsed", "shortcut"].includes(String((mark.attrs.markdown as {style?: string} | null)?.style)))) usesReference = true;
            });
            if (usesReference) near.add(index);
        });
    }
    // 批注的分组（方言 Spec 输出 11）：一条批注有一截挨着编辑处、或者它的截在编辑前后有增减，它涉及的块都会按规则重新写出。
    const comments = (doc: PMNode): Map<string, number[]> => {
        const groups = new Map<string, number[]>();
        doc.forEach((node, _offset, index) => {
            node.descendants((child) => {
                for (const mark of child.marks) {
                    if (mark.type.name !== "comment") continue;
                    const group = JSON.stringify([mark.attrs.id, mark.attrs.body, mark.attrs.key]);
                    groups.set(group, [...new Set([...(groups.get(group) ?? []), index])]);
                }
            });
        });
        return groups;
    };
    const previous = comments(before);
    for (const [group, blocks] of comments(after)) {
        const earlier = previous.get(group) ?? [];
        const touched = blocks.some((index) => near.has(index)) || earlier.length !== blocks.length;
        if (touched) for (const index of blocks) near.add(index);
    }
    return near;
}

/** 有没有文本块以会开启 HTML 块的原样片段开头，或者整段只有一个完整标签的原样片段（方言 Spec 输出 9 的已知限制）。 */
function startsWithHtmlBlock(doc: PMNode): boolean {
    let found = false;
    doc.descendants((node) => {
        const first = node.isTextblock ? node.firstChild : null;
        if (first?.type.name !== "rawInline") return;
        const raw = String(first.attrs.raw ?? "");
        if (OPENS_HTML_BLOCK.test(raw) || (node.childCount === 1 && LONE_TAG.test(raw))) found = true;
    });
    return found;
}

/** 这个文字节点在不在表格里。 */
function insideTable(doc: PMNode, target: PMNode): boolean {
    let found = false;
    doc.descendants((node) => {
        if (node.type.name === "table") node.descendants((child) => {
            if (child === target) found = true;
        });
    });
    return found;
}

/** 一步编辑：由几个自然数决定在哪里做什么。 */
type Edit = readonly [kind: number, a: number, b: number, value: string];

/** 文档里全部文本块内容的位置。 */
function textPositions(doc: PMNode): number[] {
    const positions: number[] = [];
    doc.descendants((node, pos) => {
        if (node.isTextblock && node.type.name !== "codeBlock") for (let at = pos + 1; at <= pos + 1 + node.content.size; at += 1) positions.push(at);
        return !node.isTextblock;
    });
    return positions;
}

/** 施加一步编辑；做不了的编辑返回 null。返回编辑后的文档与被直接改动的顶层下标。 */
function apply(doc: PMNode, [kind, a, b, value]: Edit): {doc: PMNode; touched: number[]} | null {
    const tr = new Transform(doc);
    const positions = textPositions(doc);
    const at = positions.length === 0 ? null : (positions[a % positions.length] as number);
    const topIndex = a % doc.childCount;
    const topPos = (index: number): number => {
        let pos = 0;
        for (let n = 0; n < index; n += 1) pos += doc.child(n).nodeSize;
        return pos;
    };
    const indexAt = (pos: number): number => doc.resolve(Math.min(pos, doc.content.size)).index(0);
    try {
        switch (kind % 11) {
            case 0:
                if (at === null) return null;
                tr.insert(at, schema.text(value, doc.resolve(at).marks()));
                return {doc: tr.doc, touched: [indexAt(at)]};
            case 1:
                if (at === null) return null;
                tr.split(at);
                return {doc: tr.doc, touched: [indexAt(at), indexAt(at) + 1]};
            case 2: {
                if (doc.childCount < 2) return null;
                const index = 1 + (a % (doc.childCount - 1));
                tr.join(topPos(index));
                return {doc: tr.doc, touched: [index - 1]};
            }
            case 3: {
                if (doc.childCount < 2) return null;
                tr.delete(topPos(topIndex), topPos(topIndex) + doc.child(topIndex).nodeSize);
                return {doc: tr.doc, touched: [topIndex - 1, topIndex]};
            }
            case 4: {
                if (doc.childCount < 2) return null;
                const node = doc.child(topIndex);
                tr.delete(topPos(topIndex), topPos(topIndex) + node.nodeSize);
                const target = b % tr.doc.childCount;
                let pos = 0;
                for (let n = 0; n < target; n += 1) pos += tr.doc.child(n).nodeSize;
                tr.insert(pos, node);
                return {doc: tr.doc, touched: [topIndex - 1, topIndex, target - 1, target, target + 1]};
            }
            case 5: {
                if (at === null) return null;
                const $at = doc.resolve(at);
                const type = b % 2 === 0 ? schema.nodes.heading! : schema.nodes.paragraph!;
                tr.setBlockType($at.before(), $at.after(), type, type.name === "heading" ? {level: 1 + (b % 2)} : null);
                return {doc: tr.doc, touched: [indexAt(at)]};
            }
            case 6: {
                if (at === null) return null;
                const $at = doc.resolve(at);
                const range = $at.blockRange();
                const types = [schema.nodes.bulletList!, schema.nodes.blockquote!, schema.nodes.orderedList!, schema.nodes.callout!, schema.nodes.commentBlock!, schema.nodes.markdownAlign!, schema.nodes.markdownBilingual!];
                const type = types[b % types.length]!;
                const wrapping = range === null ? null : findWrapping(range, type);
                if (range === null || wrapping === null) return null;
                tr.wrap(range, wrapping);
                return {doc: tr.doc, touched: [indexAt(at)]};
            }
            case 7: {
                if (at === null) return null;
                const end = Math.min(at + 1 + (b % 4), doc.resolve(at).end());
                const marks = [...markNames.map((name) => () => schema.marks[name]!.create()), ...dialectMarks.map((create) => () => create(value))];
                const mark = (marks[b % marks.length] as () => Mark)();
                if (b % 3 === 0) tr.removeMark(at, end, mark.type);
                else tr.addMark(at, end, mark);
                return {doc: tr.doc, touched: [indexAt(at)]};
            }
            case 8:
                if (at === null) return null;
                tr.insert(at, schema.nodes.hardBreak!.create());
                return {doc: tr.doc, touched: [indexAt(at)]};
            case 9: {
                // 清空一段（含容器里的一段）：留下空的文本块。
                if (at === null) return null;
                const $at = doc.resolve(at);
                tr.delete($at.start(), $at.end());
                return {doc: tr.doc, touched: [indexAt(at)]};
            }
            default:
                tr.insert(topPos(topIndex), schema.nodes.paragraph!.create());
                return {doc: tr.doc, touched: [topIndex - 1, topIndex, topIndex + 1]};
        }
    } catch {
        // 这一步在这个文档上不合法（例如拆分表格单元格）：跳过，等同于没有这一步。
        return null;
    }
}

describe("真实编辑序列：每步写回、重读相同，离编辑远的块原文不变", () => {
    const edit = fc.tuple(fc.nat(), fc.nat(), fc.nat(), text);
    it("语料 × 随机编辑", () => {
        fc.assert(fc.property(fc.nat({max: sources.length - 1}), fc.array(edit, {minLength: 1, maxLength: 8}), (which, edits) => {
            const source = sources[which] as string;
            const read = codec.read(source);
            let doc = read.doc;
            for (const step of edits) {
                const next = apply(doc, step);
                if (next === null) continue;
                const near = nearEdit(doc, next.doc);
                doc = next.doc;
                doc.check();
                const started = performance.now();
                const result = codec.write(doc, read.map);
                // 停手写回在主线程上：语料这样的小文档一次写回远不到 500 毫秒（大文档的上限另由性能测试量）。
                expect(performance.now() - started).toBeLessThan(500);
                // 已知的格式限制（方言 Spec 输出 9）：段首是会开启 HTML 块的原样片段。
                if (!result.ok && startsWithHtmlBlock(doc)) return;
                expect(result.ok ? null : `${result.reason}（${JSON.stringify(step)}）`).toBeNull();
                if (!result.ok) return;
                expect(sameDoc(doc, result.text)).toBeNull();
                // 不挨着被编辑处的块：原文字节仍在写出里。
                doc.forEach((node, _offset, index) => {
                    const origin = read.map.origins.get(node)?.[0];
                    if (origin === undefined || near.has(index) || origin.unit.raw === "") return;
                    expect(result.text.includes(origin.unit.raw) ? null : `第 ${index} 块的原文不见了：${JSON.stringify(origin.unit.raw)}`).toBeNull();
                });
                result.record();
            }
            // 撤销到底：回到打开时的文档，写出与原文逐字节相同（方言 Spec 输出 2）。
            expect(codec.write(read.doc, read.map)).toMatchObject({ok: true, text: source});
        }), {numRuns: 300, seed, verbose: 2});
    });
});
