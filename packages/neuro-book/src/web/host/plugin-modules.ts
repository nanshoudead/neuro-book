/**
 * 浏览器的宿主模块表（docs/specs/runtime/plugin-code-loading.md 的术语）：第三方插件代码 `require` 到的共享模块，就是宿主
 * 自己用的这一份。键与平台档案（`nbook/plugin-platform-profile`）的 `BROWSER_SHARED_MODULES` 一一对应，构建预设按同一张表留外部引用。
 *
 * 由装载器在第一次装载第三方入口时动态导入：没有第三方浏览器入口的窗口不必为它付出加载成本。模块命名空间对象不能直接
 * 冻结（会抛错），先复制再冻结。
 */

import * as reactivity from "@vue/reactivity";
import * as typebox from "typebox";
import * as typeboxCompile from "typebox/compile";
import * as typeboxValue from "typebox/value";
import * as vue from "vue";

import * as sdkCommands from "nbook/sdk/commands";
import * as sdkComponents from "nbook/sdk/components";
import * as sdk from "nbook/sdk/index";
import * as sdkSettings from "nbook/sdk/settings";
import * as sdkSettingsBrowser from "nbook/sdk/settings-browser";
import * as sdkState from "nbook/sdk/state";
import * as sdkStorage from "nbook/sdk/storage";
import * as sdkWorkbench from "nbook/sdk/workbench";
import type {BrowserSharedModule} from "nbook/plugin-platform-profile";

export function hostModules(): Readonly<Record<BrowserSharedModule, unknown>> {
    const table = {
        "vue": vue,
        "@vue/reactivity": reactivity,
        "typebox": typebox,
        "typebox/value": typeboxValue,
        "typebox/compile": typeboxCompile,
        "@notnotype/nb-plugin-sdk": sdk,
        "@notnotype/nb-plugin-sdk/state": sdkState,
        "@notnotype/nb-plugin-sdk/storage": sdkStorage,
        "@notnotype/nb-plugin-sdk/settings": sdkSettings,
        "@notnotype/nb-plugin-sdk/settings/browser": sdkSettingsBrowser,
        "@notnotype/nb-plugin-sdk/commands": sdkCommands,
        "@notnotype/nb-plugin-sdk/workbench": sdkWorkbench,
        "@notnotype/nb-plugin-sdk/components": sdkComponents,
    } satisfies Record<BrowserSharedModule, object>;
    return Object.freeze(Object.fromEntries(Object.entries(table).map(([id, module]) => [id, Object.freeze({...module})]))) as Readonly<Record<BrowserSharedModule, unknown>>;
}
