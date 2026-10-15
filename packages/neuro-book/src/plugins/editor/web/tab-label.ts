/** 标签显示的名字：标签条与拖动标签的拖影共用，两处写的是同一个名字。 */

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {EditorArea} from "./area";
import type {EditorTab} from "./groups/groups";
import {editorText, nameOf} from "./messages";
import {pageIdOf} from "./pages";
import type {EditorPageSource} from "./pages";

export function tabLabel(area: EditorArea, tab: EditorTab, locale: DisplayLocale, pages: EditorPageSource | null): string {
    // 页面标签（docs/specs/workbench/editor.md 输出 33）按页面的标题显示；贡献方停了、标题取不到时显示页面 id。
    const page = pageIdOf(tab.address);
    if (page !== null) return pages?.title(page, locale) ?? page;
    // 预览视图的标题写“预览 a.html”（输出 47），与同组里这个文件的源码标签分得开。
    const preview = tab.kind === "file" && area.editors.declaration(tab.editor)?.role === "preview";
    return preview ? editorText(locale, "previewOf", {name: nameOf(tab.address)}) : nameOf(tab.address);
}
