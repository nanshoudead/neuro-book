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
import {Mark} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Transform, findWrapping} from "@tiptap/pm/transform";
import {describe, expect, it} from "bun:test";
import fc from "fast-check";

import {LONE_TAG, OPENS_HTML_BLOCK} from "@notnotype/nb-markdown";

import {markdownLanguage} from "../syntax";
import {codecFor} from "./codec";
import {equivalent} from "./compare";

const language = markdownLanguage();
const schema = getSchema([...language.extensions]);
const codec = codecFor(schema, language);
const CORPUS = join(import.meta.dir, "corpus");
const sources = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort().map((name) => readFileSync(join(CORPUS, name), "utf8"));
const seed = Number(process.env.MARKDOWN_PROPERTY_SEED ?? 20261015);
const emphasis = new Set([...language.markWriters].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));
const compareOptions = {styles: "canonical" as const, emphasis, ignored: language.uncomparedAttrs, markless: language.marklessInline, textOnly: language.textOnlyMarks, joined: language.joinedInline};

/**
 * 两篇文档里的批注分组是否相同：每条批注覆盖的字（文字按字、行内节点各算一个，硬换行不算）一一对应，意见相同。逐块比较不看
 * 批注的 `id`、`body`、`key`（它们由跨块的分组决定），整篇重读时分组是完整的，要在这里核对。
 */
function sameComments(doc: PMNode, again: PMNode): string | null {
    const groups = (root: PMNode): string[] => {
        const found = new Map<unknown, {positions: number[]; body: string}>();
        let position = 0;
        // 挨着的、标记相同的原样片段读回合成一个，算一个位置。
        let previous: PMNode | null = null;
        root.descendants((node) => {
            if (!node.isInline) {
                previous = null;
                return true;
            }
            if (node.type.name === "hardBreak") return false;
            const merged = !node.isText && previous !== null && previous.type === node.type && Mark.sameSet(previous.marks, node.marks);
            previous = node.isText ? null : node;
            if (merged) return false;
            const size = node.isText ? (node.text as string).length : 1;
            for (const mark of node.marks) {
                if (mark.type.name !== "comment") continue;
                const key = JSON.stringify([mark.attrs.id, mark.attrs.body, mark.attrs.key]);
                const group = found.get(key) ?? {positions: [], body: String(mark.attrs.body)};
                for (let at = 0; at < size; at += 1) group.positions.push(position + at);
                found.set(key, group);
            }
            position += size;
            return false;
        });
        return [...found.values()].map((group) => `${group.positions.join(",")}|${group.body}`).sort();
    };
    const before = groups(doc);
    const after = groups(again);
    return JSON.stringify(before) === JSON.stringify(after) ? null : `批注分组不同：${JSON.stringify(before)} → ${JSON.stringify(after)}`;
}

/** 读回的整篇与文档是否相同（顶层逐个比，空段落也算；批注的分组也比）。 */
function sameDoc(doc: PMNode, text: string): string | null {
    const again = codec.read(text).doc;
    // 整篇没有内容时，几个空段落都读成一个（没有块就没有间隔）。
    const blank = (node: PMNode): boolean => node.childCount > 0 && Array.from({length: node.childCount}, (_, index) => node.child(index)).every((child) => child.type.name === "paragraph" && child.childCount === 0);
    if (blank(doc) && blank(again)) return null;
    if (again.childCount !== doc.childCount) return `块数不同：${doc.childCount} → ${again.childCount}`;
    for (let index = 0; index < doc.childCount; index += 1) {
        if (!equivalent(doc.child(index), again.child(index), compareOptions)) return `第 ${index} 块不同：${JSON.stringify(doc.child(index).toJSON())} → ${JSON.stringify(again.child(index).toJSON())}`;
    }
    return sameComments(doc, again);
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
    const link = fc.tuple(fc.constantFrom("https://example.com/a", "/b c", "a(b)"), fc.option(text, {nil: null})).map(([href, title]) => schema.marks.link!.create({href, title}));
    const inline = fc.array(fc.oneof(
        // 行内代码外面可以有粗体与链接（代码里面不能再有别的格式）。
        {weight: 6, arbitrary: fc.tuple(text, fc.subarray([...markNames])).map(([value, marks]) => schema.text(value, marks.filter((name) => !marks.includes("code") || name === "code" || name === "bold").map((name) => schema.marks[name]!.create())))},
        {weight: 2, arbitrary: fc.tuple(text, fc.nat({max: dialectMarks.length - 1}), fc.subarray(["bold", "italic"])).map(([value, which, marks]) => schema.text(value, [(dialectMarks[which] as (value: string) => Mark)(value), ...marks.map((name) => schema.marks[name]!.create())]))},
        {weight: 1, arbitrary: fc.constant(null).map(() => schema.nodes.hardBreak!.create())},
        {weight: 1, arbitrary: fc.tuple(text, link, fc.boolean()).map(([value, mark, code]) => schema.text(value, code ? [mark, schema.marks.code!.create()] : [mark]))},
        {weight: 1, arbitrary: fc.tuple(text, fc.option(text, {nil: null})).map(([alt, title]) => schema.nodes.image!.create({src: "a.png", alt, title}))},
        // 原样片段：方言之外的标签与注释（方言 Spec 输出 9）。
        {weight: 1, arbitrary: fc.constantFrom("<kbd>", "</kbd>", "<!-- 注 -->", "<span class=\"x\">").map((raw) => schema.nodes.rawInline!.create({raw}))},
    ), {minLength: 1, maxLength: 5});
    const paragraph = inline.map((content) => schema.nodes.paragraph!.create(null, content));
    const block = fc.oneof(
        {weight: 5, arbitrary: paragraph},
        {weight: 1, arbitrary: fc.tuple(fc.integer({min: 1, max: 3}), inline).map(([level, content]) => schema.nodes.heading!.create({level}, content.filter((node) => node.type.name !== "hardBreak")))},
        {weight: 1, arbitrary: fc.array(paragraph, {minLength: 1, maxLength: 3}).map((items) => schema.nodes.bulletList!.create(null, items.map((item) => schema.nodes.listItem!.create(null, [item]))))},
        // 有序列表（起始号随机）与嵌套列表。
        {weight: 1, arbitrary: fc.tuple(fc.array(paragraph, {minLength: 1, maxLength: 2}), fc.nat({max: 12})).map(([items, start]) => schema.nodes.orderedList!.create({start}, items.map((item) => schema.nodes.listItem!.create(null, [item]))))},
        {weight: 1, arbitrary: fc.tuple(paragraph, paragraph, fc.boolean()).map(([outer, inner, ordered]) => schema.nodes.bulletList!.create(null, [schema.nodes.listItem!.create(null, [outer, (ordered ? schema.nodes.orderedList! : schema.nodes.bulletList!).create(null, [schema.nodes.listItem!.create(null, [inner])])])]))},
        // 原样块：引用定义（正文里的 `[d]` 要转义）、脚注定义、HTML 块。
        {weight: 1, arbitrary: fc.constantFrom("[d]: https://d.com", "[a]: /x \"题\"", "[^1]: 脚注", "<div>\n甲\n</div>").map((raw) => schema.nodes.rawBlock!.create({raw}))},
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
            // GFM 表格里行内代码与链接、图片的标题不能有“反斜杠加竖线”（切单元格时它总被当成转义的竖线），这是格式本身表达不了的，按写不出
            // 处理是对的。
            let pipeInTableCode = false;
            doc.descendants((node, _pos, parent) => {
                const verbatim = node.isText && node.marks.some((mark) => mark.type.name === "code") && (node.text as string).includes("\\|");
                const title = node.marks.some((mark) => mark.type.name === "link" && String(mark.attrs.title ?? "").includes("\\|")) || (node.type.name === "image" && String(node.attrs.title ?? "").includes("\\|"));
                if (parent?.type.name === "paragraph" && (verbatim || title)) pipeInTableCode ||= insideTable(doc, node);
            });
            fc.pre(!pipeInTableCode);
            // 链接文字里的行内代码含反引号或反斜杠：`marked` 的链接文字只认单个反引号成对的代码，也会把代码里的反斜杠当转义，写不出（方言 Spec 输出 3）。
            let backtickInLinkCode = false;
            doc.descendants((node) => {
                if (node.isText && node.marks.some((mark) => mark.type.name === "code") && node.marks.some((mark) => mark.type.name === "link") && /[`\\]/u.test(node.text as string)) backtickInLinkCode = true;
            });
            fc.pre(!backtickInLinkCode);
            // 链接、图片的标题以反斜杠结尾：`marked` 的标题规则把转义的反斜杠后面的引号当成被转义的，写不出（方言 Spec 输出 18）。
            let titleEndsWithBackslash = false;
            doc.descendants((node) => {
                const titles = [node.type.name === "image" ? node.attrs.title : null, ...node.marks.filter((mark) => mark.type.name === "link").map((mark) => mark.attrs.title)];
                if (titles.some((value) => typeof value === "string" && value.endsWith("\\"))) titleEndsWithBackslash = true;
            });
            fc.pre(!titleEndsWithBackslash);
            // 已知的格式限制（方言 Spec 输出 9）：段首是会开启 HTML 块的原样片段，或整段只有一个完整标签。
            fc.pre(!rawLimit(doc, 0, doc.content.size));
            const result = codec.write(doc, codec.read("").map);
            expect(result.ok ? null : result.reason).toBeNull();
            if (result.ok) expect(sameDoc(doc, result.text)).toBeNull();
        }), {numRuns: 400, seed, verbose: 2});
    }, 60_000);
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
    // 上下文变了（引用定义有增删改，定义可以在容器里）：含引用式链接的块按规则会改写成行内链接，也算挨着编辑。
    const definitions = (doc: PMNode): string => {
        const raws: string[] = [];
        doc.descendants((node) => {
            if (node.type.name === "rawBlock" && String(node.attrs.raw).includes("]:")) raws.push(String(node.attrs.raw));
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

/**
 * 写不出的那一块（`from`–`to`）里有没有原样片段的已知限制（方言 Spec 输出 9）：文本块以会开启 HTML 块的原样片段开头（包括后面
 * 有配对闭标签的开标签），整段只有原样片段，或者同一段里一对能配上的开闭标签片段之间有别的内容（读回合成一个原样片段）。
 */
function rawLimit(doc: PMNode, from: number, to: number): boolean {
    // 全篇的原样片段（按先后）与它们的位置：段首的开标签片段后面（可以隔着空行）有同名的闭标签片段时，读回从它到闭标签是一个
    // 原样块。
    const later: Array<{pos: number; raw: string}> = [];
    doc.descendants((node, pos) => {
        if (node.type.name === "rawInline") later.push({pos, raw: String(node.attrs.raw ?? "")});
    });
    const closedLater = (raw: string, pos: number): boolean => {
        const name = /^<([A-Za-z][\w-]*)[\s>]/u.exec(raw)?.[1];
        return name !== undefined && later.some((other) => other.pos > pos && other.raw === `</${name}>`);
    };
    let found = false;
    doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        const raws = Array.from({length: node.childCount}, (_, index) => node.child(index)).map((child) => (child.type.name === "rawInline" ? String(child.attrs.raw ?? "") : null));
        const first = raws[0] ?? null;
        const startsBlock = first !== null && (OPENS_HTML_BLOCK.test(first) || (raws.length === 1 && LONE_TAG.test(first)) || closedLater(first, pos));
        const onlyRaw = raws.length > 0 && raws.every((raw) => raw !== null);
        const paired = raws.some((raw, index) => {
            const name = raw === null ? null : /^<([A-Za-z][\w-]*)[\s>]/u.exec(raw)?.[1];
            return name !== null && name !== undefined && raws.slice(index + 2).includes(`</${name}>`);
        });
        if (startsBlock || onlyRaw || paired) found = true;
        return false;
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
        fc.assert(fc.property(fc.nat({max: sources.length - 1}), fc.array(edit, {minLength: 1, maxLength: 16}), (which, edits) => {
            const source = sources[which] as string;
            const read = codec.read(source);
            let doc = read.doc;
            // 每一步写回被接受后的文档与写出，撤销到这一步时写出要与当时逐字节相同。
            const history: Array<{doc: PMNode; text: string}> = [{doc, text: source}];
            for (const step of edits) {
                const next = apply(doc, step);
                if (next === null) continue;
                const near = nearEdit(doc, next.doc);
                next.doc.check();
                const started = performance.now();
                const result = codec.write(next.doc, read.map);
                // 停手写回在主线程上：语料这样的小文档一次写回远不到 500 毫秒（大文档的上限另由性能测试量）。
                expect(performance.now() - started).toBeLessThan(500);
                // 已知的格式限制（方言 Spec 输出 9）：段首是会开启 HTML 块的原样片段。只跳过写不出的这一步（编辑器里这一步交不出去，
                // 文档仍是上一步的），不结束整个序列。
                if (!result.ok && rawLimit(next.doc, result.from, result.to)) continue;
                expect(result.ok ? null : `${result.reason}（${JSON.stringify(step)}）`).toBeNull();
                if (!result.ok) return;
                doc = next.doc;
                expect(sameDoc(doc, result.text)).toBeNull();
                // 不挨着被编辑处的块：原文字节不变。整篇重读后同一位置的块（块数已经核对过相同）所在的那段原文包含它原来的原文
                // （一段原文可能读成几个节点，例如任务列表与普通列表项挨着时是一段）。
                // 一段原文只读成这一个节点、重读后也是时要逐字节相同。相邻的两个内容块都不挨着编辑处时，中间的间隔也在写出里原样出现。
                const reread = codec.read(result.text);
                // 一段原文读成几个节点（任务列表与普通列表项挨着时是一段）时只能要求包含。
                const nodesOf = new Map<object, number>();
                for (const [root, map] of [[doc, read.map], [reread.doc, reread.map]] as const) {
                    root.forEach((node) => {
                        const unit = map.origins.get(node)?.[0]?.unit;
                        if (unit !== undefined) nodesOf.set(unit, (nodesOf.get(unit) ?? 0) + 1);
                    });
                }
                let previous: {index: number; unit: {raw: string}} | null = null;
                let empties = 0;
                doc.forEach((node, _offset, index) => {
                    if (node.type.name === "paragraph" && node.childCount === 0) {
                        empties += 1;
                        return;
                    }
                    const origin = read.map.origins.get(node)?.[0];
                    const far = origin !== undefined && !near.has(index) && origin.unit.raw !== "";
                    if (far) {
                        const unit = reread.map.origins.get(reread.doc.child(index))?.[0]?.unit;
                        const now = unit?.raw ?? "";
                        const kept = nodesOf.get(origin.unit) === 1 && unit !== undefined && nodesOf.get(unit) === 1 ? now === origin.unit.raw : now.includes(origin.unit.raw);
                        expect(kept ? null : `第 ${index} 块的原文变了：${JSON.stringify(origin.unit.raw)} → ${JSON.stringify(now)}`).toBeNull();
                        const gap = previous === null || previous.unit === origin.unit ? undefined : read.map.gaps.get(previous.unit)?.get(origin.unit)?.get(empties);
                        if (previous !== null && gap !== undefined) expect(result.text.includes(previous.unit.raw + gap.raw + origin.unit.raw) ? null : `第 ${previous.index} 块与第 ${index} 块之间的间隔变了`).toBeNull();
                    }
                    previous = far ? {index, unit: (origin as {unit: {raw: string}}).unit} : null;
                    empties = 0;
                });
                // 编辑器的做法：写出被接受后回填写法（只改属性），之后的编辑在回填后的文档上继续。不再编辑时写出与这一次逐字节相同。
                const tr = new Transform(doc);
                result.accept(tr);
                expect(tr.doc.textContent).toBe(doc.textContent);
                doc = tr.doc;
                const again = codec.write(doc, read.map);
                expect(again.ok && again.text === result.text ? null : `回填后不编辑写出不同：${JSON.stringify(again.ok ? again.text : again.reason)}`).toBeNull();
                history.push({doc, text: result.text});
            }
            // 撤销（方言 Spec 输出 2）：回到打开时的文档，写出与原文逐字节相同；回到中间某一步，写出读回与那一步的文档相同。中间步
            // 不要求逐字节：没被编辑、但随别处的编辑重新写出过的块（例如分截批注的各截），那一步的字节不止一种。
            for (const [at, {doc: earlier, text}] of history.entries()) {
                const again = codec.write(earlier, read.map);
                if (at === 0) expect(again.ok && again.text === text ? null : `撤销到打开时写出不同：${JSON.stringify(again.ok ? again.text : again.reason)}`).toBeNull();
                else expect(again.ok ? sameDoc(earlier, again.text) : `撤销到第 ${at} 步写不出：${again.reason}`).toBeNull();
            }
        }), {numRuns: 200, seed, verbose: 2});
    }, 120_000);
});
