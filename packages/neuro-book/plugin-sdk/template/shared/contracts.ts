/**
 * 插件 id 与设置项。插件里出现的 id（视图、命令、设置分区）都以插件 id 加“.”开头，别的插件就不会和它撞名。
 */

import {defineSetting, SETTINGS_SECTIONS_POINT} from "@notnotype/nb-plugin-sdk";
import type {ContributionDeclaration, SettingsSectionDeclaration} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

export const PLUGIN_ID = "__ID__";

/** 设置窗口左栏里本插件的分区；设置项写进它。 */
export const section: ContributionDeclaration<SettingsSectionDeclaration> = {
    capability: SETTINGS_SECTIONS_POINT,
    id: `${PLUGIN_ID}.main`,
    declaration: {
        title: {"zh-CN": "__DISPLAY_NAME__", "en-US": "__DISPLAY_NAME__"},
        icon: "i-lucide-hand",
        category: "plugins",
        groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}],
    },
};

/** 问候语：视图里显示它；在设置窗口里改了，视图立刻跟着变。 */
export const greeting = defineSetting({
    plugin: PLUGIN_ID,
    name: "greeting",
    schema: Type.String({maxLength: 80}),
    default: "你好",
    title: {"zh-CN": "问候语", "en-US": "Greeting"},
    layers: ["user"],
    applies: "now",
    section: section.id,
    group: "basic",
});
