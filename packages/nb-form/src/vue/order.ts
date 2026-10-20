/**
 * 问题在表单里的先后与问题所在字段的名字（docs/specs/ui/forms.md 输出 14）：问题汇总与“聚焦第一条问题”都用。
 *
 * 先后按看得见的顺序：根上的字段按布局排（布局可以重排属性），往下按成员的属性顺序与列表项的下标。只按 schema 的
 * 属性顺序排时，布局倒排的表单汇总与焦点会跳着走（审查 S3 omp 12）。
 */

import type {FieldNode, FormLayout, FormModel} from "../model";
import {itemNode} from "../model";
import {getAt, toPointer} from "../path";
import type {FieldPath} from "../path";
import {resolveText} from "../text";
import type {FormIssue} from "../validate";
import {messagesFor} from "./messages";

function layoutOrder(layout: FormLayout, into: string[]): string[] {
    if (layout.type === "field") into.push(layout.path);
    else for (const item of layout.items) layoutOrder(item, into);
    return into;
}

/** 一个路径的排序键：逐层的位置；走出字段树的部分排在它所在的字段后面。 */
function orderKey(model: FormModel, path: FieldPath, rootOrder: ReadonlyMap<string, number>): number[] {
    if (path.length === 0) return [-1];
    const key: number[] = [];
    let node: FieldNode | undefined = model.root;
    path.forEach((segment, depth) => {
        if (node === undefined) {
            key.push(Number.MAX_SAFE_INTEGER);
            return;
        }
        if (typeof segment === "number") {
            key.push(segment);
            node = node.item === undefined ? undefined : itemNode(node, segment);
            return;
        }
        const index: number = node.children.findIndex((child) => child.path[child.path.length - 1] === segment);
        key.push(depth === 0 ? rootOrder.get(toPointer([segment])) ?? index : index);
        node = index === -1 ? undefined : node.children[index];
    });
    return key;
}

export function sortIssues(issues: ReadonlyArray<FormIssue>, model: FormModel): FormIssue[] {
    const pointers = layoutOrder(model.layout, []);
    const rootOrder = new Map(pointers.map((pointer, index) => [pointer, index]));
    const keyed = issues.map((issue, position) => ({issue, position, key: orderKey(model, issue.path, rootOrder)}));
    keyed.sort((left, right) => {
        const length = Math.max(left.key.length, right.key.length);
        for (let index = 0; index < length; index += 1) {
            const difference = (left.key[index] ?? -1) - (right.key[index] ?? -1);
            if (difference !== 0) return difference;
        }
        return left.position - right.position;
    });
    return keyed.map((entry) => entry.issue);
}

/** 列表项的标题：`itemLabel` 指向的字段有文字时用它，否则“第 N 项”（输出 20）。列表控件与问题汇总共用。 */
export function itemTitle(list: FieldNode, item: unknown, index: number, locale: string): string {
    const key = list.hints.itemLabel;
    const named = key !== undefined && item !== null && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined;
    return typeof named === "string" && named.trim() !== "" ? named : messagesFor(locale).item(index + 1);
}

/**
 * 问题所在字段的名字，逐层连起来：“人物 · 林照 · 名字”。走出字段树时（`required` 里多出来的键）用键名；根上的问题
 * 没有名字。
 */
export function fieldLabel(root: FieldNode, value: unknown, path: FieldPath, locale: string): string {
    const parts: string[] = [];
    let node: FieldNode | undefined = root;
    path.forEach((segment, depth) => {
        if (node === undefined) return;
        if (typeof segment === "number") {
            parts.push(itemTitle(node, getAt(value, path.slice(0, depth + 1)), segment, locale));
            node = node.item === undefined ? undefined : itemNode(node, segment);
            return;
        }
        const child: FieldNode | undefined = node.children.find((entry) => entry.path[entry.path.length - 1] === segment);
        parts.push(child === undefined ? segment : resolveText(child.label, locale));
        node = child;
    });
    return parts.filter((part) => part !== "").join(" · ");
}
