/**
 * 测试用的外来方言（docs/specs/workspace/markdown-syntaxes.md 的验收）：`<kbd>按键</kbd>` 读成一个标记，写回 `<kbd>…</kbd>`。
 * 没有它时 `<kbd>` 按原样保留（方言 Spec 输出 9），所以能看出方言生效与不生效的差别。
 *
 * `kbdDialectPlugin` 按参数造插件：声明在插件定义的顶层贡献里（产品插件写在描述里，经清单注入，效果相同）；实现在浏览器入口里
 * 交付，`load` 可以换成失败的、标签不对的，测不生效的几种原因。
 */

import {Mark, mergeAttributes} from "@tiptap/core";
import type {MarkedExtension, Token, Tokens} from "marked";

import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {closeInline, openTagAt, openTagIndex} from "@notnotype/nb-markdown/language";

import {MARKDOWN_DIALECTS_POINT, MARKDOWN_SYNTAXES_POINT} from "../../shared/contracts";
import type {DialectDeclaration} from "../../shared/contracts";
import type {MarkdownSyntax, MarkdownSyntaxImplementation} from "../contracts";

interface TagToken extends Tokens.Generic {
    readonly tokens: Token[];
}

/**
 * 一个行内标签方言的语法模块：`<tag>…</tag>` 读成标记 `test-<tag>`，写回 `<tag>…</tag>`。缺省是 `kbd`；`declaredTags` 换成别的名单时，
 * 交出的标签名与声明对不上。
 */
export function kbdSyntax(options: {readonly tag?: string; readonly declaredTags?: ReadonlyArray<string>} = {}): MarkdownSyntax {
    const tag = options.tag ?? "kbd";
    const type = `test-${tag}`;
    const mark = Mark.create({
        name: type,
        priority: 700,
        parseHTML: () => [{tag}],
        renderHTML: ({HTMLAttributes}) => [tag, mergeAttributes(HTMLAttributes), 0],
    });
    const tokenizers: MarkedExtension = {
        extensions: [{
            name: type,
            level: "inline",
            start: (src: string) => openTagIndex(src, [tag]),
            tokenizer(src: string): TagToken | undefined {
                const open = openTagAt(src, [tag]);
                if (open === null || open.attributes.size > 0) return undefined;
                const close = closeInline(src, tag, open.length);
                if (close === null || close.start === open.length) return undefined;
                return {type, raw: src.slice(0, close.end), tokens: this.lexer.inlineTokens(src.slice(open.length, close.start))};
            },
        }],
    };
    return {
        name: type,
        extensions: [mark],
        marked: [tokenizers],
        readInline: {[type]: (token, context) => context.mark(type, context.inline((token as TagToken).tokens))},
        writeMark: {[type]: {open: () => `<${tag}>`, close: () => `</${tag}>`}},
        inlineTags: [...(options.declaredTags ?? [tag])],
    };
}

export interface KbdDialectOptions {
    /** 插件 id；缺省 `test.kbd`。方言 id 是 `<插件 id>.kbd`。 */
    readonly id?: string;
    /** 声明；缺省只声明 `kbd` 这个行内标签。null 表示不声明（只有实现）。 */
    readonly declaration?: DialectDeclaration | null;
    /** 实现；缺省是 `kbdSyntax()`。 */
    readonly implementation?: MarkdownSyntaxImplementation;
    /** 浏览器入口的激活事件；缺省启动即激活。空数组时由测试经 `plugins.activate` 激活（晚到的方言）。 */
    readonly activationEvents?: ReadonlyArray<string>;
    /** 激活时交出上下文：测试关它的作用域来停止贡献方。 */
    readonly onActivate?: (context: ActivationContext) => void;
}

export function kbdDialectPlugin(options: KbdDialectOptions = {}): PluginDefinition {
    const id = options.id ?? "test.kbd";
    const dialect = `${id}.kbd`;
    const declaration = options.declaration === undefined ? {order: 80, inlineTags: ["kbd"]} : options.declaration;
    return {
        id,
        contributions: declaration === null ? [] : [{capability: MARKDOWN_DIALECTS_POINT, id: dialect, declaration}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: [...(options.activationEvents ?? ["onStartup"])],
            contributions: [{capability: MARKDOWN_SYNTAXES_POINT, id: dialect, declaration: {}}],
            activate: (context) => {
                options.onActivate?.(context);
                return {contributions: {[MARKDOWN_SYNTAXES_POINT]: {[dialect]: options.implementation ?? {load: async () => kbdSyntax()}}}};
            },
        }],
    };
}
