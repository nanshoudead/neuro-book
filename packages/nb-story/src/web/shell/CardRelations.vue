<script setup lang="ts">
/**
 * 人物卡的“关系”页签：这个人和关系最多的几个人的小图，下面按关系多少排的列表（viewer 输出 10、29）。
 */
import {computed} from "vue";

import {useBook} from "../host/book";
import {ALL_KINDS} from "../host/kinds";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PageState from "../parts/PageState.vue";
import MiniGraph from "../graph/MiniGraph.vue";

const props = defineProps<{entity: string}>();
const book = useBook();
const graph = useStoryQuery("graph.relations", () => ({kinds: ALL_KINDS, perspective: book.perspective.value}));

const rows = computed(() => {
    const data = graph.data.value;
    if (!data) return [];
    const label = new Map(data.nodes.map(node => [node.id, node.label]));
    return data.edges
        .filter(edge => edge.a === props.entity || edge.b === props.entity)
        .map(edge => {
            const other = edge.a === props.entity ? edge.b : edge.a;
            return {other, label: label.get(other) ?? other, edge, weight: (edge.relation?.statements ?? 0) * 3 + edge.together + (edge.knows ? edge.knows.ab + edge.knows.ba : 0)};
        })
        .sort((a, b) => b.weight - a.weight || (a.other < b.other ? -1 : 1));
});
</script>

<template>
    <div class="flex flex-col gap-2" data-testid="card-relations">
        <PageState :loading="graph.loading.value && !graph.data.value" :error="graph.error.value?.message ?? null" @retry="graph.reload()" />
        <MiniGraph v-if="graph.data.value && rows.length" :center="entity" :nodes="graph.data.value.nodes" :edges="graph.data.value.edges" @select="id => book.openCard(id, 'relations')" />
        <ul class="flex flex-col gap-1">
            <li v-for="row in rows" :key="row.other" class="flex items-baseline gap-2 text-[var(--text-sm)]">
                <NameLink :id="row.other" :label="row.label" tab="relations" />
                <span v-if="row.edge.relation?.word" class="text-[var(--accent-text)]">{{ row.edge.relation.word }}</span>
                <span class="ml-auto whitespace-nowrap text-[var(--text-xs)] text-[var(--text-muted)]">
                    <template v-if="row.edge.relation">说法 {{ row.edge.relation.statements }}</template>
                    <template v-if="row.edge.together"> · 同场 {{ row.edge.together }}</template>
                    <template v-if="row.edge.knows && (row.edge.knows.ab || row.edge.knows.ba)"> · 认知 {{ row.edge.knows.ab }}/{{ row.edge.knows.ba }}</template>
                </span>
            </li>
        </ul>
    </div>
</template>
