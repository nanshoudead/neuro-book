/**
 * 编辑器的公开状态（docs/specs/workbench/editor.md 的“输入与前置条件”）：命令 `when` 要读的布尔键，对应命令目录第一批
 * 的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`，另加 `dirty`；以及资源管理器揭示活动文件
 * 要读的 `ready` 与 `activeDocument`。
 */

import {computed} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";
import type {PublicBindings} from "nbook/shared/store/public";

import type {EditorArea} from "./area";
import type {TextDocument} from "./documents/store";

const reason = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

export const editorState = definePublicState("nbook.editor", {
    focused: {type: "boolean", unready: false, reason: reason("编辑区没有焦点", "The editor does not have focus")},
    active: {type: "boolean", unready: false, reason: reason("没有活动的编辑器", "There is no active editor")},
    writable: {type: "boolean", unready: false, reason: reason("活动的编辑器是只读的", "The active editor is read-only")},
    lineNavigation: {type: "boolean", unready: false, reason: reason("活动的编辑器不支持跳转到行", "The active editor cannot go to a line")},
    dirty: {type: "boolean", unready: false, reason: reason("活动文档没有未保存的修改", "The active document has no unsaved changes")},
    hasUnsavedDocuments: {type: "boolean", unready: false, reason: reason("没有需要保存的文档", "No document needs saving")},
    hasCursorPosition: {type: "boolean", unready: false, reason: reason("活动的编辑器不给出光标位置", "The active editor does not report a cursor position")},
    // 编辑器区建好了（绑定项目的窗口读完会话记录之后）与活动标签的地址：资源管理器在打开作品时揭示恢复出的活动文件
    // （docs/specs/workbench/files-explorer.md）。地址取标签的，文档还没读到也有。
    ready: {type: "boolean", unready: false, reason: reason("编辑器区还没建立", "The editor area is not ready yet")},
    activeDocument: {type: "string", unready: ""},
    // 活动标签有文本文档（字数要它）；与 `active` 分开：图片这类字节标签是活动的编辑器，但没有正文（输出 41）。
    hasDocument: {type: "boolean", unready: false, reason: reason("活动的编辑器没有文本", "The active editor has no text")},
    // 活动标签的编辑器 id（输出 36）；页面或空组为空串。
    activeEditor: {type: "string", unready: ""},
    // 活动控件交出了一行状态（输出 42）：状态栏的编辑器状态条目据此显示。
    hasEditorStatus: {type: "boolean", unready: false, reason: reason("活动的编辑器没有状态可显示", "The active editor reports no status")},
});

/** 文档需要保存：dirty 或有未裁决输入（与关闭时询问的判据相同，输出 4、26）。 */
export function needsSaving(document: TextDocument): boolean {
    return document.dirty.value || document.unresolved.value.length > 0;
}

/** 各公开键此刻的值；编辑器区还没建立时都为假。 */
export function editorStateValues(area: Readonly<ShallowRef<EditorArea | null>>): PublicBindings<typeof editorState.declarations> {
    const document = computed(() => area.value?.activeDocument.value ?? null);
    const handle = computed(() => area.value?.activeHandle.value ?? null);
    const fileTab = computed(() => {
        const tab = area.value?.groups.activeTab() ?? null;
        return tab === null || tab.kind === "page" ? null : tab;
    });
    return {
        focused: computed(() => area.value?.focused.value === true),
        // 有活动的文件标签、控件交出了句柄；不要求文本文档，字节标签上关闭、拆分照常可用（输出 41）。
        active: computed(() => handle.value !== null && fileTab.value !== null),
        // 视图能不能输入：预览视图与只读文档都不行（输出 48），撤销、重做随之不可用。
        writable: computed(() => handle.value !== null && area.value?.viewWritable(area.value.groups.activeGroup.value) === true),
        lineNavigation: computed(() => handle.value?.navigation !== undefined),
        dirty: computed(() => document.value?.dirty.value === true),
        hasUnsavedDocuments: computed(() => area.value?.openDocuments.value.some(needsSaving) === true),
        hasCursorPosition: computed(() => handle.value?.position?.value != null),
        ready: computed(() => area.value !== null),
        // 页面标签（欢迎页这类）不是文件，没有可揭示的地址。
        activeDocument: computed(() => fileTab.value?.address ?? ""),
        hasDocument: computed(() => document.value !== null),
        activeEditor: computed(() => fileTab.value?.editor ?? ""),
        hasEditorStatus: computed(() => fileTab.value !== null && handle.value?.status?.value != null),
    };
}
