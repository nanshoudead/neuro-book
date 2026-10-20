/**
 * 终端里的退回画法（docs/specs/ui/forms.md 输出 25）。本包不画终端界面，只给出这份对照，让描述的设计守住“每种控件
 * 都能退回”的约束。
 */

import type {BuiltinWidget} from "./model";

export type TerminalWidget = "yes-no" | "pick-one" | "pick-many" | "line" | "editor" | "masked" | "lines" | "fields";

const FALLBACK: Readonly<Record<BuiltinWidget, TerminalWidget>> = {
    "switch": "yes-no",
    "confirm": "yes-no",
    "radio-row": "pick-one",
    "radio": "pick-one",
    "select": "pick-one",
    "search-select": "pick-one",
    "checkboxes": "pick-many",
    "number": "line",
    "text": "line",
    "multiline": "editor",
    "secret": "masked",
    "string-list": "lines",
    "object": "fields",
    "object-list": "lines",
    "master-detail": "lines",
    "json": "editor",
};

export function fallbackWidget(widget: BuiltinWidget): TerminalWidget {
    return FALLBACK[widget];
}
