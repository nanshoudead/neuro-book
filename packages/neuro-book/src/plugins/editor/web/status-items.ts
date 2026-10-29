/**
 * 编辑器贡献给状态栏的条目（docs/specs/workbench/editor.md 输出 26–28、42、45）：未保存数、活动文档的字数、活动控件的状态、
 * 语言、光标位置。
 * 显示与否由声明的 `when`（本插件的公开键）决定；文字由本插件从自己的编辑器区算出，外壳只渲染。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {ItemDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {ItemImplementation} from "nbook/plugins/workbench/web/contracts";
import type {Written} from "nbook/shared/convention-keys";
import type {TextResolver} from "nbook/shared/localized-text";
import {countWords} from "nbook/plugins/markdown/shared/contracts";
import type {DialectTable} from "nbook/plugins/markdown/shared/contracts";

import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import type {LanguageRegistry} from "./code/languages";
import {CHANGE_LANGUAGE_COMMAND, SAVE_ALL_COMMAND} from "./commands";
import type {TextDocument} from "./documents/store";
import {editorState, needsSaving} from "./state";

export const UNSAVED_ITEM = "nbook.editor.unsaved";
export const WORD_COUNT_ITEM = "nbook.editor.word-count";
export const CURSOR_ITEM = "nbook.editor.cursor";
export const EDITOR_STATUS_ITEM = "nbook.editor.editor-status";
export const LANGUAGE_ITEM = "nbook.editor.language";

/** 声明的 `title` 省略，登记时补成约定键 `statusItems.<本地 id>.title`（docs/specs/ui/workbench-shell.md 输出 33）。 */
export const EDITOR_STATUS_ITEMS: Readonly<Record<string, Written<ItemDeclaration, "title">>> = {
    [UNSAVED_ITEM]: {alignment: "right", order: 10, priority: 30, command: {id: SAVE_ALL_COMMAND}, when: {requires: [editorState.key("hasUnsavedDocuments")]}},
    [WORD_COUNT_ITEM]: {alignment: "right", order: 20, priority: 20, when: {requires: [editorState.key("active"), editorState.key("hasDocument")]}},
    // 活动控件交出的一行状态（输出 42），例如图片的尺寸；控件没给时不显示文字。
    [EDITOR_STATUS_ITEM]: {alignment: "right", order: 25, priority: 15, when: {requires: [editorState.key("hasEditorStatus")]}},
    [LANGUAGE_ITEM]: {alignment: "right", order: 28, priority: 12, command: {id: CHANGE_LANGUAGE_COMMAND}, when: {requires: [editorState.key("hasLanguage")]}},
    [CURSOR_ITEM]: {alignment: "right", order: 30, priority: 10, when: {requires: [editorState.key("hasCursorPosition")]}},
};

/** 提示里至多列出的文件数。 */
const LISTED = 5;

/** 提示里给人看的路径：去掉 `project://`、`user://` 这类方案前缀。 */
const shown = (address: string): string => address.replace(/^[a-z]+:\/\//u, "");

/** 输入时停手多久再重算字数（editor.md 输出 27）。 */
export const WORD_COUNT_DELAY_MS = 300;

/**
 * 活动文档的字数（editor.md 输出 27）。全文计数随正文长度线性增长，每次按键都算一遍在长章节里会拖慢输入，所以：
 * 换了活动文档、或这份文档还没有算过（包括新开的文件刚读到正文），立即算；同一份文档在输入（修订号变了）时先显示
 * 上一次的值，停手 `WORD_COUNT_DELAY_MS` 后按当时的修订号再算。
 *
 * 由条目文字的求值驱动，不另开监听：状态栏每次求值都会调到这里（移动光标也会），所以计时只在待算的修订号变了时重排。
 */
function activeWordCount(area: Readonly<ShallowRef<EditorArea | null>>, clock: RuntimeClock, dialects: DialectTable): () => number {
    /**
     * 文档对象在打开期间不变。只缓存正文就是文件内容时算出的值：就绪，或外部删除后保留着正文；加载中与加载失败时不缓存。
     * 删除后也要缓存：否则到点算完、缓存的修订号仍旧，又排一次计时，字数停在旧值并反复重算。
     */
    const counts = new WeakMap<TextDocument, {readonly revision: number; readonly count: number}>();
    /** 延后的计算算完时加一，让条目文字重新求值。 */
    const settled = shallowRef(0);
    let shownDocument: TextDocument | null = null;
    let pending: {readonly revision: number; readonly cancel: () => void} | null = null;

    const cancelPending = (): void => {
        pending?.cancel();
        pending = null;
    };
    const countNow = (document: TextDocument, revision: number): number => {
        const count = countWords(document.text.value, dialects);
        if (document.status.value === "ready" || document.status.value === "deleted") counts.set(document, {revision, count});
        return count;
    };

    return () => {
        void settled.value;
        const document = area.value?.activeDocument.value ?? null;
        if (document === null) return 0;
        const revision = document.revision.value;
        const cached = counts.get(document);
        if (document !== shownDocument || cached === undefined) {
            shownDocument = document;
            cancelPending();
            return cached?.revision === revision ? cached.count : countNow(document, revision);
        }
        if (cached.revision === revision) return cached.count;
        if (pending?.revision !== revision) {
            cancelPending();
            const cancel = clock.schedule(() => {
                pending = null;
                countNow(document, document.revision.value);
                settled.value += 1;
            }, WORD_COUNT_DELAY_MS);
            pending = {revision, cancel};
        }
        return cached.count;
    };
}

/** 编辑器的条目自己翻好文字，给的都是字符串（条目的合同允许任何文字值）。 */
type ResolvedItem = Omit<ItemImplementation, "text" | "tooltip"> & {text(): string; tooltip?(): string};

/** `dialects`：方言声明表（docs/specs/workspace/markdown-syntaxes.md 输出 9、10），在一个窗口的寿命内不变。 */
export function editorStatusItems(area: Readonly<ShallowRef<EditorArea | null>>, clock: RuntimeClock, languages: Pick<LanguageRegistry, "name">, dialects: DialectTable, text: TextResolver): Readonly<Record<string, ResolvedItem>> {
    const wordCount = activeWordCount(area, clock, dialects);
    const unsaved = () => area.value?.openDocuments.value.filter(needsSaving) ?? [];
    const failures = () => unsaved().filter((document) => document.saveProblem.value !== null);
    return {
        [UNSAVED_ITEM]: {
            text: () => text.t(editorText("status.unsaved", {count: unsaved().length})),
            tooltip: () => {
                const documents = unsaved();
                const lines = [
                    ...failures().map((document) => text.t(editorText("status.failed", {path: shown(document.target.value.path), reason: document.saveProblem.value?.detail ?? ""}))),
                    ...(documents.some((document) => document.saving.value) ? [text.t(editorText("status.saving"))] : []),
                    ...documents.slice(0, LISTED).map((document) => shown(document.target.value.path)),
                    ...(documents.length > LISTED ? [text.t(editorText("status.more", {count: documents.length - LISTED}))] : []),
                ];
                return lines.join("\n");
            },
            state: () => (failures().length > 0 ? "error" : "normal"),
        },
        [WORD_COUNT_ITEM]: {
            text: () => text.t(editorText("status.words", {count: wordCount()})),
        },
        [EDITOR_STATUS_ITEM]: {
            text: () => {
                const status = area.value?.activeHandle.value?.status?.value ?? null;
                return status === null ? "" : text.t(status);
            },
        },
        [LANGUAGE_ITEM]: {
            text: () => {
                const language = area.value?.activeHandle.value?.language?.value ?? null;
                return language === null ? "" : text.t(languages.name(language));
            },
        },
        [CURSOR_ITEM]: {
            text: () => {
                const position = area.value?.activeHandle.value?.position?.value ?? null;
                return position === null ? "" : text.t(editorText("status.cursor", {line: position.line, column: position.column}));
            },
        },
    };
}
