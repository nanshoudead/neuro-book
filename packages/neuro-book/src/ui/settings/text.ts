/**
 * 设置页排版组件（`SettingsRow`、`SettingsPageList`、`SettingsSaveBar`）与 `setting-text.ts` 的文字引用：文字在 `nbook.settings`
 * 的消息目录里（`plugins/settings/locales/`，docs/specs/ui/i18n.md）。共享前端组件只能引 `ui/` 与 `shared/`，取不到
 * 插件里的带类型取文字函数，所以这里列出本目录用到的键：`plugins/settings/locales.test.ts` 核对它们都在源语言目录里，
 * 写错的键编译不过。这些组件经 SDK 交给第三方插件的设置页，宿主窗口总会登记 `nbook.settings` 的目录。
 */

import {textRef} from "@notnotype/nb-ui/text";
import type {TextParams, TextRef} from "@notnotype/nb-ui/text";

/** 这个目录用到的全部键；复数形归到不带后缀的键。 */
export const SETTINGS_UI_KEYS = [
    "row.reset",
    "row.inherited",
    "row.remove",
    "row.modified",
    "row.readOnly",
    "row.overridden",
    "row.overriddenUntitled",
    "row.userOnly",
    "row.projectOnly",
    "pageList.back",
    "pageList.modified",
    "saveBar.save",
    "saveBar.discard",
    "saveBar.unsaved",
    "value.on",
    "value.off",
    "value.empty",
    "value.items",
    "applies.next-run",
    "applies.next-session",
    "applies.restart",
    "writeFailure.layerInvalid",
    "writeFailure.writeFailed",
    "writeFailure.unavailable",
    "writeFailure.invalidValue",
    "writeFailure.unknownOutcome",
    "writeFailure.conflict",
    "writeFailure.other",
] as const;

export type SettingsUiKey = (typeof SETTINGS_UI_KEYS)[number];

/** `nbook.settings` 命名空间下的文字引用；参数 `count` 必须是数字（复数选择）。 */
export function settingsUiText(key: SettingsUiKey, params?: TextParams): TextRef {
    return textRef(key, params, "nbook.settings");
}
