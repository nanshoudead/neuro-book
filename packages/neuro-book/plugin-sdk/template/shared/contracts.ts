/**
 * 插件的对外一面：`definePlugin` 绑定插件 id，之后的贡献只写短名，id 由它拼成“插件 id 加 . 加短名”，别的插件就不会和
 * 它撞名。设置分区与设置项也写在这里：别的插件要读这个插件的设置项时从本模块取定义。
 *
 * 版本与运行位置要与 package.json、入口模块（`web/plugin.ts`）一致，构建时核对。
 */

import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {section, setting} from "@notnotype/nb-plugin-sdk/settings";
import {Type} from "typebox";

export const plugin = definePlugin({id: "__ID__", version: "0.1.0", locations: ["browser"]});

/** 设置窗口左栏里本插件的分区；设置项写进它。界面文字可以只写一个字符串（两种界面语言显示同一句）。 */
export const main = section(plugin, {name: "main", title: "__DISPLAY_NAME__", icon: "i-lucide-hand", groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}]});

/** 问候语：视图里显示它；在设置窗口里改了，视图立刻跟着变。 */
export const greeting = setting(plugin, {
    name: "greeting",
    schema: Type.String({maxLength: 80}),
    default: "你好",
    title: {"zh-CN": "问候语", "en-US": "Greeting"},
    layers: ["user"],
    applies: "now",
    // `section` 收分区本身，`group` 只能是它的组：写错编译不过。
    section: main,
    group: "basic",
});
