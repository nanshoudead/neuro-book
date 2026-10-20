/** 字段在表单里的先后（深度优先、按属性顺序），问题汇总与“聚焦第一条问题”按它排；以及问题所在字段的名字。 */

import type {FieldNode} from "../model";
import {toPointer} from "../path";
import type {FieldPath} from "../path";
import {resolveText} from "../text";
import type {FormIssue} from "../validate";

export function fieldOrder(root: FieldNode): ReadonlyMap<string, number> {
    const order = new Map<string, number>();
    const visit = (node: FieldNode) => {
        order.set(toPointer(node.path), order.size);
        for (const child of node.children) visit(child);
    };
    visit(root);
    return order;
}

/** 路径或它最近的、在字段树里的上级（列表项与 `required` 里多出来的键不在树里）。 */
export function nearestField(order: ReadonlyMap<string, number>, path: FieldPath): FieldPath {
    for (let length = path.length; length > 0; length--) {
        const candidate = path.slice(0, length);
        if (order.has(toPointer(candidate))) return candidate;
    }
    return [];
}

export function sortIssues(issues: ReadonlyArray<FormIssue>, order: ReadonlyMap<string, number>): FormIssue[] {
    const position = (issue: FormIssue) => order.get(toPointer(nearestField(order, issue.path))) ?? Number.MAX_SAFE_INTEGER;
    return [...issues].sort((left, right) => position(left) - position(right));
}

/** 问题所在字段的名字：路径走出字段树时（列表项、`required` 里多出来的键）用最近的上级，没有上级时用键名。 */
export function fieldLabel(root: FieldNode, path: FieldPath, locale: string): string {
    let node = root;
    let label = "";
    for (const segment of path) {
        const child = node.children.find((entry) => entry.path[entry.path.length - 1] === segment);
        if (child === undefined) return label || String(segment);
        node = child;
        label = resolveText(child.label, locale);
    }
    return label;
}
