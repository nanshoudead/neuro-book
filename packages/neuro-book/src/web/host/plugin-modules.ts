/**
 * 浏览器的宿主模块表（docs/specs/runtime/plugin-code-loading.md 的术语）：第三方插件代码 `require` 到的共享模块，就是宿主
 * 自己用的这一份。键与 `nbook/shared/plugin-modules` 的 `BROWSER_SHARED_MODULES` 一一对应，构建预设按同一张表留外部引用。
 *
 * 由装载器在第一次装载第三方入口时动态导入：没有第三方浏览器入口的窗口不必为它付出加载成本。模块命名空间对象不能直接
 * 冻结（会抛错），先复制再冻结。
 */

import * as reactivity from "@vue/reactivity";
import * as vue from "vue";

import * as sdkBrowser from "nbook/sdk/browser";
import * as sdkComponents from "nbook/sdk/components";
import * as sdk from "nbook/sdk/index";
import type {BROWSER_SHARED_MODULES} from "nbook/shared/plugin-modules";

export function hostModules(): Readonly<Record<(typeof BROWSER_SHARED_MODULES)[number], unknown>> {
    const table = {
        "vue": vue,
        "@vue/reactivity": reactivity,
        "@notnotype/nb-plugin-sdk": sdk,
        "@notnotype/nb-plugin-sdk/browser": sdkBrowser,
        "@notnotype/nb-plugin-sdk/components": sdkComponents,
    } satisfies Record<(typeof BROWSER_SHARED_MODULES)[number], object>;
    return Object.freeze(Object.fromEntries(Object.entries(table).map(([id, module]) => [id, Object.freeze({...module})]))) as Readonly<Record<(typeof BROWSER_SHARED_MODULES)[number], unknown>>;
}
