/** 编辑器插件测试用的翻译端口：窗口同款的宿主引擎，登记了 `nbook.editor` 的目录，严格模式下缺键、缺插值参数抛错。 */

import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {DisplayLocale, DisplayText} from "nbook/shared/localized-text";
import {testTextPort} from "nbook/shared/testing/text-port";

import {editorCatalogs} from "../web/text";

const ports = new Map<DisplayLocale, TextPort>();

export function editorTestText(locale: DisplayLocale = "zh-CN"): TextPort {
    let port = ports.get(locale);
    if (port === undefined) {
        port = testTextPort(locale, {"nbook.editor": editorCatalogs});
        ports.set(locale, port);
    }
    return port;
}

/** 动作或命令失败的原因按某种语言取成用户看到的那句，成功为 null：原因是文字值，断言整句而不是引用。 */
export function reasonText(result: {readonly ok: true} | {readonly ok: false; readonly reason: DisplayText}, locale: DisplayLocale = "zh-CN"): string | null {
    return result.ok ? null : editorTestText(locale).t(result.reason);
}
