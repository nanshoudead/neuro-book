/**
 * Markdown 编解码器（docs/specs/workspace/markdown-dialect.md）：编辑器只经它读写 Markdown。
 *
 * 按 schema 建：Tiptap 每个编辑器各建一份 schema，读出的文档必须属于编辑器自己的那一份，不同 schema 的节点不能放进同一个文档。
 * 语言（`Marked` 实例与读法表）全应用共用，见 `../language.ts`。
 */

import type {Node as PMNode, Schema} from "@tiptap/pm/model";

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
        };
        bySchema.set(language, codec);
    }
    return codec;
}
