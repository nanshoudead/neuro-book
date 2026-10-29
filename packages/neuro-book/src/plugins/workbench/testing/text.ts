/** 工作台测试用的翻译端口：窗口同款引擎，登记了 `nbook.workbench` 的目录，严格模式下缺键、缺插值参数抛错。 */

import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {testTextPort} from "nbook/shared/testing/text-port";

import {workbenchCatalogs} from "../web/text";

export function workbenchTestText(locale: DisplayLocale = "zh-CN"): TextPort {
    return testTextPort(locale, {"nbook.workbench": workbenchCatalogs});
}

/** 命令失败的原因按某种语言取成字符串，成功为 null：原因是文字值，断言用户看到的那句。 */
export function failureText(result: CommandResult<unknown>, locale: DisplayLocale = "zh-CN"): string | null {
    return result.ok ? null : workbenchTestText(locale).t(result.reason);
}
