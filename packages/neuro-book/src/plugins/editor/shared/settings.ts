/**
 * 编辑器区的设置项与它们所在的设置分区（docs/specs/workbench/editor.md 输出 52）。声明是纯数据：插件描述里登记设置项，
 * 浏览器入口贡献分区。
 */

import {Type} from "typebox";

import type {SettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {defineSetting} from "nbook/shared/settings";

export const EDITOR_SECTION = "nbook.editor";

export const EDITOR_SECTION_DECLARATION: SettingsSectionDeclaration = {
    title: {"zh-CN": "编辑器", "en-US": "Editor"},
    description: {"zh-CN": "标签栏与面包屑", "en-US": "Tabs and breadcrumbs"},
    icon: "i-lucide-square-pen",
    category: "app",
    order: 30,
    kind: "list",
    groups: [{id: "tabs", title: {"zh-CN": "标签", "en-US": "Tabs"}}],
};

/** 预览标签页：关掉时单击打开也是常驻标签，已有的 preview 标签立即转正。 */
export const enablePreviewSetting = defineSetting({
    plugin: "nbook.editor",
    name: "enablePreview",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "预览标签页", "en-US": "Preview Tabs"},
    description: {"zh-CN": "单击打开的文件先占一个可被替换的标签，编辑或双击后转为常驻", "en-US": "A single click opens a replaceable tab that becomes permanent once edited or double-clicked"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 10,
});

/** 多行标签：放不下时换行，固定标签单独一行；关掉时一行横向滚动。 */
export const wrapTabsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "wrapTabs",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "多行标签", "en-US": "Wrap Tabs"},
    description: {"zh-CN": "标签放不下时换行，固定的标签单独一行", "en-US": "Wrap tabs that do not fit; pinned tabs get a row of their own"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 20,
});

/** 面包屑：标签栏下面的路径与 Markdown 的标题。 */
export const breadcrumbsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "breadcrumbs",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "面包屑", "en-US": "Breadcrumbs"},
    description: {"zh-CN": "标签栏下面显示文件的路径与光标所在的标题", "en-US": "Show the file path and the current heading below the tabs"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 30,
});
