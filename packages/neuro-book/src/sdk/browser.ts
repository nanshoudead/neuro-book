/**
 * 插件 SDK 只在浏览器入口里用的部分：要 Vue 或 DOM 的组件与工具。第三方插件以 `@notnotype/nb-plugin-sdk/browser` 导入；
 * 规则同 `index.ts`。
 */

export {settingsPageContribution} from "nbook/plugins/settings/web/page-contribution";
export type {SettingsPageContribution} from "nbook/plugins/settings/web/page-contribution";
export type {SettingsChoicesImplementation, SettingsPageContext} from "nbook/plugins/settings/web/contracts";

// 设置窗口给页面用的组件（docs/specs/settings/settings-window.md“给页面用的组件”）。
export {default as SettingsPageActions} from "nbook/ui/settings/SettingsPageActions.vue";
export {default as SettingsPageList} from "nbook/ui/settings/SettingsPageList.vue";
export {default as SettingsRow} from "nbook/ui/settings/SettingsRow.vue";
export {default as SettingsSaveBar} from "nbook/ui/settings/SettingsSaveBar.vue";
