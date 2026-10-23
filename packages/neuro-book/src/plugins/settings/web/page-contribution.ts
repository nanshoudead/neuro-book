/**
 * 一个 page 分区的贡献、激活事件与实现，分区 id 只写一次（docs/specs/settings/settings-window.md“分区声明”）。给插件作者
 * 用，经 SDK 的 `@notnotype/nb-plugin-sdk/browser` 导出。
 *
 * 不用它时作者要在三处写同一个分区 id、手拼 `{capability, id, declaration}`，而贡献的 `declaration` 在内核里是 `unknown`：
 * 字段写错要到运行时才被设置窗口拒掉、分区静默不出现。这里按 `SettingsPageDeclaration` 核对声明。
 */

import type {Component} from "vue";

import {settingsPage} from "nbook/ui/settings/settings-page";

import {SETTINGS_PAGES_POINT, settingsPageEvent} from "../shared/contracts";
import type {SettingsPageDeclaration} from "../shared/contracts";
import type {SettingsPageImplementation} from "./contracts";

export interface SettingsPageContribution<Id extends string> {
    readonly id: Id;
    /** 写进入口的 `activationEvents`：设置窗口第一次显示这个分区时才激活入口。 */
    readonly activationEvent: string;
    /** 写进入口的 `contributions`。 */
    readonly contribution: {readonly capability: typeof SETTINGS_PAGES_POINT; readonly id: Id; readonly declaration: SettingsPageDeclaration};
    /** 激活时交出的实现，放在 `contributions[SETTINGS_PAGES_POINT][id]`；`props` 同 `settingsPage`。 */
    implementation(props?: () => Readonly<Record<string, unknown>>): SettingsPageImplementation;
}

export function settingsPageContribution<const Id extends string>(options: {
    readonly id: Id;
    readonly declaration: SettingsPageDeclaration;
    readonly load: () => Promise<Component | {readonly default: Component}>;
}): SettingsPageContribution<Id> {
    return {
        id: options.id,
        activationEvent: settingsPageEvent(options.id),
        contribution: {capability: SETTINGS_PAGES_POINT, id: options.id, declaration: options.declaration},
        implementation: (props) => settingsPage(options.load, props),
    };
}
