/**
 * 选项的值与控件里的键（docs/specs/ui/forms.md 输出 12）。nb-ui 的选择类控件只认字符串值；字面量可以是字符串、数或
 * 布尔，`1` 与 `"1"`、`true` 与 `"true"` 是不同的选项，所以控件里用带类型前缀的键，出来时换回字面量。
 */

import type {ChoiceValue} from "./model";
import type {FormText} from "./text";

export function optionKey(value: ChoiceValue): string {
    return `${typeof value === "string" ? "s" : typeof value === "number" ? "n" : "b"}:${String(value)}`;
}

/** 从键换回字面量；键不在 `values` 里时为 undefined。 */
export function optionValue(key: string, values: ReadonlyArray<ChoiceValue>): ChoiceValue | undefined {
    return values.find((value) => optionKey(value) === key);
}

export type OptionSource<T = ChoiceValue> =
    | {readonly status: "ready"; readonly items: ReadonlyArray<{readonly value: T; readonly label: FormText; readonly description?: FormText; readonly disabled?: boolean}>}
    | {readonly status: "loading"}
    | {readonly status: "unavailable"; readonly reason: FormText};
