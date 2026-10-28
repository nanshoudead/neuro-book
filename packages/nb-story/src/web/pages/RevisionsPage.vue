<script setup lang="ts">
/**
 * 待确认页（docs/specs/story/viewer.md 输出 58、62）：待确认的（先列对不上的）与已处理的，来源筛选，可按对象筛；确认、驳回、
 * 撤销、丢弃。写入之后页面不动：`useRevise` 换成最新的数据，列表按数据版本重取。
 */
import {SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery} from "../host/query";
import {focusedRevision, statementOf, useRevise, type RevisionItem} from "../host/revise";
import PagedList from "../parts/PagedList.vue";
import RevisionCard from "../parts/RevisionCard.vue";

const book = useBook();
const tab = ref<"todo" | "done">("todo");
const source = ref<"all" | RevisionItem["source"]>("all");
/** 人物卡“这个对象的修订”跳过来时只看这个对象的（可清除）。 */
const entity = ref<string | null>(book.takeJump("entity"));
const {busy, error, run} = useRevise();
const filters = () => ({...(source.value === "all" ? {} : {source: source.value}), ...(entity.value === null ? {} : {entity: entity.value})});

const stale = usePagedQuery("revisions.list", () => (tab.value === "todo" ? {state: "stale" as const, ...filters()} : null), 100);
const pending = usePagedQuery("revisions.list", () => (tab.value === "todo" ? {state: "pending" as const, ...filters()} : null), 100);
const done = usePagedQuery("revisions.list", () => (tab.value === "done" ? {state: "processed" as const, ...filters()} : null), 100);

const counts = computed(() => (pending.extra.value ?? stale.extra.value ?? done.extra.value)?.counts ?? null);
const tabs = computed(() => [
    {value: "todo", label: "待确认", ...(counts.value ? {count: counts.value.pending + counts.value.stale} : {})},
    {value: "done", label: "已处理", ...(counts.value ? {count: counts.value.adopted + counts.value.rejected + counts.value.closed} : {})},
]);
const items = computed(() => (tab.value === "todo" ? [...stale.items.value, ...pending.items.value] : done.items.value));
const loading = computed(() => (tab.value === "todo" ? stale.loading.value || pending.loading.value : done.loading.value));
const failure = computed(() => (tab.value === "todo" ? (stale.error.value ?? pending.error.value) : done.error.value)?.message ?? null);
/** 当前筛选下的总数（空态按它判断，不按全书的计数）。 */
const total = computed(() => (tab.value === "todo" ? (stale.total.value !== null && pending.total.value !== null ? stale.total.value + pending.total.value : null) : done.total.value));
/** 只看的对象的名字：取列表里第一项涉及它的那一处。 */
const entityLabel = computed(() => items.value.flatMap(item => item.entities).find(item => item.id === entity.value)?.label ?? "这个对象");
/** 刚做完的一件事（撤销的提示）。 */
const last = ref<{text: string; revision: string} | null>(null);

async function decide(item: RevisionItem, method: "revisions.confirm" | "revisions.reject"): Promise<void> {
    const statement = statementOf(item);
    if (statement === null) return;
    const result = await run(method, {statement});
    if (result) last.value = {text: `${method === "revisions.confirm" ? "已确认" : "已驳回"}：${item.summary}`, revision: result.revision.id};
}
async function undo(item: RevisionItem): Promise<void> {
    if (await run("revisions.undo", {revision: item.id})) last.value = null;
}
async function undoLast(): Promise<void> {
    if (last.value && (await run("revisions.undo", {revision: last.value.revision}))) last.value = null;
}
function open(item: RevisionItem): void {
    const first = item.entities[0];
    if (!first) return;
    focusedRevision.value = item.id;
    book.openCard(first.id);
}
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-revisions">
        <div class="story-page-body">
            <h1 class="story-page-title">待确认 <span class="sub">对图的修订：抽取留下的候选，和你自己的修改。截至{{ book.atLabel.value }}<template v-if="!book.atEnd.value">，拨到“全部读完”能看到全书的</template></span></h1>
            <div class="flex flex-wrap items-center gap-3">
                <Tabs v-model="tab" size="sm" :items="tabs" aria-label="待确认" />
                <SegmentedControl v-model="source" size="xs" :options="[{value: 'all', label: '全部'}, {value: 'persona-check', label: '马甲核对'}, {value: 'extraction', label: '抽取候选'}, {value: 'user', label: '我的'}]" aria-label="按来源筛" />
                <button v-if="entity !== null" type="button" class="story-chip is-on" data-testid="revisions-entity-filter" @click="entity = null">只看“{{ entityLabel }}”的 ×</button>
                <span class="ml-auto text-[length:var(--text-xs)] text-[var(--text-secondary)]">确认与驳回都可以撤销</span>
            </div>
            <p v-if="last" class="last" data-testid="revisions-last"><span role="status">{{ last.text }}</span><button type="button" class="ml-2 text-[var(--accent-text)]" data-testid="revisions-last-undo" @click="undoLast">撤销</button></p>
            <p v-if="error" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ error }}</p>
            <PagedList
                class="mt-2 flex flex-col gap-2" :items="items" :total="total" :loading="loading" :has-more="tab === 'todo' ? pending.hasMore.value : done.hasMore.value"
                :error="failure" :empty-text="tab === 'todo' ? '没有需要确认的' : '还没有处理过的'" @more="tab === 'todo' ? pending.more() : done.more()" @retry="tab === 'todo' ? (stale.reload(), pending.reload()) : done.reload()"
            >
                <template #item="{item}">
                    <RevisionCard :item="item" :busy="busy" :highlighted="book.drawer.value?.kind === 'card' && item.entities.some(entity => entity.id === (book.drawer.value as {entity: string}).entity)" @confirm="decide($event, 'revisions.confirm')" @reject="decide($event, 'revisions.reject')" @undo="undo" @open="open" />
                </template>
            </PagedList>
        </div>
    </div>
</template>

<style scoped>
.last {
    margin-top: 8px;
    padding: 6px 10px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-panel);
    font-size: var(--text-xs);
}
</style>
