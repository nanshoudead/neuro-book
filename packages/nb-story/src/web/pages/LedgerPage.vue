<script setup lang="ts">
/**
 * 数值（docs/specs/story/viewer.md 输出 12）：按资源切换，余额画成阶梯线，下面逐笔列出变化、余额与原因；原文报数与
 * 累加对不上的一笔标出差额，页顶写有几处对不上。任务按进行中、已完成筛，最近有变化的在前；道具列出得到与用掉。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import LedgerChart from "../parts/LedgerChart.vue";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";

const book = useBook();
const tracks = useStoryQuery("ledger.tracks", () => ({}));
const resources = computed(() => (tracks.data.value?.tracks ?? []).filter(track => track.kind === "resource"));
const tasks = computed(() => (tracks.data.value?.tracks ?? []).filter(track => track.kind === "task"));
const items = computed(() => (tracks.data.value?.tracks ?? []).filter(track => track.kind === "item"));
const chosen = ref<string>("");
const keyOf = (track: {owner: {id: string}; name: string}) => `${track.owner.id}|${track.name}`;
watch(resources, value => {
    if (!value.some(track => keyOf(track) === chosen.value)) chosen.value = value[0] ? keyOf(value[0]) : "";
}, {immediate: true});
const current = computed(() => resources.value.find(track => keyOf(track) === chosen.value) ?? null);
const detail = useStoryQuery("ledger.track", () => (current.value ? {track: current.value.name, owner: current.value.owner.id} : null));
const points = computed(() =>
    (detail.data.value?.entries ?? []).flatMap(entry => (entry.balance === null ? [] : [{chapter: Number(entry.refs[0]?.split(".")[0] ?? 1), balance: entry.balance, relative: entry.relative, gap: entry.gap}])),
);
const taskFilter = ref<"active" | "done">("active");
const shownTasks = computed(() => tasks.value.filter(track => (taskFilter.value === "active" ? String(track.current).startsWith("进行中") : !String(track.current).startsWith("进行中"))));
const itemTrack = ref<string>("");
watch(items, value => {
    if (!value.some(track => keyOf(track) === itemTrack.value)) itemTrack.value = value[0] ? keyOf(value[0]) : "";
}, {immediate: true});
const itemCurrent = computed(() => items.value.find(track => keyOf(track) === itemTrack.value) ?? null);
const itemDetail = useStoryQuery("ledger.track", () => (itemCurrent.value ? {track: itemCurrent.value.name, owner: itemCurrent.value.owner.id} : null));
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-ledger">
        <div class="story-page-body">
            <h1 class="story-page-title">数值 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <PageState :loading="tracks.loading.value && !tracks.data.value" :error="tracks.error.value?.message ?? null" @retry="tracks.reload()" />
            <section v-if="resources.length" class="story-block">
                <SegmentedControl v-model="chosen" size="sm" :options="resources.map(track => ({value: keyOf(track), label: `${track.owner.label} · ${track.name}`}))" aria-label="选一项资源" />
                <template v-if="current">
                    <p class="mt-2 text-[var(--text-sm)]">
                        当前 <b>{{ current.current ?? "—" }}</b><span v-if="current.relative">（起始金额不明，是相对值）</span>
                        <span v-if="current.mismatches" class="ml-2 text-[var(--status-warning)]" data-testid="mismatches">原文报数与累加有 {{ current.mismatches }} 处对不上</span>
                    </p>
                    <LedgerChart class="mt-2" :points="points" :chapters="book.at.value.chapter" />
                    <PageState :loading="detail.loading.value && !detail.data.value" :error="detail.error.value?.message ?? null" @retry="detail.reload()" />
                    <table v-if="detail.data.value" class="story-table mt-2 w-full" data-testid="ledger-entries">
                        <thead><tr><th>出处</th><th>变化</th><th>余额</th><th>原因</th></tr></thead>
                        <tbody>
                            <tr v-for="entry in detail.data.value.entries" :key="entry.id" :class="entry.gap ? 'has-gap' : ''">
                                <td><RefLink v-if="entry.refs[0]" :ref-text="entry.refs[0]" /></td>
                                <td class="whitespace-nowrap">{{ entry.change === null ? (entry.op === "set" ? "报数" : "") : entry.change > 0 ? `+${entry.change}` : entry.change }}</td>
                                <td class="whitespace-nowrap">
                                    {{ entry.balance ?? entry.value ?? "" }}<span v-if="entry.relative" class="text-[var(--text-muted)]">（相对）</span>
                                    <span v-if="entry.gap" class="block text-[var(--text-xs)] text-[var(--status-warning)]">原文比累加{{ entry.gap > 0 ? "多" : "少" }} {{ Math.abs(entry.gap) }}</span>
                                </td>
                                <td>{{ entry.reason }}</td>
                            </tr>
                        </tbody>
                    </table>
                </template>
            </section>
            <section class="story-block">
                <h2>任务</h2>
                <SegmentedControl v-model="taskFilter" size="xs" :options="[{value: 'active', label: '进行中'}, {value: 'done', label: '已完成'}]" aria-label="任务状态" />
                <ul class="mt-2 flex flex-col gap-1 text-[var(--text-sm)]">
                    <li v-for="task in shownTasks" :key="keyOf(task)" class="flex items-baseline gap-2">{{ task.name.replace(/^任务[：:]/u, "") }}<span class="text-[var(--text-xs)] text-[var(--text-muted)]">{{ task.current }}</span><RefLink class="ml-auto" :ref-text="task.lastRef" /></li>
                    <li v-if="shownTasks.length === 0" class="text-[var(--text-muted)]">没有</li>
                </ul>
            </section>
            <section v-if="items.length" class="story-block">
                <h2>道具</h2>
                <SegmentedControl v-if="items.length > 1" v-model="itemTrack" size="xs" :options="items.map(track => ({value: keyOf(track), label: `${track.owner.label} · ${track.name}`}))" aria-label="选一项道具" />
                <ul class="mt-1 flex flex-col gap-1 text-[var(--text-sm)]">
                    <li v-for="entry in itemDetail.data.value?.entries ?? []" :key="entry.id">{{ entry.op === "get" ? "得到" : entry.op === "use" ? "用掉" : "失去" }} {{ entry.item?.label ?? "" }}：{{ entry.reason }} <RefLink v-if="entry.refs[0]" :ref-text="entry.refs[0]" /></li>
                </ul>
            </section>
        </div>
    </div>
</template>

<style scoped>
.has-gap td {
    background: color-mix(in srgb, var(--status-warning) 8%, transparent);
}
</style>
