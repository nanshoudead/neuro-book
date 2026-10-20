/**
 * 源码编辑器的排版选项（docs/specs/workbench/editor.md 输出 52 的“代码编辑器”小组）：编辑器区从配置读成一份响应式的值，
 * 经注入交给源码编辑器控件，做法同语言登记表（`languages.ts`）。没有注入时（Lab）用缺省值。
 */

import type {InjectionKey, Ref} from "vue";

export interface CodeEditorOptions {
    /** 空串跟随主题的等宽字体。 */
    readonly fontFamily: string;
    readonly fontSize: number;
    /** 0 按字号自动。 */
    readonly lineHeight: number;
    readonly tabSize: number;
    readonly detectIndentation: boolean;
    readonly lineNumbers: "on" | "off" | "relative";
    readonly minimap: boolean;
    readonly wordWrap: boolean;
}

/** 与配置项的缺省值相同（`shared/settings.ts` 的 `codeSettings`）。 */
export const DEFAULT_CODE_EDITOR_OPTIONS: CodeEditorOptions = {
    fontFamily: "",
    fontSize: 14,
    lineHeight: 0,
    tabSize: 4,
    detectIndentation: true,
    lineNumbers: "on",
    minimap: false,
    wordWrap: true,
};

export const codeEditorOptionsKey: InjectionKey<Readonly<Ref<CodeEditorOptions>>> = Symbol("nbook.editor.code-options");
