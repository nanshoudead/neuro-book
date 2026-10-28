/**
 * 设置测试里取 `nbook.settings` 目录文字的写法：断言用目录解析出来的字符串，不在测试里重复写一份中文。
 * 与窗口引擎同一套规则（见 `nbook/shared/testing/text`），登记的是本插件的目录，所以 `TextRef` 能解析。
 */

import type {TextParams} from "@notnotype/nb-ui/text";

import type {DisplayLocale, TextResolver} from "nbook/shared/localized-text";
import {textIn} from "nbook/shared/testing/text";

import {settingsText} from "../shared/text";
import type {SettingsTextKey} from "../shared/text";
import {settingsCatalogs} from "../web/text";

export interface SettingsTestText {
    /** 窗口模型要的解析器：本插件的目录已登记。 */
    readonly resolver: TextResolver;
    /** 取一条目录文字的某一种语言的结果。 */
    t(key: SettingsTextKey, params?: TextParams): string;
}

export function settingsTestText(locale: DisplayLocale = "zh-CN"): SettingsTestText {
    const resolver = textIn(locale, {"nbook.settings": settingsCatalogs.catalogs});
    return {resolver, t: (key, params) => resolver.t(settingsText(key, params))};
}
