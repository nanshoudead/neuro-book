<script setup lang="ts">
/**
 * 人物卡的“关系”页签（docs/specs/story/viewer.md 输出 10、29）：上面是这个人和关系最多的几个人的小图；下面按类别
 * （人物、组织、物品、地点、其他）列出和他有联系的每个对象，每行用一句话说明联系从哪来——关系词、身份连接、最能
 * 说明关系的一句说法，没有说法时写最近一起出场的情节；点一行展开两人之间的全部说法、情节与互相知道的事。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useBook} from "../host/book";
import {ALL_KINDS} from "../host/kinds";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";
import MiniGraph from "../graph/MiniGraph.vue";
import RelationDetail from "./RelationDetail.vue";

const props = defineProps<{entity: string}>();
const book = useBook();
const graph = useStoryQuery("graph.relations", () => ({kinds: ALL_KINDS, perspective: book.perspective.value, includeAnonymous: true}));
const relations = useStoryQuery("entity.relations", () => ({entity: props.entity}));

const GROUPS = [
    {id: "person", label: "人物", kinds: ["person", "persona"]},
    {id: "group", label: "组织", kinds: ["group"]},
    {id: "item", label: "物品", kinds: ["item"]},
    {id: "place", label: "地点", kinds: ["place"]},
    {id: "other", label: "其他", kinds: ["concept", "task", "other"]},
] as const;
const IDENTITY = {uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）", suspects: "其实是同一人（怀疑）", "no-record": "其实是同一人（没有记录）"} as const;

const group = ref<(typeof GROUPS)[number]["id"]>("person");
const items = computed(() => relations.data.value?.items ?? []);
const groupOptions = computed(() => GROUPS.map(item => ({value: item.id, label: `${item.label} ${items.value.filter(row => (item.kinds as readonly string[]).includes(row.other.kind)).length}`})));
const rows = computed(() => {
    const kinds = GROUPS.find(item => item.id === group.value)!.kinds as readonly string[];
    return items.value.filter(row => kinds.includes(row.other.kind));
});
// 第一次取到时停在有内容的第一类（例如物品卡没有人物关系时直接看物品）。
watch(items, list => {
    if (rows.value.length > 0 || list.length === 0) return;
    const first = GROUPS.find(item => list.some(row => (item.kinds as readonly string[]).includes(row.other.kind)));
    if (first) group.value = first.id;
}, {immediate: true});

const open = ref<string | null>(null);
function toggle(id: string): void {
    open.value = open.value === id ? null : id;
}
function countsText(row: (typeof items.value)[number]): string {
    const parts = [row.counts.statements ? `说法 ${row.counts.statements}` : "", row.counts.episodes ? `同场 ${row.counts.episodes}` : ""];
    if (row.counts.knows && (row.counts.knows.ab || row.counts.knows.ba)) parts.push(`互相知道 ${row.counts.knows.ab}/${row.counts.knows.ba}`);
    return parts.filter(Boolean).join(" · ");
}
</script>

<template>
    <div class="flex flex-col gap-2" data-testid="card-relations">
        <PageState :loading="(graph.loading.value && !graph.data.value) || (relations.loading.value && !relations.data.value)" :error="relations.error.value?.message ?? graph.error.value?.message ?? null" @retry="relations.reload()" />
        <MiniGraph v-if="graph.data.value && items.length" :center="entity" :nodes="graph.data.value.nodes" :edges="graph.data.value.edges" @select="id => book.openCard(id, 'relations')" />
        <SegmentedControl v-if="items.length" v-model="group" size="xs" :options="groupOptions" aria-label="按类别看" />
        <p v-if="relations.data.value && rows.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">这一类里没有和他有联系的对象</p>
        <ul class="flex flex-col">
            <li v-for="row in rows" :key="row.other.id" class="relation" data-testid="relation-row">
                <div class="head">
                    <button type="button" class="chevron" :aria-expanded="open === row.other.id" :aria-label="`展开与${row.other.label}的关系`" @click="toggle(row.other.id)">
                        <span :class="open === row.other.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
                    </button>
                    <NameLink :id="row.other.id" :label="row.other.label" tab="relations" strong />
                    <span v-if="row.word" class="word">{{ row.word }}</span>
                    <span v-if="row.identity" class="identity" data-testid="identity">{{ IDENTITY[row.identity] }}</span>
                    <span class="counts">{{ countsText(row) }}</span>
                </div>
                <button type="button" class="summary" @click="toggle(row.other.id)">
                    <template v-if="row.summary">{{ row.summary.text }}</template>
                    <template v-else-if="row.lastEpisode">一起出场：{{ row.lastEpisode.title }}（第 {{ row.lastEpisode.chapter }} 章）</template>
                    <template v-else-if="row.identity">只有一条身份连接，没有别的说法</template>
                    <template v-else>只有互相知道的记录</template>
                </button>
                <RefLink v-if="row.summary" class="summary-ref" :ref-text="row.summary.ref" />
                <RelationDetail v-if="open === row.other.id" :entity="entity" :other="row.other.id" />
            </li>
        </ul>
    </div>
</template>

<style scoped>
.relation {
    padding: 6px 0;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}
.head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-sm);
}
.chevron {
    align-self: center;
    color: var(--text-secondary);
}
.word {
    padding: 0 6px;
    border-radius: var(--radius-control);
    background: var(--accent-bg);
    color: var(--accent-text);
    font-size: var(--text-xs);
}
.identity {
    font-size: var(--text-xs);
    color: var(--status-warning);
}
.counts {
    margin-left: auto;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-secondary);
}
.summary {
    display: -webkit-box;
    margin: 2px 0 0 22px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: var(--text-xs);
    line-height: 1.6;
    color: var(--text-secondary);
    text-align: left;
}
.summary-ref {
    margin-left: 22px;
    font-size: var(--text-2xs);
}
</style>
