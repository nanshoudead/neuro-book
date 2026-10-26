/**
 * 资源管理器的两个设置项与它们所在的设置分区（docs/specs/workbench/files-explorer.md 的“行的样子”）。声明是纯数据：插件
 * 描述里登记设置项，浏览器入口贡献分区。
 */

import {Type} from "typebox";

import type {SettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {defineSetting} from "nbook/shared/settings";

export const EXPLORER_SECTION = "nbook.explorer";

export const EXPLORER_SECTION_DECLARATION: SettingsSectionDeclaration = {
    title: {"zh-CN": "资源管理器", "en-US": "Explorer"},
    description: {"zh-CN": "文件树的显示", "en-US": "How the file tree looks"},
    icon: "i-lucide-files",
    category: "app",
    order: 20,
    groups: [{id: "tree", title: {"zh-CN": "文件树", "en-US": "File Tree"}}],
};

/** 缩进参考线：不画、鼠标在树上或树有焦点时画、一直画。 */
export const indentGuidesSetting = defineSetting({
    plugin: "nbook.explorer",
    name: "indentGuides",
    schema: Type.Union([Type.Literal("none"), Type.Literal("hover"), Type.Literal("always")]),
    default: "hover",
    title: {"zh-CN": "缩进参考线", "en-US": "Indent Guides"},
    description: {"zh-CN": "每层一条竖线，焦点所在那一层加深", "en-US": "A line per level; the focused level is darker"},
    section: EXPLORER_SECTION,
    group: "tree",
    order: 10,
    choices: [
        {value: "none", title: {"zh-CN": "不显示", "en-US": "None"}},
        {value: "hover", title: {"zh-CN": "悬停时显示", "en-US": "On Hover"}},
        {value: "always", title: {"zh-CN": "一直显示", "en-US": "Always"}},
    ],
});

/** 隐藏 `.md`：只改显示，改名框与悬停提示仍是完整名字。 */
export const hideMarkdownExtensionSetting = defineSetting({
    plugin: "nbook.explorer",
    name: "hideMarkdownExtension",
    schema: Type.Boolean(),
    default: false,
    title: {"zh-CN": "隐藏 Markdown 扩展名", "en-US": "Hide Markdown Extension"},
    description: {"zh-CN": "改名时仍显示完整名字", "en-US": "Renaming still shows the full name"},
    section: EXPLORER_SECTION,
    group: "tree",
    order: 20,
});
