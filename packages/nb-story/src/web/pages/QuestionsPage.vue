<script setup lang="ts">
/**
 * 悬念（docs/specs/story/viewer.md 输出 13、7）：默认只列没解开的、最近有进展的在前，可改成按提出顺序；按状态筛、按字或
 * 人物搜；展开一条看提出与每次进展。琐碎的悬念收在“琐碎”一组里，默认折叠。
 */
import {FormInput, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery, useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PagedList from "../parts/PagedList.vue";
import RefLink from "../parts/RefLink.vue";

const book = useBook();
const state = ref<"unsolved" | "open" | "partial" | "answered" | "all">("unsolved");
const sort = ref<"recent" | "raised">("recent");
const text = ref("");
const expanded = ref(new Set<string>());
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
const total = computed(() => (state.value === "unsolved" ? (openCount.data.value && partialCount.data.value ? openCount.data.value.total + partialCount.data.value.total : null) : list.total.value));
const rows = computed(() => list.items.value.filter(item => state.value !== "unsolved" || item.state !== "answered"));
const main = computed(() => rows.value.filter(item => !item.trivial));
const trivial = computed(() => rows.value.filter(item => item.trivial));
const STATE = {open: "未解", partial: "有进展", answered: "已解"} as const;
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
                <SegmentedControl v-model="state" size="xs" :options="[{value: 'unsolved', label: '没解开的'}, {value: 'open', label: '未解'}, {value: 'partial', label: '有进展'}, {value: 'answered', label: '已解'}, {value: 'all', label: '全部'}]" aria-label="按状态筛" />
                <SegmentedControl v-model="sort" size="xs" :options="[{value: 'recent', label: '最近有进展'}, {value: 'raised', label: '按提出顺序'}]" aria-label="排序" />
                <div class="w-44"><FormInput v-model="text" size="sm" icon-class="i-lucide-search" placeholder="按字或人物搜" /></div>
            </div>
            <PagedList class="mt-2" :items="main" :total="list.total.value" :loading="list.loading.value" :has-more="list.hasMore.value" :error="list.error.value?.message ?? null" empty-text="没有悬念" @more="list.more()" @retry="list.reload()">
                <template #item="{item}">
                    <article class="question" data-testid="question">
                        <button type="button" class="flex w-full items-baseline gap-2 text-left" @click="toggle(item.id)">
                            <span class="state" :data-state="item.state">{{ STATE[item.state] }}</span><span class="min-w-0 flex-1">{{ item.text }}</span>
                            <span class="text-[var(--text-2xs)] text-[var(--text-muted)]">第 {{ item.raised.chapter }} 章提出</span>
                        </button>
                        <div v-if="expanded.has(item.id)" class="mt-1 pl-12 text-[var(--text-sm)]">
                            <p v-if="item.about.length">关于：<NameLink v-for="who in item.about" :id="who.id" :key="who.id" :label="who.label" class="mr-1" /></p>
                            <p>提出 <RefLink v-for="ref in item.raised.refs" :key="ref" :ref-text="ref" class="mr-1" /></p>
                            <p v-for="(update, index) in item.updates.filter(entry => entry.type !== 'raised')" :key="index">
                                {{ update.type === "answered" ? "解答" : "进展" }}（第 {{ update.chapter }} 章）：{{ update.answer ?? update.note ?? "" }}
                                <RefLink v-for="ref in update.refs" :key="ref" :ref-text="ref" class="ml-1" />
                            </p>
                        </div>
                    </article>
                </template>
            </PagedList>
            <section v-if="trivial.length" class="story-block">
                <button type="button" class="text-[var(--text-sm)] text-[var(--accent-text)]" data-testid="toggle-trivial" @click="showTrivial = !showTrivial">{{ showTrivial ? "收起" : "展开" }}琐碎（{{ trivial.length }}）</button>
                <ul v-if="showTrivial" class="mt-1 flex flex-col gap-1 text-[var(--text-sm)] text-[var(--text-secondary)]">
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
.state {
    flex-shrink: 0;
    width: 3.5em;
    font-size: var(--text-2xs);
    color: var(--text-muted);
}
.state[data-state="partial"] {
    color: var(--accent-text);
}
.state[data-state="answered"] {
    color: var(--status-success);
}
</style>
