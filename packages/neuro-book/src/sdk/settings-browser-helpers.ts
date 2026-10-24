/**
 * `nbook.settings` 只在浏览器里有意义的贡献助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：设置页与选项来源。SDK 的
 * `/settings/browser` 导出它们（要 Vue）；分区与设置项在 `/settings`。第一个参数是 `plugin`，带 `where: "browser"`。
 */

import type {MaybeRefOrGetter} from "vue";

import type {OptionSource} from "@notnotype/nb-form";

import {SETTINGS_CHOICES_POINT, settingsChoicesEvent} from "nbook/plugins/settings/shared/sections";
import type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import type {SettingsChoicesImplementation} from "nbook/plugins/settings/web/contracts";
import {settingsPageContribution} from "nbook/plugins/settings/web/page-contribution";

import {bound, contributionId, localizedText} from "./plugin";
import type {BoundImplementation, ContributionHelper, PluginBuilder, ShortNameRule, Text} from "./plugin";
import type {ComponentLoad, PropsOf} from "./workbench-helpers";

export interface SettingsPageHelper<Id extends string, Load extends ComponentLoad> extends ContributionHelper<"settings.pages", Id, SettingsPageDeclaration> {
    readonly where: "browser";
    implement(props?: () => PropsOf<Load>): BoundImplementation<"settings.pages", Id>;
}

/**
 * 设置窗口的 page 分区：插件自己画页面，每一项用 `SettingsRow` 排。`category` 缺省 `plugins`。设置窗口第一次显示这个分区时
 * 才激活入口：激活事件由 `plugin.entry` 自动并入。
 */
export function settingsPage<const Id extends string, const Name extends string, const Load extends ComponentLoad>(plugin: PluginBuilder<Id>, options: Omit<SettingsPageDeclaration, "title" | "description" | "category" | "keywords"> & {
    readonly name: Name;
    readonly title: Text;
    readonly description?: Text;
    readonly category?: SettingsPageDeclaration["category"];
    readonly keywords?: ReadonlyArray<Text>;
    readonly load: Load;
} & ShortNameRule<Name>): SettingsPageHelper<`${Id}.${Name}`, Load> {
    const id = contributionId(plugin.id, options.name, "设置页");
    const {name: _name, title, description, category, keywords, load, ...rest} = options;
    const helper = settingsPageContribution({
        id,
        declaration: {
            ...rest,
            title: localizedText(title),
            ...(description === undefined ? {} : {description: localizedText(description)}),
            category: category ?? "plugins",
            ...(keywords === undefined ? {} : {keywords: keywords.map(localizedText)}),
        },
        load,
    });
    return {
        id,
        contribution: helper.contribution,
        where: "browser",
        activationEvents: [helper.activationEvent],
        implement: (props) => bound(helper.contribution.capability, id, helper.implementation(props as (() => Readonly<Record<string, unknown>>) | undefined)),
    };
}

export interface ChoicesHelper<Id extends string> extends ContributionHelper<typeof SETTINGS_CHOICES_POINT, Id> {
    readonly where: "browser";
    /** 给设置项的下拉列表供选项；设置项的 `choices` 写 `{from: 这个助手.id}`。 */
    implement(source: () => MaybeRefOrGetter<OptionSource<string>>): BoundImplementation<typeof SETTINGS_CHOICES_POINT, Id>;
}

/** 选项来源：设置窗口要它的选项时才激活入口，激活事件由 `plugin.entry` 自动并入。 */
export function choices<const Id extends string, const Name extends string>(plugin: PluginBuilder<Id>, options: {readonly name: Name} & ShortNameRule<Name>): ChoicesHelper<`${Id}.${Name}`> {
    const id = contributionId(plugin.id, options.name, "选项来源");
    return {
        id,
        contribution: {capability: SETTINGS_CHOICES_POINT, id, declaration: {}},
        where: "browser",
        activationEvents: [settingsChoicesEvent(id)],
        implement: (source) => bound(SETTINGS_CHOICES_POINT, id, {source} satisfies SettingsChoicesImplementation),
    };
}
