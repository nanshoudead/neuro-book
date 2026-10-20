/**
 * 配置项在界面上的文字（docs/specs/settings/settings-window.md 输出 9–12）：选项名、值的一行摘要与生效时机的标注。
 * `SettingsRow` 与设置窗口的通用控件共用，两处写出的同一个值才一致。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import {literalUnionValues} from "nbook/shared/settings";
import type {SettingApplies, SettingDeclaration, SettingLiteral} from "nbook/shared/settings";

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

/** 摘要的长度上限：一行放得下，超出的部分以省略号结尾。 */
const SUMMARY_LIMIT = 80;

/** 字面量联合的选项：值与名字。名字取 `choices` 的 `title`，没写 `choices` 时是字面量本身；不是字面量联合为 null。 */
export function settingChoices(declaration: SettingDeclaration, locale: DisplayLocale): ReadonlyArray<{readonly value: SettingLiteral; readonly label: string}> | null {
    const literals = literalUnionValues(declaration.schema);
    if (literals === null) return null;
    // 动态选项（`{from}`）不在这里：它的 schema 是字符串，上面已经返回 null。
    const named = Array.isArray(declaration.choices) ? declaration.choices : [];
    return literals.map((value) => {
        const choice = named.find((candidate) => candidate.value === value);
        return {value, label: choice === undefined ? String(value) : localize(choice.title, locale)};
    });
}

/** 值的一行摘要：沿用提示、覆盖提示与只读显示用。 */
export function settingValueText(declaration: SettingDeclaration, value: unknown, locale: DisplayLocale): string {
    const choice = settingChoices(declaration, locale)?.find((candidate) => candidate.value === value);
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
