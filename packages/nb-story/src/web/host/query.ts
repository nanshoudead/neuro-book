/**
 * 页面取数的两个 composable。参数里带着阅读位置与视角，参数一变就重新取：上一次还在途的请求被中止，它的结果
 * 一律丢弃，不会显示到新位置的页面上（docs/specs/story/viewer.md“状态与转换”第 3 条）。
 */

import {onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef} from "vue";

import type {StoryMethod, StoryParams, StoryResult} from "../../contract/contract";
import {useBook} from "./book";
import {StoryCallError, useStoryClient} from "./client";

type Params<M extends StoryMethod> = Omit<StoryParams<M>, "book">;

export interface QueryState<M extends StoryMethod> {
    data: ShallowRef<StoryResult<M> | null>;
    error: Ref<StoryCallError | null>;
    loading: Ref<boolean>;
    reload(): void;
}

/**
 * 取一个方法的结果。`params` 返回 null 时不取（例如还没选中对象）。`book` 由当前书补上；`at` 默认补当前阅读位置，
 * 参数里写了 `at` 时用参数的。
 */
export function useStoryQuery<M extends StoryMethod>(method: M, params: () => NoInfer<Params<M>> | null): QueryState<M> {
    const client = useStoryClient();
    const book = useBook();
    const data = shallowRef(null) as ShallowRef<StoryResult<M> | null>;
    const error = ref<StoryCallError | null>(null);
    const loading = ref(false);
    let controller: AbortController | null = null;

    async function run(next: Params<M> | null): Promise<void> {
        controller?.abort();
        if (next === null) {
            data.value = null;
            loading.value = false;
            return;
        }
        const current = new AbortController();
        controller = current;
        loading.value = true;
        error.value = null;
        try {
            const result = await client.call(method, {at: book.at.value, ...next, book: book.bookId} as StoryParams<M>, {signal: current.signal});
            if (current.signal.aborted) return;
            data.value = result as StoryResult<M>;
        } catch (caught) {
            if (current.signal.aborted) return;
            if (!(caught instanceof StoryCallError)) {
                console.error({method, error: caught}, "查询出错");
                error.value = new StoryCallError("internal", "请求没有完成");
            } else {
                error.value = caught;
            }
            data.value = null;
        } finally {
            if (controller === current) loading.value = false;
        }
    }

    const stop = watch(() => ({params: params(), at: book.at.value}), value => void run(value.params), {immediate: true, deep: true});
    onScopeDispose(() => {
        stop();
        controller?.abort();
    });
    return {data, error, loading, reload: () => void run(params())};
}

export interface PagedState<T> {
    items: ShallowRef<T[]>;
    total: Ref<number | null>;
    error: Ref<StoryCallError | null>;
    loading: Ref<boolean>;
    hasMore: Ref<boolean>;
    /** 再取一页；已在取或没有更多时什么也不做。 */
    more(): void;
}

type PagedMethod = "entities.list" | "entity.knowledge" | "entity.statements" | "entity.episodes" | "questions.list" | "episodes.list" | "search";
type PageItem<M extends PagedMethod> = StoryResult<M>["items"][number];

/** 分页的列表：参数一变从第一页重来；滚到底由调用方调 more() 取下一页。 */
export function usePagedQuery<M extends PagedMethod>(method: M, params: () => NoInfer<Params<M>> | null, pageSize = 100): PagedState<PageItem<M>> {
    const client = useStoryClient();
    const book = useBook();
    const items = shallowRef<PageItem<M>[]>([]);
    const total = ref<number | null>(null);
    const error = ref<StoryCallError | null>(null);
    const loading = ref(false);
    const hasMore = ref(false);
    let cursor: string | null = null;
    let current: Params<M> | null = null;
    let controller: AbortController | null = null;

    async function fetchPage(reset: boolean): Promise<void> {
        if (current === null) return;
        const signalOwner = new AbortController();
        if (reset) controller?.abort();
        controller = signalOwner;
        loading.value = true;
        try {
            const result = await client.call(method, {at: book.at.value, ...current, book: book.bookId, limit: pageSize, ...(reset || cursor === null ? {} : {cursor})} as StoryParams<M>, {signal: signalOwner.signal});
            if (signalOwner.signal.aborted) return;
            const page = result as unknown as {items: PageItem<M>[]; total: number; next: string | null};
            items.value = reset ? page.items : [...items.value, ...page.items];
            total.value = page.total;
            cursor = page.next;
            hasMore.value = page.next !== null;
            error.value = null;
        } catch (caught) {
            if (signalOwner.signal.aborted) return;
            error.value = caught instanceof StoryCallError ? caught : new StoryCallError("internal", "请求没有完成");
            if (!(caught instanceof StoryCallError)) console.error({method, error: caught}, "查询出错");
        } finally {
            if (controller === signalOwner) loading.value = false;
        }
    }

    const stop = watch(
        () => ({params: params(), at: book.at.value}),
        value => {
            current = value.params;
            cursor = null;
            items.value = [];
            total.value = null;
            hasMore.value = false;
            if (current === null) {
                controller?.abort();
                return;
            }
            void fetchPage(true);
        },
        {immediate: true, deep: true},
    );
    onScopeDispose(() => {
        stop();
        controller?.abort();
    });
    return {
        items,
        total,
        error,
        loading,
        hasMore,
        more() {
            if (!loading.value && hasMore.value) void fetchPage(false);
        },
    };
}
