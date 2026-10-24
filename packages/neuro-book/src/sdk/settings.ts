/**
 * 插件 SDK 的 `/settings`：内置插件 `nbook.settings` 的设置项与设置窗口的 list 分区（docs/specs/settings/configuration.md、
 * docs/specs/settings/settings-window.md）。服务端也加载，不能引用 Vue；设置页与选项来源在 `/settings/browser`。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {section, setting} from "./settings-helpers";
export type {SectionHelper} from "./settings-helpers";

export {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
export {SETTINGS_CHOICES_POINT, SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, settingsChoicesEvent} from "nbook/plugins/settings/shared/sections";
export type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionCategory, SettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
export {defineSetting} from "nbook/shared/settings";
export type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService, SettingWriteResult} from "nbook/shared/settings";
