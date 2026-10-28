/**
 * 修订的写入（docs/specs/story/viewer.md 输出 62）：请求期间 `busy`，成功后换成书库里最新的数据（`book.refresh()`：
 * 阅读位置、页面、抽屉与滚动都不变，各页按数据版本重取），失败写出原因、数据不变。
 */

import {ref} from "vue";

import type {StoryParams, StoryResult} from "../../contract/contract";
import {useBook} from "./book";
import {StoryCallError, useStoryClient} from "./client";

export type ReviseMethod = "revisions.confirm" | "revisions.reject" | "revisions.link" | "revisions.kind" | "revisions.moveName" | "revisions.undo";
export type RevisionItem = StoryResult<"revisions.list">["items"][number];

export function useRevise() {
    const client = useStoryClient();
    const book = useBook();
    const busy = ref(false);
    const error = ref<string | null>(null);

    async function run<M extends ReviseMethod>(method: M, params: Omit<StoryParams<M>, "book">): Promise<StoryResult<M> | null> {
        if (busy.value) return null;
        busy.value = true;
        error.value = null;
        try {
            const result = (await client.call(method, {...params, book: book.bookId} as StoryParams<M>)) as StoryResult<M>;
            await book.refresh();
            return result;
        } catch (caught) {
            error.value = caught instanceof StoryCallError ? caught.message : "请求没有完成";
            if (!(caught instanceof StoryCallError)) console.error({method, error: caught}, "修订写入出错");
            return null;
        } finally {
            busy.value = false;
        }
    }
    return {busy, error, run};
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
