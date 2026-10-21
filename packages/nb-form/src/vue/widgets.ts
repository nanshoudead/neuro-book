/**
 * 自定义控件的登记与选择（docs/specs/ui/forms.md 输出 22）。
 *
 * 组件收到 `CustomWidgetProps`，发出 `update:modelValue`（草稿）与 `commit`，暴露 `focus()`。`update:modelValue` 只是
 * 草稿：`commit="change"` 时在 `commit` 事件或焦点离开字段时提交，`commit="input"` 时立即提交，与文字控件同一种时机。
 */

import type {Component} from "vue";

import type {TerminalWidget} from "../fallback";
import {isBuiltinWidget, selectWidget} from "../model";
import type {BuiltinWidget, FieldNode} from "../model";
import type {OptionSource} from "../options";
import type {FormIssue} from "../validate";

export interface FormWidget {
    readonly name: string;
    readonly component: Component;
    /** 没写 `widget` 的字段上的得分；null 或不大于 0 表示不适用。得分最高的胜出，压过内建控件。 */
    readonly score?: (node: FieldNode) => number | null;
    /** 终端里的退回画法；没写按字段的种类（输出 25）。 */
    readonly fallback?: TerminalWidget;
}

/** 自定义控件组件收到的属性。 */
export interface CustomWidgetProps {
    readonly modelValue: unknown;
    readonly node: FieldNode;
    readonly readonly: boolean;
    readonly disabled: boolean;
    readonly invalid: boolean;
    /** 写在可聚焦的元素上：外壳的 `<label for>` 指向它。 */
    readonly id: string;
    /** 外壳标题的 id：由几个元素组成的控件（例如一组按钮）用它写 `aria-labelledby`，`<label for>` 命名不了它们。 */
    readonly labelledby: string | undefined;
    readonly describedby: string | undefined;
    readonly locale: string;
    readonly issues: ReadonlyArray<FormIssue>;
    readonly options: OptionSource | undefined;
    readonly meta: {readonly secret?: "set" | "unset" | "unreadable"} | undefined;
}

export class FormWidgetError extends Error {
    constructor(readonly code: "builtin-name" | "duplicate-name", readonly widget: string) {
        super(code === "builtin-name" ? `自定义控件不能用内建控件的名字：${widget}` : `自定义控件重名：${widget}`);
        this.name = "FormWidgetError";
    }
}

/** 登记一组自定义控件；与内建名或彼此重名时抛 `FormWidgetError`（这是调用方代码的错误，不是描述的错误）。 */
export function defineFormWidgets(widgets: ReadonlyArray<FormWidget>): ReadonlyArray<FormWidget> {
    const names = new Set<string>();
    for (const widget of widgets) {
        if (isBuiltinWidget(widget.name)) throw new FormWidgetError("builtin-name", widget.name);
        if (names.has(widget.name)) throw new FormWidgetError("duplicate-name", widget.name);
        names.add(widget.name);
    }
    return widgets;
}

export type ResolvedWidget = {readonly builtin: BuiltinWidget} | {readonly custom: FormWidget};

/**
 * 字段实际用的控件。写了自定义控件名就用它；那个名字没登记时按没写选内建控件。没写时登记的控件参与打分。
 */
export function resolveWidget(node: FieldNode, widgets: ReadonlyArray<FormWidget>): ResolvedWidget {
    if (typeof node.widget !== "string") {
        const name = node.widget.custom;
        const registered = widgets.find((widget) => widget.name === name);
        if (registered !== undefined) return {custom: registered};
        const {widget: _ignored, ...hints} = node.hints;
        const fallback = selectWidget(node.kind, hints, node.schema, node.choices);
        return {builtin: typeof fallback === "string" ? fallback : "json"};
    }
    if (node.hints.widget === undefined) {
        let best: {widget: FormWidget; score: number} | undefined;
        for (const widget of widgets) {
            const score = widget.score?.(node) ?? null;
            if (score !== null && score > 0 && (best === undefined || score > best.score)) best = {widget, score};
        }
        if (best !== undefined) return {custom: best.widget};
    }
    return {builtin: node.widget};
}
