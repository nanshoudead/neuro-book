/**
 * 出处能不能点开：查看器只有已抽取的章（w00024 t30）。问答页读过没抽取的尾部章时，答案里指向那些章的出处没有地方可开，
 * 保持原文字串、不发 `reference.open`。问答页用 `provide(QA_LINKABLE, …)` 给出判断，渲染出处的组件各自 `inject`。
 */

import type {InjectionKey} from "vue";

import {parseRef} from "../../contract/refs";

/** 章号在查看器里能不能打开。 */
export type RefLinkable = (chapter: number) => boolean;

export const QA_LINKABLE: InjectionKey<RefLinkable> = Symbol("nb-story:qa-linkable");

/** 出处写法（`38.12`、`38.50—38.81`）涉及的最后一章：范围的终点在没抽取的章里也打不开，所以看较后的那个；认不出为 null。 */
export function refChapter(ref: string): number | null {
    const parsed = parseRef(ref);
    return parsed === null ? null : Math.max(parsed.from.chapter, parsed.to.chapter);
}

export const ALWAYS_LINKABLE: RefLinkable = () => true;
