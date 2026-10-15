<script setup lang="ts">
/**
 * 悬念（docs/specs/story/viewer.md 输出 13、7）：默认只列没解开的、最近有进展的在前，可改成按提出顺序；按状态筛（各状态
 * 带条数）、按字或人物搜；每条带状态标签与“进展几次、最近一次”；展开看相关情节与从提出到每次进展的历程。琐碎的悬念
 * 收在“琐碎”一组里，默认折叠。从别的页点进来时（book.jump）展开并滚到那一条。
 */
import {Badge, FormInput, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery, useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PagedList from "../parts/PagedList.vue";
import RefLink from "../parts/RefLink.vue";

const book = useBook();
const state = ref<"unsolved" | "open" | "partial" | "answered" | "all">("unsolved");
const sort = ref<"recent" | "raised">("recent");
const text = ref("");
const jumpedIn = book.takeJump("question");
const expanded = ref(new Set<string>(jumpedIn === null ? [] : [jumpedIn]));
const showTrivial = ref(false);
// “没解开的”是未解加有进展，接口一次只筛一种状态：这一档在页面里合并两种。
const list = usePagedQuery("questions.list", () => ({
    ...(state.value === "open" || state.value === "partial" || state.value === "answered" ? {state: state.value} : {}),
    sort: sort.value,
    ...(text.value.trim() ? {query: text.value.trim()} : {}),
}), 200);
// 总条数：“没解开的”是未解与有进展两档相加，其余档取接口给的总数。
const openCount = useStoryQuery("questions.list", () => ({state: "open", limit: 1}) as const);
const partialCount = useStoryQuery("questions.list", () => ({state: "partial", limit: 1}) as const);
const answeredCount = useStoryQuery("questions.list", () => ({state: "answered", limit: 1}) as const);
const allCount = useStoryQuery("questions.list", () => ({limit: 1}));
const counted = (label: string, value: number | undefined) => (value === undefined ? label : `${label} ${value}`);
const stateOptions = computed(() => {
    const open = openCount.data.value?.total;
    const partial = partialCount.data.value?.total;
    return [
        {value: "unsolved", label: counted("没解开", open !== undefined && partial !== undefined ? open + partial : undefined)},
        {value: "open", label: counted("未解", open)},
        {value: "partial", label: counted("有进展", partial)},
        {value: "answered", label: counted("已解", answeredCount.data.value?.total)},
        {value: "all", label: counted("全部", allCount.data.value?.total)},
    ];
});
const total = computed(() => (state.value === "unsolved" ? (openCount.data.value && partialCount.data.value ? openCount.data.value.total + partialCount.data.value.total : null) : list.total.value));
const rows = computed(() => list.items.value.filter(item => state.value !== "unsolved" || item.state !== "answered"));
const main = computed(() => rows.value.filter(item => !item.trivial));
const trivial = computed(() => rows.value.filter(item => item.trivial));
const STATE = {open: "未解", partial: "有进展", answered: "已解"} as const;
const TONE = {open: "warning", partial: "accent", answered: "success"} as const;
const UPDATE = {raised: "提出", partial: "部分解答", answered: "解答"} as const;
type Item = (typeof list.items.value)[number];
const progress = (item: Item) => item.updates.filter(update => update.type !== "raised");
/** 右侧的一句：进展了几次、最近一次的出处；没有进展时写提出的出处。 */
function lastLine(item: Item): string {
    const updates = progress(item);
    const last = updates.at(-1);
    return last ? `${updates.length} 次进展 · 最近 ${last.refs[0] ?? `第 ${last.chapter} 章`}` : `提出于 ${item.raised.refs[0] ?? `第 ${item.raised.chapter} 章`}`;
}
// 跳进来的那一条取到后滚过去（不在已取的页里就接着取）。
const pending = ref(jumpedIn);
watch([() => list.items.value, () => list.loading.value], async () => {
    const id = pending.value;
    if (id === null || list.loading.value) return;
    if (!list.items.value.some(item => item.id === id)) {
        if (list.hasMore.value) list.more();
        else pending.value = null;
        return;
    }
    pending.value = null;
    await nextTick();
    document.querySelector(`[data-question="${CSS.escape(id)}"]`)?.scrollIntoView({block: "center"});
});
function toggle(id: string): void {
    const next = new Set(expanded.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
}
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-questions">
        <div class="story-page-body">
            <h1 class="story-page-title">悬念 <span class="sub">截至{{ book.atLabel.value }}<template v-if="total !== null">，共 {{ total }} 条</template></span></h1>
            <div class="flex flex-wrap items-center gap-2">
                <SegmentedControl v-model="state" size="xs" :options="stateOptions" aria-label="按状态筛" />
                <SegmentedControl v-model="sort" size="xs" :options="[{value: 'recent', label: '最近有进展'}, {value: 'raised', label: '按提出顺序'}]" aria-label="排序" />
                <div class="w-44"><FormInput v-model="text" size="sm" icon-class="i-lucide-search" placeholder="按字或人物搜" /></div>
            </div>
            <PagedList class="mt-2" :items="main" :total="list.total.value" :loading="list.loading.value" :has-more="list.hasMore.value" :error="list.error.value?.message ?? null" empty-text="没有悬念" @more="list.more()" @retry="list.reload()">
                <template #item="{item}">
                    <article class="question" data-testid="question" :data-question="item.id">
                        <button type="button" class="flex w-full items-baseline gap-2 text-left" :aria-expanded="expanded.has(item.id)" @click="toggle(item.id)">
                            <Badge size="sm" variant="soft" :tone="TONE[item.state]" class="shrink-0" :data-state="item.state">{{ STATE[item.state] }}</Badge>
                            <span class="min-w-0 flex-1" :class="expanded.has(item.id) ? 'font-[var(--weight-strong)]' : ''">{{ item.text }}</span>
                            <span class="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ lastLine(item) }}</span>
                        </button>
                        <div v-if="expanded.has(item.id)" class="detail">
                            <p v-if="item.about.length" class="text-[length:var(--text-xs)]">关于：<NameLink v-for="who in item.about" :id="who.id" :key="who.id" :label="who.label" class="mr-1.5" /></p>
                            <div v-if="item.episodes.length" class="flex flex-wrap gap-1" data-testid="question-episodes">
                                <button v-for="episode in item.episodes" :key="episode.id" type="button" class="story-chip" :title="`第 ${episode.chapter} 章：${episode.title}`" @click="book.jump('episodes', {kind: 'episode', id: episode.id})">
                                    {{ episode.title.length > 14 ? `${episode.title.slice(0, 14)}…` : episode.title }}
                                </button>
                            </div>
                            <ol class="history">
                                <li><span class="kind">提出</span><span class="min-w-0 flex-1">第 {{ item.raised.chapter }} 章</span><RefLink v-for="ref in item.raised.refs" :key="ref" :ref-text="ref" /></li>
                                <li v-for="(update, index) in progress(item)" :key="index">
                                    <span class="kind" :data-type="update.type">{{ UPDATE[update.type] }}</span>
                                    <span class="min-w-0 flex-1">{{ update.answer ?? update.note ?? `第 ${update.chapter} 章` }}</span>
                                    <RefLink v-for="ref in update.refs" :key="ref" :ref-text="ref" />
                                </li>
                            </ol>
                        </div>
                    </article>
                </template>
            </PagedList>
            <section v-if="trivial.length" class="story-block">
                <button type="button" class="text-[length:var(--text-sm)] text-[var(--accent-text)]" data-testid="toggle-trivial" @click="showTrivial = !showTrivial">{{ showTrivial ? "收起" : "展开" }}琐碎（{{ trivial.length }}）</button>
                <ul v-if="showTrivial" class="mt-1 flex flex-col gap-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                    <li v-for="item in trivial" :key="item.id">{{ item.text }} <RefLink v-if="item.raised.refs[0]" :ref-text="item.raised.refs[0]" /></li>
                </ul>
            </section>
        </div>
    </div>
</template>

<style scoped>
.question {
    padding: 6px 4px;
    border-bottom: var(--border-w, 1px) solid var(--divider);
    font-size: var(--text-sm);
}
.detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 6px 0 2px 3.2em;
}
.history {
    border-left: 2px solid var(--divider);
    padding-left: 10px;
}
.history li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-size: var(--text-xs);
}
.history .kind {
    flex-shrink: 0;
    width: 4.5em;
    color: var(--text-muted);
}
.history .kind[data-type="answered"] {
    color: var(--status-success);
}
.history .kind[data-type="partial"] {
    color: var(--accent-text);
}
</style>
