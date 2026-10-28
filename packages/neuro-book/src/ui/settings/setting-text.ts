/**
 * 配置项在界面上的文字（docs/specs/settings/settings-window.md 输出 9–12、14）：选项名、值的一行摘要、生效时机的标注与
 * 写入失败的原因。`SettingsRow`、设置窗口与插件的设置页面共用，几处写出的同一个值、同一种失败才一致。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText, TextResolver} from "nbook/shared/localized-text";
import {literalUnionValues} from "nbook/shared/settings";
import type {SettingApplies, SettingLiteral, SettingsFailure, WrittenSettingDeclaration} from "nbook/shared/settings";

const TEXT = {
    on: {"zh-CN": "开", "en-US": "On"},
    off: {"zh-CN": "关", "en-US": "Off"},
    empty: {"zh-CN": "（空）", "en-US": "(empty)"},
    items: {"zh-CN": "{count} 项", "en-US": "{count} items"},
} satisfies Record<string, LocalizedText>;

const APPLIES: Readonly<Record<Exclude<SettingApplies, "now">, LocalizedText>> = {
    "next-run": {"zh-CN": "下次运行生效", "en-US": "Applies on next run"},
    "next-session": {"zh-CN": "下次会话生效", "en-US": "Applies to the next session"},
    "restart": {"zh-CN": "重启后生效", "en-US": "Applies after restart"},
};

const FAILURES = {
    layerInvalid: {"zh-CN": "设置文件有错误，修好之后才能保存", "en-US": "the settings file has errors; fix it first"},
    writeFailed: {"zh-CN": "写不进设置文件（{detail}）", "en-US": "could not write the settings file ({detail})"},
    unavailable: {"zh-CN": "暂时连不上，没有保存", "en-US": "temporarily unreachable; nothing was saved"},
    invalidValue: {"zh-CN": "这个值不能用（{detail}）", "en-US": "this value cannot be used ({detail})"},
    unknownOutcome: {"zh-CN": "可能没有保存，以设置文件为准", "en-US": "it may not have been saved; the settings file is authoritative"},
    conflict: {"zh-CN": "设置文件在别处改过了", "en-US": "the settings file was changed elsewhere"},
    other: {"zh-CN": "{code}：{detail}", "en-US": "{code}: {detail}"},
} satisfies Record<string, LocalizedText>;

/** 写入失败的原因，给用户看（输出 14）：常见的几种换成说人话的句子，其余写失败码与详情。 */
export function settingsFailureText(code: SettingsFailure, detail: string, locale: DisplayLocale): string {
    const text = (template: LocalizedText): string => localize(formatText(template, {code, detail}), locale);
    switch (code) {
        case "layer-invalid": return text(FAILURES.layerInvalid);
        case "write-failed": return text(FAILURES.writeFailed);
        case "unavailable": return text(FAILURES.unavailable);
        case "invalid-value": return text(FAILURES.invalidValue);
        case "unknown-outcome": return text(FAILURES.unknownOutcome);
        case "conflict": return text(FAILURES.conflict);
        default: return text(FAILURES.other);
    }
}

/** 摘要的长度上限：一行放得下，超出的部分以省略号结尾。 */
const SUMMARY_LIMIT = 80;

/**
 * 字面量联合的选项：值与名字。名字取 `choices` 的 `title`（经 `text` 翻成当前语言），没写 `choices` 时是字面量本身；不是
 * 字面量联合为 null。
 */
export function settingChoices(declaration: WrittenSettingDeclaration, text: TextResolver): ReadonlyArray<{readonly value: SettingLiteral; readonly label: string}> | null {
    const literals = literalUnionValues(declaration.schema);
    if (literals === null) return null;
    // 动态选项（`{from}`）不在这里：它的 schema 是字符串，上面已经返回 null。
    const named = Array.isArray(declaration.choices) ? declaration.choices : [];
    return literals.map((value) => {
        const choice = named.find((candidate) => candidate.value === value);
        return {value, label: choice?.title === undefined ? String(value) : text.t(choice.title)};
    });
}

/** 值的一行摘要：沿用提示、覆盖提示与只读显示用。 */
export function settingValueText(declaration: WrittenSettingDeclaration, value: unknown, locale: DisplayLocale, text: TextResolver): string {
    const choice = settingChoices(declaration, text)?.find((candidate) => candidate.value === value);
    if (choice !== undefined) return choice.label;
    if (typeof value === "boolean") return localize(value ? TEXT.on : TEXT.off, locale);
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value === "" ? localize(TEXT.empty, locale) : abbreviate(value);
    if (Array.isArray(value)) return localize(formatText(TEXT.items, {count: value.length}), locale);
    return abbreviate(JSON.stringify(value) ?? "");
}

/** `applies` 不是 `now` 时标在标题后的文字。 */
export function settingAppliesText(applies: SettingApplies, locale: DisplayLocale): string | null {
    return applies === "now" ? null : localize(APPLIES[applies], locale);
}

function abbreviate(text: string): string {
    return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT - 1)}…`;
}
