/**
 * `nbook.settings` 拥有的贡献点（docs/specs/settings/configuration.md 输出 1–3，settings-window.md“分区声明”）与已接受
 * 声明的查询。
 *
 * `settings.properties` 与 list 分区的 `settings.sections` 是写在描述里的顶层声明，三个位置的定义都带它们，每个实例
 * 都能校验；page 分区的 `settings.pages` 与选项提供者的 `settings.choices` 要有浏览器入口交出的实现，只在浏览器的定义里。
 */

import type {ContributionDeclarations, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";

import {freezeJson, SETTINGS_POINT, settingDeclarationProblem} from "nbook/shared/settings";
import type {SettingDeclaration} from "nbook/shared/settings";

import type {DeclaredSetting} from "./layers";
import {SETTINGS_CHOICES_POINT, SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, validateChoiceContribution, validatePageContribution, validateSectionContribution} from "./sections";
import type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionDeclaration} from "./sections";

export const settingsPoint: ContributionPointDefinition<SettingDeclaration> = {
    id: SETTINGS_POINT,
    implementation: "none",
    validate: (descriptor) => settingDeclarationProblem(descriptor.plugin, descriptor.id, descriptor.declaration),
};

export const sectionsPoint: ContributionPointDefinition<SettingsSectionDeclaration> = {
    id: SETTINGS_SECTIONS_POINT,
    implementation: "none",
    validate: validateSectionContribution,
};

/** page 分区交 `{load()}`；交出的实现没有 `load()` 由接收者在加载时核对（`web/sections.ts`）。 */
export const pagesPoint: ContributionPointDefinition<SettingsPageDeclaration> = {
    id: SETTINGS_PAGES_POINT,
    implementation: "required",
    validate: validatePageContribution,
};

/** 选项提供者交 `{source()}`；交出的实现没有 `source()` 由注册表在取选项时核对（`web/choices.ts`）。只在浏览器的定义里。 */
export const choicesPoint: ContributionPointDefinition<SettingsChoicesDeclaration> = {
    id: SETTINGS_CHOICES_POINT,
    implementation: "required",
    validate: validateChoiceContribution,
};

/**
 * 本实例已接受的全部声明：键 → 声明者与声明。默认值在这里复制并深冻结：有效值可能就是默认值本身，而不经
 * `defineSetting` 写出的声明（以后的清单 JSON）没有被冻结过，读取方改了它就改了别的读取方看到的值。
 */
export function acceptedSettings(declarations: ContributionDeclarations): ReadonlyMap<string, DeclaredSetting> {
    return new Map(declarations.list<SettingDeclaration>(SETTINGS_POINT).map((descriptor) => [descriptor.id, {plugin: descriptor.plugin, declaration: settled(descriptor.declaration)}]));
}

function settled(declaration: SettingDeclaration): SettingDeclaration {
    return Object.freeze({...declaration, default: freezeJson(declaration.default), layers: Object.freeze([...declaration.layers])});
}
