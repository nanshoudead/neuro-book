/**
 * 宿主支持的界面语言（docs/specs/ui/i18n.md、docs/specs/settings/configuration.md）。服务端、项目实例与浏览器共用这一份：
 * 语言设置的枚举、设置窗口里的选项与“切换界面语言”命令的参数都由它生成，加一种界面语言只改这里和宿主目录。
 *
 * 枚举而不是“字符串加运行期校验”：设置系统只按声明的 JSON schema 校验值，没有另外的校验入口（w00028 t03 计划审查）。
 */

import {Type} from "typebox";
import type {TUnsafe} from "typebox";

export interface HostLocale {
    readonly tag: string;
    /** 语言名用它自己的语言写，换到看不懂的语言后也找得回来。 */
    readonly name: string;
}

export const HOST_LOCALES: readonly HostLocale[] = [
    {tag: "zh-CN", name: "简体中文"},
    {tag: "en-US", name: "English"},
];

/** 只接受集合里语言的 schema；序列化后是 `anyOf` 常量。值的类型是字符串（`DisplayLocale`）。 */
export function hostLocaleSchema(locales: readonly HostLocale[] = HOST_LOCALES): TUnsafe<string> {
    return Type.Unsafe<string>(Type.Union(locales.map((locale) => Type.Literal(locale.tag))));
}
