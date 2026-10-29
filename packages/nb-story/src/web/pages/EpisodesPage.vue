<script setup lang="ts">
/**
 * 情节（docs/specs/story/viewer.md 输出 15）：主线在左（宽屏）或在上横排（平板）；点一条主线只看它的情节；情节按章
 * 分组，标题旁写故事时间与地点，参与者写出以什么身份出场；展开看概要、步骤、结果、与前情的连接与说明（点连接跳到
 * 那一段情节）；还没归入主线的情节写明。从别的页点进来时（book.jump）先按主线筛或定位到那一段。
 */
import {computed, nextTick, ref, watch} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery, useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PagedList from "../parts/PagedList.vue";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";
import TierBadge from "../parts/TierBadge.vue";

const book = useBook();
const arcs = useStoryQuery("arcs.list", () => ({}));
const arc = ref<string | null>(book.takeJump("arc"));
const list = usePagedQuery("episodes.list", () => (arc.value ? {arc: arc.value} : {}), 200);
const expanded = ref(new Set<string>());
const LINK = {after: "在其后", continues: "接着", retells: "重述", causes: "起因", motivates: "动机", enables: "前提"} as const;
/** 主线在左（宽屏）或在上横排（平板、手机），按外壳的宽度档定，不随抽屉开合翻转（输出 15）。 */
const side = computed(() => book.tier.value === "wide");
const arcTitle = computed(() => new Map((arcs.data.value?.arcs ?? []).map(item => [item.id, item.title])));
function toggle(id: string): void {
    const next = new Set(expanded.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
}
/** 要跳到的情节：清掉主线筛选后列表从第一页重取，等它出现在已取到的条目里（不在就接着取下一页）再滚过去。 */
const pendingJump = ref<string | null>(null);
const jumpedIn = book.takeJump("episode");
if (jumpedIn !== null) jump(jumpedIn);
function jump(id: string): void {
    expanded.value = new Set([...expanded.value, id]);
    pendingJump.value = id;
    arc.value = null;
}
watch([() => list.items.value, pendingJump, () => list.loading.value], async () => {
    const id = pendingJump.value;
    if (id === null || list.loading.value) return;
    if (!list.items.value.some(item => item.id === id)) {
        if (list.hasMore.value) list.more();
        else pendingJump.value = null;
        return;
    }
    pendingJump.value = null;
    await nextTick();
    document.querySelector(`[data-episode="${CSS.escape(id)}"]`)?.scrollIntoView({block: "center"});
});
</script>

<template>
    <div class="story-page flex flex-col" data-testid="page-episodes">
        <div class="flex min-h-0 flex-1" :class="side ? 'flex-row' : 'flex-col'">
            <aside class="arcs shrink-0 border-[var(--divider)] p-2" :class="side ? 'w-[240px] overflow-y-auto border-r' : 'flex gap-1 overflow-x-auto border-b'" aria-label="主线">
                <h2 v-if="side" class="mb-1 text-[length:var(--text-sm)] font-[var(--weight-strong)]">主线 <span class="text-[length:var(--text-2xs)] font-normal text-[var(--text-muted)]">归纳到第 {{ arcs.data.value?.through ?? "—" }} 章</span></h2>
                <button type="button" class="arc" :class="arc === null ? 'is-active' : ''" :aria-pressed="arc === null" @click="arc = null">全部情节</button>
                <button v-for="item in arcs.data.value?.arcs ?? []" :key="item.id" type="button" class="arc" :class="arc === item.id ? 'is-active' : ''" :aria-pressed="arc === item.id" :title="item.summary" @click="arc = item.id">
                    {{ item.title }} <span class="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ item.episodes.length }}</span>
                </button>
                <PageState :loading="arcs.loading.value && !arcs.data.value" :error="arcs.error.value?.message ?? null" @retry="arcs.reload()" />
            </aside>
            <div class="story-scroll-y min-w-0 flex-1">
                <div class="story-page-body">
                    <h1 class="story-page-title">情节 <span class="sub">{{ arc ? arcTitle.get(arc) : "全部" }}，共 {{ list.total.value ?? "…" }} 段，截至{{ book.atLabel.value }}</span></h1>
                    <PagedList :items="list.items.value" :total="list.total.value" :loading="list.loading.value" :has-more="list.hasMore.value" :error="list.error.value?.message ?? null" empty-text="没有情节" @more="list.more()" @retry="list.reload()">
                        <template #item="{item, index}">
                            <h3 v-if="index === 0 || list.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h3>
                            <article class="episode" :data-episode="item.id">
                                <button type="button" class="flex w-full flex-wrap items-baseline gap-x-2 text-left" :aria-expanded="expanded.has(item.id)" @click="toggle(item.id)">
                                    <b class="min-w-0 flex-1"><TierBadge :tier="item.tier" />{{ item.title }}</b>
                                    <span v-if="item.time || item.place" class="text-[length:var(--text-2xs)] text-[var(--text-secondary)]" data-testid="episode-when">
                                        <template v-if="item.time"><span class="i-lucide-clock align-[-1px]" /> {{ item.time.label }}</template>
                                        <template v-if="item.place"><span class="i-lucide-map-pin ml-1 align-[-1px]" /> {{ item.place.label }}</template>
                                    </span>
                                    <span v-if="item.arcs.length === 0" class="text-[length:var(--text-2xs)] text-[var(--text-muted)]" data-testid="unassigned">未归入主线</span>
                                </button>
                                <div v-if="expanded.has(item.id)" class="mt-1 flex flex-col gap-1 text-[length:var(--text-sm)]">
                                    <p class="flex flex-wrap gap-x-2">
                                        <span v-for="who in item.who" :key="who.id"><NameLink :id="who.id" :label="who.label" /><span v-if="who.as" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">（以{{ who.as }}）</span></span>
                                    </p>
                                    <p>{{ item.summary }} <RefLink v-for="ref in item.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></p>
                                    <ol class="list-decimal pl-5">
                                        <li v-for="(step, stepIndex) in item.steps" :key="stepIndex">{{ step.text }} <RefLink :ref-text="step.ref" /></li>
                                    </ol>
                                    <p v-if="item.outcome">结果：{{ item.outcome }}</p>
                                    <div v-if="item.links.length">与前情：
                                        <ul class="pl-4">
                                            <li v-for="link in item.links" :key="link.to.id + link.type">
                                                <button type="button" class="text-[var(--accent-text)]" @click="jump(link.to.id)">{{ LINK[link.type] }} · {{ link.to.title }}</button>
                                                <span v-if="link.note" class="ml-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ link.note }}</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <p v-if="item.arcs.length" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">主线：{{ item.arcs.map(id => arcTitle.get(id) ?? id).join("、") }}</p>
                                </div>
                            </article>
                        </template>
                    </PagedList>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.arc {
    display: block;
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    text-align: left;
    white-space: nowrap;
}
aside.border-r .arc {
    width: 100%;
    white-space: normal;
}
.arc:hover {
    background: var(--bg-hover);
}
.arc.is-active {
    color: var(--accent-text);
    background: var(--accent-bg);
}
.chapter-head {
    margin-top: 10px;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.episode {
    padding: 5px 4px;
    border-bottom: var(--border-w, 1px) solid var(--divider);
    font-size: var(--text-sm);
}
</style>
