/**
 * 字段在调用方排版里占的位置（docs/specs/ui/forms.md 接口 `widgetLayout`）：设置窗口的一行据此决定控件是排在标签右边
 * 还是另起一块、占多宽。宽度只给档位，像素由调用方定。
 */

import type {FormHints} from "../hints";
import {resolveForm} from "../model";
import type {BuiltinWidget} from "../model";
import {withHints} from "./with-hints";

export interface WidgetLayout {
    /** 控件另起一块（多行、竖排单选、复选组、结构与 JSON），不排在标签右边。 */
    readonly block: boolean;
    readonly width: "narrow" | "medium" | "wide" | "content";
}

const LAYOUT: Readonly<Record<BuiltinWidget, WidgetLayout>> = {
    "switch": {block: false, width: "content"},
    "confirm": {block: false, width: "content"},
    "radio-row": {block: false, width: "content"},
    "radio": {block: true, width: "content"},
    "select": {block: false, width: "medium"},
    "search-select": {block: false, width: "medium"},
    "checkboxes": {block: true, width: "content"},
    "number": {block: false, width: "narrow"},
    "text": {block: false, width: "wide"},
    "secret": {block: false, width: "wide"},
    "multiline": {block: true, width: "wide"},
    "string-list": {block: true, width: "wide"},
    "object": {block: true, width: "wide"},
    "object-list": {block: true, width: "wide"},
    "master-detail": {block: true, width: "wide"},
    "json": {block: true, width: "wide"},
};

/** 自定义控件的排法由它自己的外观决定，这里按最宽处理。 */
const CUSTOM: WidgetLayout = {block: true, width: "wide"};

export function widgetLayout(schema: object, hints?: FormHints): WidgetLayout {
    const {widget} = resolveForm(withHints(schema, hints)).root;
    return typeof widget === "string" ? LAYOUT[widget] : CUSTOM;
}
