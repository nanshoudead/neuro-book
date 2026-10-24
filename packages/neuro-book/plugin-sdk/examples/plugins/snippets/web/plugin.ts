/**
 * `example.snippets` 的浏览器入口：向设置窗口贡献一个 page 分区，自己画片段列表的编辑页。读这个文件学三件事：
 *
 * 1. **什么时候用 page 分区，而不是 list 分区**：list 分区由设置窗口按配置项的 schema 画控件，插件只写声明、不写界面；
 *    但通用控件只有开关、选项、数字与单行文字，别的类型只读显示（docs/specs/settings/settings-window.md 输出第 9 条）。
 *    片段是对象的数组，要增删改、排顺序，只能由插件自己画，所以向 `settings.pages` 贡献 page 分区。值是普通开关、选项时，
 *    写 `section` 指向一个 list 分区（或干脆不写，落到“其它”）就够了，不要为它写页面。list 分区是向 `settings.sections`
 *    的顶层声明，写在插件描述里，没有实现，也就不需要入口。
 * 2. **页面怎样拿到配置服务**：页面组件里不能解析服务。入口激活时拿到**本插件自己的**配置服务（`settingsKey`），用
 *    `page.implementation` 包出实现，页面除了 `context` 还收到 `settings`。页面只能用它写本插件声明的项（configuration.md
 *    输出第 11 条）。
 * 3. **按需激活、交付与撤回**：分区的声明在入口激活前就在设置窗口的左栏里。入口声明激活事件
 *    `onSettingsPage:<分区 id>`，不启动即激活：用户在设置窗口里打开这个分区时，`nbook.settings` 触发这个事件，入口这时
 *    才激活（窗口显示“正在等待……启动”）；实现交给设置窗口，第一次显示时才调用 `load()`；入口停止时内核撤回实现，窗口
 *    原位显示停止原因（settings-window.md 输出第 1、4、5 条）。
 *
 * 对应的场景：`scenarios/06-settings-page.test.ts`。
 */

import {defineEntry, SETTINGS_PAGES_POINT, settingsKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {settingsPageContribution} from "@notnotype/nb-plugin-sdk/browser";

import {descriptor} from "../plugin";
import {SNIPPETS_SECTION} from "../shared/contracts";

/**
 * 分区的贡献、激活事件与实现由 `settingsPageContribution` 一次给出：分区 id 只写一次，声明按 SDK 的
 * `SettingsPageDeclaration` 核对，字段写错编译就不过（不经它时内核只把声明当作 `unknown`，要到运行时才被设置窗口拒掉、
 * 分区静默不出现）。页面组件按需加载：设置窗口第一次显示这个分区时才调用 `load`。`.vue` 只在这里动态导入：场景测试在
 * Bun 里导入本文件，Bun 不能加载 `.vue`。
 */
const page = settingsPageContribution({
    id: SNIPPETS_SECTION,
    declaration: {
        title: {"zh-CN": "常用片段", "en-US": "Snippets"},
        description: {"zh-CN": "写作时常用的固定文字", "en-US": "Fixed text you insert often"},
        icon: "i-lucide-text-quote",
        category: "plugins",
        layout: "column",
    },
    load: () => import("./SnippetsPage.vue"),
});

export const snippetsBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 打开这个分区时才激活：没打开过设置的窗口不启动这个入口。前缀 `onSettingsPage` 归 `nbook.settings`，只有它能触发。
        activationEvents: [page.activationEvent],
        dependencies: [{key: settingsKey}],
        contributions: [page.contribution],
        activate: (context) => {
            const settings = context.services.require(settingsKey);
            // 页面除了设置窗口给的 `context`，还收到本插件自己的配置服务。
            return {contributions: {[SETTINGS_PAGES_POINT]: {[page.id]: page.implementation(() => ({settings}))}}};
        },
    })],
};
