/**
 * 条件显示（docs/specs/ui/forms.md 输出 13）：`visibleWhen.field` 指同一个对象里的兄弟字段（数组项里是同一项的
 * 兄弟），以 `/` 开头时指根上的字段；那个字段的值满足 `schema` 时显示。只做 schema 检查，不执行任何代码。
 *
 * 显示与否不改值，所以条件之间不会互相触发，也就没有循环的问题。
 */

import {Value} from "typebox/value";

import type {FieldNode} from "./model";
import {fromPointer, getAt} from "./path";

/** 字段在给定的根值下是否显示。条件的 schema 求值出错时按显示处理：宁可多显示，不让字段因描述写错而消失。 */
export function isVisible(node: FieldNode, root: unknown): boolean {
    const condition = node.hints.visibleWhen;
    if (condition === undefined) return true;
    const target = condition.field.startsWith("/")
        ? fromPointer(condition.field)
        : [...node.path.slice(0, -1), condition.field];
    try {
        return Value.Check(condition.schema, getAt(root, target));
    } catch {
        return true;
    }
}
