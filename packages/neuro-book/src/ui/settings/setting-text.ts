/**
 * 配置项在界面上的文字（docs/specs/settings/settings-window.md 输出 9–12、14）：选项名、值的一行摘要、生效时机的标注与
 * 写入失败的原因。`SettingsRow`、设置窗口与插件的设置页面共用，几处写出的同一个值、同一种失败才一致。
 */

import type {TextResolver} from "nbook/shared/localized-text";
import {literalUnionValues} from "nbook/shared/settings";
import type {SettingApplies, SettingLiteral, SettingsFailure, WrittenSettingDeclaration} from "nbook/shared/settings";

import {settingsUiText} from "./text";
import type {SettingsUiKey} from "./text";

const APPLIES: Readonly<Record<Exclude<SettingApplies, "now">, SettingsUiKey>> = {
    "next-run": "applies.next-run",
    "next-session": "applies.next-session",
    "restart": "applies.restart",
};

/** 写入失败的原因，给用户看（输出 14）：常见的几种换成说人话的句子，其余写失败码与详情。 */
export function settingsFailureText(code: SettingsFailure, detail: string, text: TextResolver): string {
    const failure = (key: SettingsUiKey): string => text.t(settingsUiText(key, {code, detail}));
    switch (code) {
        case "layer-invalid": return failure("writeFailure.layerInvalid");
        case "write-failed": return failure("writeFailure.writeFailed");
        case "unavailable": return failure("writeFailure.unavailable");
        case "invalid-value": return failure("writeFailure.invalidValue");
        case "unknown-outcome": return failure("writeFailure.unknownOutcome");
        case "conflict": return failure("writeFailure.conflict");
        default: return failure("writeFailure.other");
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
export function settingValueText(declaration: WrittenSettingDeclaration, value: unknown, text: TextResolver): string {
    const choice = settingChoices(declaration, text)?.find((candidate) => candidate.value === value);
    if (choice !== undefined) return choice.label;
    if (typeof value === "boolean") return text.t(settingsUiText(value ? "value.on" : "value.off"));
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value === "" ? text.t(settingsUiText("value.empty")) : abbreviate(value);
    if (Array.isArray(value)) return text.t(settingsUiText("value.items", {count: value.length}));
    return abbreviate(JSON.stringify(value) ?? "");
}

/** `applies` 不是 `now` 时标在标题后的文字。 */
export function settingAppliesText(applies: SettingApplies, text: TextResolver): string | null {
    return applies === "now" ? null : text.t(settingsUiText(APPLIES[applies]));
}

function abbreviate(text: string): string {
    return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT - 1)}…`;
}
