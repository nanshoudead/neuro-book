/**
 * 选择类字段的选项（docs/specs/ui/forms.md 输出 11、12）：固定的字面量，或调用方的动态选项源。nb-ui 的选择控件只认
 * 字符串值，这里统一用 `optionKey` 编码，出来时换回字面量。
 *
 * 当前值不在选项里时多出一项显示它：动态选项标“已不存在”（警告，值保留）；固定选项之外的值本来就是
 * `not-in-choices` 错误，同样显示出来，控件不至于显示成空白。这一项不能选。
 */

import type {ChoiceValue, FieldNode} from "../model";
import {optionKey} from "../options";
import type {OptionSource} from "../options";
import {resolveText} from "../text";
import {messagesFor} from "./messages";

export interface ChoiceItem {
    readonly key: string;
    readonly value: ChoiceValue;
    readonly label: string;
    readonly description?: string;
    readonly disabled: boolean;
    /** 当前值不在选项里时补出来的一项。 */
    readonly stale: boolean;
}

export type ChoiceState =
    | {readonly status: "ready"; readonly items: ReadonlyArray<ChoiceItem>}
    | {readonly status: "loading"; readonly items: ReadonlyArray<ChoiceItem>}
    | {readonly status: "unavailable"; readonly reason: string; readonly items: ReadonlyArray<ChoiceItem>};

function isChoiceValue(value: unknown): value is ChoiceValue {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** 选择类字段在当前值下的选项；`source` 是 `options` 指向的源，字段没有动态选项时不用。 */
export function choiceState(node: FieldNode, value: unknown, source: OptionSource | undefined, locale: string): ChoiceState {
    const messages = messagesFor(locale);
    const recommended = new Set((node.hints.recommend ?? []).map(optionKey));
    /** “推荐”写在说明里：选中后控件显示的名字不带它（`recommend` 只作标记，不预选）。 */
    const described = (choice: ChoiceValue, description: string | undefined): {description?: string} => {
        const parts = [recommended.has(optionKey(choice)) ? messages.recommended : undefined, description].filter((part) => part !== undefined && part !== "");
        return parts.length === 0 ? {} : {description: parts.join(" · ")};
    };
    const dynamic = node.hints.options !== undefined;
    let status: ChoiceState["status"] = "ready";
    let reason = "";
    let items: ChoiceItem[];
    if (!dynamic) {
        items = node.choices.map((choice) => ({
            key: optionKey(choice.value),
            value: choice.value,
            label: resolveText(choice.label, locale),
            ...described(choice.value, choice.description === undefined ? undefined : resolveText(choice.description, locale)),
            disabled: choice.disabled === true,
            stale: false,
        }));
    } else if (source === undefined || source.status === "unavailable") {
        status = "unavailable";
        reason = source === undefined ? messages.noSource : resolveText(source.reason, locale);
        items = [];
    } else if (source.status === "loading") {
        status = "loading";
        items = [];
    } else {
        items = source.items.map((item) => ({
            key: optionKey(item.value),
            value: item.value,
            label: resolveText(item.label, locale),
            ...described(item.value, item.description === undefined ? undefined : resolveText(item.description, locale)),
            disabled: item.disabled === true,
            stale: false,
        }));
    }
    const selected = node.kind === "multi" ? (Array.isArray(value) ? value : []) : value === undefined || value === null ? [] : [value];
    const known = new Set(items.map((item) => item.key));
    for (const entry of selected) {
        if (!isChoiceValue(entry) || known.has(optionKey(entry))) continue;
        known.add(optionKey(entry));
        // 加载中与不可用时选项还没有，当前值照常显示，不标“已不存在”。
        const label = dynamic && status === "ready" ? `${String(entry)}（${messages.stale}）` : String(entry);
        items.push({key: optionKey(entry), value: entry, label, disabled: true, stale: status === "ready"});
    }
    return status === "unavailable" ? {status, reason, items} : {status, items};
}

/** 一个值在选项里的名字；不在时用值本身。 */
export function choiceLabel(state: ChoiceState, value: unknown): string {
    if (!isChoiceValue(value)) return "";
    return state.items.find((item) => item.key === optionKey(value))?.label ?? String(value);
}
