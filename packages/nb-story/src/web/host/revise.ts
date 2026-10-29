/**
 * 修订的写入（docs/specs/story/viewer.md 输出 62）：请求期间 `busy`（页面、人物卡、对话框共用一个：同一时刻只有一次写入），
 * 成功后换成书库里最新的数据（`book.refresh()`：阅读位置、页面、抽屉与滚动都不变，各页按数据版本重取），失败写出原因、
 * 数据不变；失败原因说明页面上的数据过期了（别处已经处理、目标没了）时也换一次最新的。
 */

import {ref} from "vue";

import type {StoryParams, StoryResult} from "../../contract/contract";
import {useBook} from "./book";
import {StoryCallError, useStoryClient} from "./client";

export type ReviseMethod = "revisions.confirm" | "revisions.reject" | "revisions.link" | "revisions.kind" | "revisions.moveName" | "revisions.undo";
export type RevisionItem = StoryResult<"revisions.list">["items"][number];

/** 同一时刻只有一次写入：卡片、人物卡的候选块、对话框共用。 */
const busy = ref(false);
/** 待确认页里点开人物卡的那张卡片：抽屉里同一条候选高亮（viewer 输出 58）。 */
export const focusedRevision = ref<string | null>(null);
/** 这些失败码说明页面上显示的数据已经过期。 */
const STALE_CODES = new Set(["revision_conflict", "revision_target_not_found", "revision_not_found", "revision_not_candidate"]);

export function useRevise() {
    const client = useStoryClient();
    const book = useBook();
    const error = ref<string | null>(null);

    async function run<M extends ReviseMethod>(method: M, params: Omit<StoryParams<M>, "book">): Promise<StoryResult<M> | null> {
        if (busy.value) return null;
        busy.value = true;
        error.value = null;
        try {
            const result = (await client.call(method, {...params, book: book.bookId} as StoryParams<M>)) as StoryResult<M>;
            // 写进去了，但没能换成最新的数据时页面还是旧的：说明原因，不让用户再点一次得到冲突。
            if (!(await book.refresh())) error.value = "已经写入，但没能换成最新的数据，请刷新页面";
            return result;
        } catch (caught) {
            error.value = caught instanceof StoryCallError ? caught.message : "请求没有完成";
            if (!(caught instanceof StoryCallError)) console.error({method, error: caught}, "修订写入出错");
            else if (STALE_CODES.has(caught.code)) await book.refresh();
            return null;
        } finally {
            busy.value = false;
        }
    }
    return {busy, error, run};
}

/** 待确认的候选（`st:<说法编号>`）才有说法编号可确认或驳回；别的项没有。 */
export function statementOf(item: RevisionItem): string | null {
    return item.id.startsWith("st:") ? item.id.slice(3) : null;
}

/** 一项修订要做的事，给卡片上的一行说明。 */
export const OP_WORDS: Record<RevisionItem["op"], string> = {
    "identity.candidate": "连成同一人",
    "identity.confirm": "确认了候选身份",
    "identity.reject": "驳回了候选身份",
    "identity.link": "手动连接",
    "kind.set": "改对象种类",
    "name.move": "挪称呼",
};
export const SOURCE_WORDS: Record<RevisionItem["source"], string> = {"persona-check": "马甲核对", extraction: "抽取候选", user: "我的", scan: "扫描"};
/** 记录里说法旁的标记（`entity.statements` 的 `mark`）。 */
export const MARK_WORDS = {candidate: "候选", confirmed: "你确认的", added: "你加的"} as const;

/** 处理时间：本地时间，到分钟。 */
export function decidedText(iso: string | null): string {
    if (iso === null) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false});
}
