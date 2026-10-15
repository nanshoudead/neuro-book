/**
 * 全部语法模块，按固定顺序（同一种词法单元有几个模块认领时，靠前的先试）。编辑器与编解码器都从这里取，代替旧的
 * `markdown-dialect-extensions.ts` 与分散在各处的名单。
 */

import {createMarkdownLanguage} from "../language";
import type {MarkdownLanguage} from "../language";
import {alignSyntax} from "./align";
import {bilingualSyntax} from "./bilingual";
import {calloutSyntax} from "./callout";
import {commentSyntax} from "./comment";
import {coreSyntax} from "./core";
import {htmlEmbedSyntax} from "./html-embed";
import {rubySyntax} from "./ruby";
import {textMarksSyntax} from "./text-marks";

let shared: MarkdownLanguage | null = null;

/** 全应用共用的 Markdown 语言（第一次用时建）。 */
export function markdownLanguage(): MarkdownLanguage {
    shared ??= createMarkdownLanguage([commentSyntax, calloutSyntax, alignSyntax, bilingualSyntax, htmlEmbedSyntax, rubySyntax, textMarksSyntax, coreSyntax]);
    return shared;
}
