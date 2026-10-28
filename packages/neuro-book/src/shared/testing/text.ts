/** 测试里把声明文字解析成某一种语言的字符串：与窗口引擎同一套规则（语言映射按语言取，字符串原样），没有目录，`TextRef` 显示键名。 */

import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import type {DisplayLocale, TextResolver} from "nbook/shared/localized-text";

export function textIn(locale: DisplayLocale, catalogs: Parameters<typeof createMinimalTranslator>[0]["catalogs"] = {}): TextResolver {
    const translator = createMinimalTranslator({catalogs});
    return {t: (text) => translator.translate(text, locale), variants: translator.variants};
}
