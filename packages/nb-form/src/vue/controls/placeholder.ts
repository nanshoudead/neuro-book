/** 缺值的文字与数字字段的占位文字（docs/specs/ui/forms.md 输出 4）：有 `default` 时写“默认：X”。 */

import type {FieldNode} from "../../model";
import {messagesFor} from "../messages";

export function defaultPlaceholder(node: FieldNode, locale: string): string | undefined {
    const value = node.schema.default;
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    if (value === "") return undefined;
    return messagesFor(locale).defaultValue(String(value));
}
