/**
 * 出处能不能点开：查看器只有已抽取的章（w00024 t30）。问答页读过没抽取的尾部章时，答案里指向那些章的出处没有地方可开，
 * 保持原文字串、不发 `reference.open`。问答页用 `provide(QA_LINKABLE, …)` 给出判断，渲染出处的组件各自 `inject`。
 */

import type {InjectionKey} from "vue";

import {findRefs} from "../../contract/refs";

/** 章号在查看器里能不能打开。 */
export type RefLinkable = (chapter: number) => boolean;

export const QA_LINKABLE: InjectionKey<RefLinkable> = Symbol("nb-story:qa-linkable");

/** 出处写法（`38.12`、`38.50—38.81`）起点的章号；认不出为 null。 */
export function refChapter(ref: string): number | null {
    const span = findRefs(ref)[0];
    const match = /^(\d+)/u.exec((span?.text ?? ref).trim());
    return match === null ? null : Number(match[1]);
}

export const ALWAYS_LINKABLE: RefLinkable = () => true;
