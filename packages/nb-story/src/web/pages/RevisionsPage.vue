<script setup lang="ts">
/**
 * 待确认页（docs/specs/story/viewer.md 输出 58、62）：待确认的（先列对不上的）与已处理的，来源筛选；确认、驳回、撤销、丢弃。
 * 写入之后页面不动：`useRevise` 换成最新的数据，列表按数据版本重取。
 */
import {SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery} from "../host/query";
import {useRevise, type RevisionItem} from "../host/revise";
import PagedList from "../parts/PagedList.vue";
import RevisionCard from "../parts/RevisionCard.vue";

const book = useBook();
const tab = ref<"todo" | "done">("todo");
const source = ref<"all" | RevisionItem["source"]>("all");
const {busy, error, run} = useRevise();
const sourceParam = () => (source.value === "all" ? {} : {source: source.value});

const stale = usePagedQuery("revisions.list", () => (tab.value === "todo" ? {state: "stale" as const, ...sourceParam()} : null), 100);
const pending = usePagedQuery("revisions.list", () => (tab.value === "todo" ? {state: "pending" as const, ...sourceParam()} : null), 100);
const done = usePagedQuery("revisions.list", () => (tab.value === "done" ? sourceParam() : null), 100);

const counts = computed(() => (pending.extra.value ?? stale.extra.value ?? done.extra.value)?.counts ?? null);
const tabs = computed(() => [
    {value: "todo", label: "待确认", ...(counts.value ? {count: counts.value.pending + counts.value.stale} : {})},
    {value: "done", label: "已处理", ...(counts.value ? {count: counts.value.adopted + counts.value.rejected + counts.value.closed} : {})},
]);
const todo = computed(() => [...stale.items.value, ...pending.items.value]);
const processed = computed(() => done.items.value.filter(item => item.state !== "pending" && item.state !== "stale"));
const loading = computed(() => (tab.value === "todo" ? stale.loading.value || pending.loading.value : done.loading.value));
const failure = computed(() => (tab.value === "todo" ? (stale.error.value ?? pending.error.value) : done.error.value)?.message ?? null);
const total = computed(() => (tab.value === "todo" ? (counts.value ? counts.value.pending + counts.value.stale : null) : processed.value.length));
/** 刚做完的一件事（撤销的提示）。 */
const last = ref<{text: string; revision: string} | null>(null);

function statementOf(item: RevisionItem): string {
    return item.id.replace(/^st:/u, "");
}
async function confirm(item: RevisionItem): Promise<void> {
    const result = await run("revisions.confirm", {statement: statementOf(item)});
    if (result) last.value = {text: `已确认：${item.summary}`, revision: result.revision.id};
}
async function reject(item: RevisionItem): Promise<void> {
    const result = await run("revisions.reject", {statement: statementOf(item)});
    if (result) last.value = {text: `已驳回：${item.summary}`, revision: result.revision.id};
}
async function undo(item: RevisionItem): Promise<void> {
    if (await run("revisions.undo", {revision: item.id})) last.value = null;
}
async function undoLast(): Promise<void> {
    if (last.value && (await run("revisions.undo", {revision: last.value.revision}))) last.value = null;
}
function open(item: RevisionItem): void {
    const entity = item.entities[0];
    if (entity) book.openCard(entity);
}
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-revisions">
        <div class="story-page-body">
            <h1 class="story-page-title">待确认 <span class="sub">对图的修订：抽取留下的候选，和你自己的修改。截至{{ book.atLabel.value }}<template v-if="!book.atEnd.value">，拨到“全部读完”能看到全书的</template></span></h1>
            <div class="flex flex-wrap items-center gap-3">
                <Tabs v-model="tab" size="sm" :items="tabs" aria-label="待确认" />
                <SegmentedControl v-model="source" size="xs" :options="[{value: 'all', label: '全部'}, {value: 'persona-check', label: '马甲核对'}, {value: 'extraction', label: '抽取候选'}, {value: 'user', label: '我的'}]" aria-label="按来源筛" />
                <span class="ml-auto text-[length:var(--text-xs)] text-[var(--text-secondary)]">确认与驳回都可以撤销</span>
            </div>
            <p v-if="last" class="last" role="status" data-testid="revisions-last">{{ last.text }}<button type="button" class="ml-2 text-[var(--accent-text)]" data-testid="revisions-last-undo" @click="undoLast">撤销</button></p>
            <p v-if="error" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ error }}</p>
            <PagedList
                class="mt-2 flex flex-col gap-2" :items="tab === 'todo' ? todo : processed" :total="total" :loading="loading" :has-more="tab === 'todo' ? pending.hasMore.value : done.hasMore.value"
                :error="failure" :empty-text="tab === 'todo' ? '没有需要确认的' : '还没有处理过的'" @more="tab === 'todo' ? pending.more() : done.more()" @retry="tab === 'todo' ? (stale.reload(), pending.reload()) : done.reload()"
            >
                <template #item="{item}">
                    <RevisionCard :item="item" :busy="busy" :highlighted="book.drawer.value?.kind === 'card' && item.entities.includes(book.drawer.value.entity)" @confirm="confirm" @reject="reject" @undo="undo" @open="open" />
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
    border-radius: var(--radius-card, 10px);
    font-size: var(--text-xs);
}
</style>
