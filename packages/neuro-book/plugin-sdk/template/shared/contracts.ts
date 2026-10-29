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

/*
 * 界面文字写在消息目录 `locales/<语言>.json` 里（`package.json` 的 `l10n.source` 是源语言），NeuroBook 按界面语言翻译。
 * 声明里必填的 `title` 不写，宿主登记时补成约定键 `<短名>.<本地 id>.<字段>`：分区是 `settingsSections.main.title`、小组是
 * `settingsSections.main.groups.basic.title`、设置项是 `settings.greeting.title`，目录里写上这些键即可。也可以直接写一个字符串，
 * 那是不翻译的字面文字，两种界面语言显示同一句。规则见 SDK 包里的 README 的“界面文字”。
 */

/** 设置窗口左栏里本插件的分区；设置项写进它。 */
export const main = section(plugin, {name: "main", icon: "i-lucide-hand", groups: [{id: "basic"}]});

/** 问候语：视图里显示它；在设置窗口里改了，视图立刻跟着变。 */
export const greeting = setting(plugin, {
    name: "greeting",
    schema: Type.String({maxLength: 80}),
    default: "你好",
    layers: ["user"],
    applies: "now",
    // `section` 收分区本身，`group` 只能是它的组：写错编译不过。
    section: main,
    group: "basic",
});
