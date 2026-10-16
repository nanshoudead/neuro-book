/**
 * Markdown 富文本编辑器的扩展组（docs/specs/workbench/editor.md 输出 19）：Markdown 语言的全部语法扩展（`syntax/`，编解码器按
 * 这份 schema 读写）加编辑器界面层的占位与行内代码快捷输入。旧应用的 Agent 触发菜单、斜杠命令、行内 AI 引用与工作区引用标签
 * 不迁：它们依赖新应用还没有的服务；工作区与领域链接按普通链接保留源码。
 */

import type {AnyExtension} from "@tiptap/core";
import {Placeholder} from "@tiptap/extension-placeholder";

import {MarkdownInlineCodeShortcut} from "./inline-code-shortcut";
import {markdownLanguage} from "./syntax";

export function createMarkdownEditorExtensions(options: {readonly placeholder: string}): AnyExtension[] {
    return [...markdownLanguage().extensions, Placeholder.configure({placeholder: options.placeholder, emptyEditorClass: "is-editor-empty"}), MarkdownInlineCodeShortcut];
}
