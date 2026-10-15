/**
 * 写出一个块（docs/specs/workspace/markdown-dialect.md 输出 2、4、10）：按语言里各语法模块登记的写法。写出的文字一律用 `\n`。
 */

import type {Node as PMNode} from "@tiptap/pm/model";

import type {MarkdownLanguage} from "../../language";
import type {WriteContext, WriteOptions} from "../../syntax/types";
import {Unrepresentable} from "../../syntax/types";
import {renderInline} from "./inline";

/** 写出一个块；写不出时抛 `Unrepresentable`。 */
export function renderBlock(language: MarkdownLanguage, node: PMNode, options: WriteOptions, definitions: ReadonlyMap<string, string>): string {
    const writers = {inline: language.inlineWriters, marks: language.markWriters, markless: language.marklessInline};
    const contextFor = (current: WriteOptions): WriteContext => {
        const context: WriteContext = {
            options: current,
            definitions,
            style: <T>(target: {readonly attrs: Readonly<Record<string, unknown>>}) => (current.styles === "canonical" ? null : ((target.attrs.markdown as T | undefined) ?? null)),
            inline: (parent, place = {}) => renderInline(parent, context, place, writers),
            block: (child, alternate) => {
                const writer = language.blockWriters.get(child.type.name);
                if (writer === undefined) throw new Unrepresentable(`没有 ${child.type.name} 的写法`);
                return writer(child, alternate === undefined || alternate === current.alternate ? context : contextFor({...current, alternate}));
            },
        };
        return context;
    };
    return contextFor(options).block(node);
}
