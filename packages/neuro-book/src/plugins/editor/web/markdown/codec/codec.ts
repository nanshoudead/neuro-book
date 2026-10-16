/**
 * Markdown 编解码器（docs/specs/workspace/markdown-dialect.md）：编辑器只经它读写 Markdown。
 *
 * 按 schema 建：Tiptap 每个编辑器各建一份 schema，读出的文档必须属于编辑器自己的那一份，不同 schema 的节点不能放进同一个文档。
 * 语言（`Marked` 实例与读法表）全应用共用，见 `../language.ts`。
 */

import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import type {Transform} from "@tiptap/pm/transform";

import type {MarkdownLanguage} from "../language";
import {readMarkdown} from "./read";
import type {ReadResult, SourceMap} from "./read";
import {writeMarkdown} from "./write";
import type {WriteResult} from "./write";

export interface MarkdownCodec {
    /** 读入；永不失败（输出 9）。 */
    read(source: string): ReadResult;
    /** 写回：没编辑的块写原文，编辑过的块重新写出并读回校验（输出 1–3）。成功后提交被接受时调用结果的 `record`。 */
    write(doc: PMNode, map: SourceMap): WriteResult;
    /**
     * 重载（正文被别处改了）：按 `source` 重新读入，在 `tr` 上只把不同的那一段换掉，返回新的原文对照，没变的块以新原文为来源。
     * 旧的来源不再用：方言 Spec“状态与转换”，外部修改后重新读入，“哪些块被编辑过”按新的原文重新计。
     */
    reload(tr: Transform, source: string): SourceMap;
}

const codecs = new WeakMap<Schema, WeakMap<MarkdownLanguage, MarkdownCodec>>();

export function codecFor(schema: Schema, language: MarkdownLanguage): MarkdownCodec {
    const bySchema = codecs.get(schema) ?? new WeakMap<MarkdownLanguage, MarkdownCodec>();
    codecs.set(schema, bySchema);
    let codec = bySchema.get(language);
    if (codec === undefined) {
        codec = {
            read: (source) => readMarkdown(language, schema, source),
            write: (doc, map) => writeMarkdown(doc, map, language, schema),
            reload: (tr, source) => adoptRead(tr, readMarkdown(language, schema, source)),
        };
        bySchema.set(language, codec);
    }
    return codec;
}

/**
 * 把 `tr` 的文档换成 `read.doc` 的样子：只替换不同的那一段（没变的顶层节点还是编辑器里原来的对象，撤销历史映射过去后仍可用），
 * 换完不相等时（替换片段的边界落在节点中间，补出来的结构不同）整篇替换。之后按位置把新读入的来源登记到 `tr.doc` 的顶层节点。
 */
function adoptRead(tr: Transform, read: ReadResult): SourceMap {
    const next = read.doc;
    const start = tr.doc.content.findDiffStart(next.content);
    if (start !== null) {
        let {a: endA, b: endB} = tr.doc.content.findDiffEnd(next.content) ?? {a: tr.doc.content.size, b: next.content.size};
        // 两边重复的内容让结尾比开头还早时，往后挪到不重叠。
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
            endA += overlap;
            endB += overlap;
        }
        tr.replace(start, endA, next.slice(start, endB));
    }
    if (!tr.doc.eq(next)) tr.replaceWith(0, tr.doc.content.size, next.content);
    tr.doc.forEach((node, _offset, index) => {
        const origins = read.map.origins.get(next.child(index));
        if (origins !== undefined) read.map.origins.set(node, origins);
    });
    return read.map;
}
