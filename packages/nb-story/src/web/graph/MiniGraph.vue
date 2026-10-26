<script setup lang="ts">
/**
 * 人物卡里的小图（docs/specs/story/viewer.md 输出 29）：这个人和关系最多的 12 个，绕着他排一圈。
 */
import {computed} from "vue";

import type {RelationEdge, RelationNode} from "../../contract/contract";
import StoryNetwork from "./StoryNetwork.vue";

const props = defineProps<{center: string; nodes: readonly RelationNode[]; edges: readonly RelationEdge[]}>();
const emit = defineEmits<{select: [id: string]}>();

const networkNodes = computed(() => props.nodes.map(node => ({id: node.id, label: node.label, kind: node.kind, weight: node.mentions})));
const networkEdges = computed(() => props.edges.map(edge => ({a: edge.a, b: edge.b, word: edge.relation?.word ?? null, statements: edge.relation?.statements ?? 0, together: edge.together, ab: edge.knows?.ab ?? 0, ba: edge.knows?.ba ?? 0, identity: edge.identity})));
</script>

<template>
    <div class="h-[280px] overflow-hidden rounded-[var(--radius-control)] border border-[var(--divider)]" data-testid="mini-graph">
        <StoryNetwork mode="relation" compact :ego="center" :nodes="networkNodes" :edges="networkEdges" :layers="['relation', 'co']" :min-co="1" :selected="center" @select="id => emit('select', id)" />
    </div>
</template>
