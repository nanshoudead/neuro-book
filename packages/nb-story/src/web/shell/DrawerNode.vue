<script setup lang="ts">
/**
 * 抽屉里的“连线说明”：图上点了主要人物以外的对象时，列出它与别的点之间的几种联系（viewer 输出 27）。
 */
import {computed} from "vue";

import {useBook} from "../host/book";
import {ALL_KINDS} from "../host/kinds";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
import PageState from "../parts/PageState.vue";

const props = defineProps<{id: string; label: string}>();
const book = useBook();
const graph = useStoryQuery("graph.relations", () => ({kinds: ALL_KINDS, perspective: book.perspective.value}));
const IDENTITY = {uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）", suspects: "其实是同一人（怀疑）", "no-record": "可能知道（没有记录）"} as const;

const rows = computed(() => {
    const data = graph.data.value;
    if (!data) return [];
    const label = new Map(data.nodes.map(node => [node.id, node.label]));
    return data.edges.filter(edge => edge.a === props.id || edge.b === props.id).map(edge => {
        const other = edge.a === props.id ? edge.b : edge.a;
        return {other, label: label.get(other) ?? other, edge};
    });
});
</script>

<template>
    <div class="flex flex-col gap-2 p-3" data-testid="drawer-node">
        <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]"><NameLink :id="id" :label="label" /> 的连线</h2>
        <PageState :loading="graph.loading.value && !graph.data.value" :error="graph.error.value?.message ?? null" @retry="graph.reload()" />
        <p v-if="graph.data.value && rows.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">在当前视角与阅读位置下没有连线</p>
        <ul class="flex flex-col gap-1.5">
            <li v-for="row in rows" :key="row.other" class="text-[length:var(--text-sm)]">
                <NameLink :id="row.other" :label="row.label" />：
                <span v-if="row.edge.identity" class="text-[var(--status-warning)]">{{ IDENTITY[row.edge.identity] }}</span>
                <template v-if="row.edge.relation">关系{{ row.edge.relation.word ? `“${row.edge.relation.word}”` : "" }}（说法 {{ row.edge.relation.statements }}）</template>
                <template v-if="row.edge.together"> 同场 {{ row.edge.together }} 次</template>
                <template v-if="row.edge.knows && (row.edge.knows.ab || row.edge.knows.ba)"> 认知 {{ row.edge.knows.ab }}/{{ row.edge.knows.ba }}</template>
            </li>
        </ul>
    </div>
</template>
