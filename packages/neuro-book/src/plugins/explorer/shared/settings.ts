/**
 * 资源管理器的两个设置项与它们所在的设置分区（docs/specs/workbench/files-explorer.md 的“行的样子”）。声明是纯数据：插件
 * 描述里登记设置项，浏览器入口贡献分区。必填的标题省略，登记时补成约定键；可选的说明写文字引用（`shared/text.ts`）。
 */

import {Type} from "typebox";

import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {defineSetting} from "nbook/shared/settings";

import {explorerText} from "./text";

export const EXPLORER_SECTION = "nbook.explorer";

export const EXPLORER_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    description: explorerText("settingsSections.nbook.explorer.description"),
    icon: "i-lucide-files",
    category: "app",
    order: 20,
    groups: [{id: "tree"}],
};

/** 缩进参考线：不画、鼠标在树上或树有焦点时画、一直画。 */
export const indentGuidesSetting = defineSetting({
    plugin: "nbook.explorer",
    name: "indentGuides",
    schema: Type.Union([Type.Literal("none"), Type.Literal("hover"), Type.Literal("always")]),
    default: "hover",
    description: explorerText("settings.indentGuides.description"),
    section: EXPLORER_SECTION,
    group: "tree",
    order: 10,
    choices: [
        {value: "none"},
        {value: "hover"},
        {value: "always"},
    ],
});

/** 隐藏 `.md`：只改显示，改名框与悬停提示仍是完整名字。 */
export const hideMarkdownExtensionSetting = defineSetting({
    plugin: "nbook.explorer",
    name: "hideMarkdownExtension",
    schema: Type.Boolean(),
    default: false,
    description: explorerText("settings.hideMarkdownExtension.description"),
    section: EXPLORER_SECTION,
    group: "tree",
    order: 20,
});
