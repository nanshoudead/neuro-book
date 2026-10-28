/**
 * 对象在某个阅读位置的显示名。抽取的“已有记录”、马甲核对与修订（`overlay/`）都要写出同一个名字，所以放在 core 里，
 * 抽取一侧从 `ingest/context.ts` 再导出。
 */

import type {Entity, Position} from "./dataset";
import {comparePosition, visibleAt} from "./position";

/** 取此时最新的主要称呼；还没有称呼时用整理标签并加括号标明。 */
export function displayName(entity: Entity, readAt: Position): string {
    const names = entity.names.filter(name => visibleAt(name.at, readAt)).sort((a, b) => comparePosition(a.at, b.at));
    const primary = names.filter(name => name.primary).at(-1);
    return primary?.text ?? names[0]?.text ?? `〔${entity.label}〕`;
}
