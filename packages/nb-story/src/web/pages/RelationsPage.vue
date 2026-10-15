<script setup lang="ts">
/**
 * 关系图（docs/specs/story/viewer.md 输出 22 到 28）：类别开关、连线的三层与同场门槛、视角、三种排版、“只看选中的周边”、
 * 图里搜名字。点一下一个点只选中它，旁边浮出小卡片，从卡片打开人物卡（人物，停在关系页签）或连线说明；右侧抽屉
 * 已经开着时，跟着选中的点换内容。
 */
import {FormCheckbox, FormInput, FormSelect, IconButton, Popover, SegmentedControl, Slider} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import type {EntityKind} from "../../core/dataset";
import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import NodePopover from "../graph/NodePopover.vue";
import StoryNetwork, {type GraphLayout} from "../graph/StoryNetwork.vue";

const book = useBook();
const KIND_GROUPS: ReadonlyArray<{id: string; label: string; kinds: EntityKind[]}> = [
    {id: "person", label: "人物", kinds: ["person", "persona"]},
    {id: "group", label: "组织", kinds: ["group"]},
    {id: "item", label: "物品", kinds: ["item"]},
    {id: "place", label: "地点", kinds: ["place"]},
    {id: "concept", label: "概念", kinds: ["concept", "other"]},
    {id: "task", label: "任务", kinds: ["task"]},
];
const LAYERS = [{id: "relation", label: "关系说法"}, {id: "co", label: "同场"}, {id: "know", label: "认知"}] as const;

const kindIds = ref<string[]>(["person", "group"]);
const layers = ref<string[]>(["relation", "co"]);
const minTogether = ref(2);
const layout = ref<GraphLayout>("force");
const relayoutKey = ref(0);
const neighborhood = ref(false);
const search = ref("");
const kinds = computed(() => KIND_GROUPS.filter(group => kindIds.value.includes(group.id)).flatMap(group => group.kinds));

const graph = useStoryQuery("graph.relations", () => ({kinds: kinds.value, perspective: book.perspective.value}));
const character = computed(() => book.perspective.value !== "reader");
const shownLayers = computed(() => (character.value ? layers.value.filter(layer => layer !== "know") : layers.value));
const perspectiveOptions = computed(() => [{value: "reader", label: "读者"}, ...(graph.data.value?.perspectives ?? []).map(item => ({value: item.id, label: item.label}))]);
const nodes = computed(() => (graph.data.value?.nodes ?? []).map(node => ({id: node.id, label: node.label, kind: node.kind, weight: node.mentions})));
const edges = computed(() => (graph.data.value?.edges ?? []).map(edge => ({a: edge.a, b: edge.b, word: edge.relation?.word ?? null, statements: edge.relation?.statements ?? 0, together: edge.together, ab: edge.knows?.ab ?? 0, ba: edge.knows?.ba ?? 0, identity: edge.identity})));
/** 主要人物：出场最多的几个人物，名字加粗、点一下打开人物卡。 */
const pinned = computed(() => (graph.data.value?.nodes ?? []).filter(node => node.kind === "person" || node.kind === "persona").slice(0, 8).map(node => node.id));
// 选中的点：打开页面时沿用抽屉里正开着的对象。
const selected = ref<string | null>(book.drawer.value?.kind === "card" ? book.drawer.value.entity : book.drawer.value?.kind === "node" ? book.drawer.value.id : null);
const selectedNode = computed(() => (selected.value === null ? null : (graph.data.value?.nodes.find(node => node.id === selected.value) ?? null)));
const KIND_LABEL: Record<string, string> = {person: "人物", persona: "身份", group: "组织", item: "物品", place: "地点", concept: "概念", task: "任务", other: "其他"};
const isPerson = (kind: string) => kind === "person" || kind === "persona";

/** 角色视角的说明（输出 28）：平时只是视角选择旁的一个小标记，点开看完整的不合并列表。 */
const perspectiveNote = computed(() => {
    const data = graph.data.value;
    if (!data || data.view.perspective === "reader") return null;
    const label = new Map(data.nodes.map(node => [node.id, node.label]));
    const who = perspectiveOptions.value.find(option => option.value === book.perspective.value)?.label ?? book.perspective.value;
    return {
        who,
        statements: data.view.statements,
        unmerged: data.view.unmerged.map(pair => `${label.get(pair.a) ?? pair.a}与${label.get(pair.b) ?? pair.b}`),
    };
});

function toggleIn(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
}
function open(id: string): void {
    const node = graph.data.value?.nodes.find(item => item.id === id);
    if (node && isPerson(node.kind)) book.openCard(id, "relations");
    else book.openNode(id, node?.label ?? id);
}
function onSelect(id: string): void {
    selected.value = id;
    // 抽屉开着时跟着换；关着时只选中，等用户在小卡片上点打开。
    if (book.drawer.value !== null) open(id);
}
</script>

<template>
    <div class="story-page flex flex-col" data-testid="page-relations">
        <div class="flex flex-wrap items-center gap-2 px-3 pt-2 select-none">
            <h1 class="story-page-title mb-0">关系图 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <button v-for="group in KIND_GROUPS" :key="group.id" type="button" class="story-chip" :class="kindIds.includes(group.id) ? 'is-on' : ''" :aria-pressed="kindIds.includes(group.id)" @click="kindIds = toggleIn(kindIds, group.id)">{{ group.label }}</button>
            <span class="mx-1 h-4 w-px bg-[var(--divider)]" />
            <template v-for="layer in LAYERS" :key="layer.id">
                <button v-if="layer.id !== 'know' || !character" type="button" class="story-chip" :class="layers.includes(layer.id) ? 'is-on' : ''" :aria-pressed="layers.includes(layer.id)" :data-layer="layer.id" @click="layers = toggleIn(layers, layer.id)">{{ layer.label }}</button>
            </template>
            <template v-if="layers.includes('co')">
                <span class="whitespace-nowrap text-[length:var(--text-xs)]">同场至少 {{ minTogether }} 次</span>
                <div class="w-20"><Slider v-model="minTogether" :min="1" :max="8" size="sm" aria-label="同场至少几次" /></div>
            </template>
        </div>
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 text-[length:var(--text-xs)] select-none">
            <span class="text-[var(--text-secondary)]">视角</span>
            <div class="w-36"><FormSelect :model-value="book.perspective.value" size="sm" :options="perspectiveOptions" data-testid="perspective" @update:model-value="(value: string) => (book.perspective.value = value)" /></div>
            <Popover v-if="perspectiveNote" side="bottom" align="start">
                <template #trigger>
                    <button type="button" class="story-chip is-on" data-testid="perspective-banner">{{ perspectiveNote.statements }} 条说法<template v-if="perspectiveNote.unmerged.length"> · {{ perspectiveNote.unmerged.length }} 处不合并</template></button>
                </template>
                <div class="max-w-[360px] text-[length:var(--text-xs)]" data-testid="perspective-detail">
                    <p>以{{ perspectiveNote.who }}的视角：用了 {{ perspectiveNote.statements }} 条他知道、读到、听说或认为的说法。</p>
                    <template v-if="perspectiveNote.unmerged.length">
                        <p class="mt-1">他不把这些看作同一人：</p>
                        <ul class="mt-0.5 list-disc pl-4"><li v-for="pair in perspectiveNote.unmerged" :key="pair">{{ pair }}</li></ul>
                    </template>
                </div>
            </Popover>
            <span class="text-[var(--text-secondary)]">排版</span>
            <SegmentedControl v-model="layout" size="xs" :options="[{value: 'force', label: '力导向'}, {value: 'concentric', label: '同心'}, {value: 'circle', label: '环形'}]" aria-label="排版方式" />
            <IconButton size="xs" icon-class="i-lucide-refresh-cw" aria-label="重新排版" title="重新排版" @click="relayoutKey += 1" />
            <FormCheckbox v-model="neighborhood" label="只看选中的周边" />
            <div class="ml-auto w-40"><FormInput v-model="search" size="sm" icon-class="i-lucide-search" placeholder="在图里找" /></div>
        </div>
        <PageState class="px-3" :loading="graph.loading.value && !graph.data.value" :error="graph.error.value?.message ?? null" @retry="graph.reload()" />
        <div class="relative min-h-0 flex-1" data-testid="relation-graph">
            <StoryNetwork
                v-if="graph.data.value" mode="relation" :nodes="nodes" :edges="edges" :layers="shownLayers" :min-co="minTogether" :layout="layout" :relayout-key="relayoutKey"
                :neighborhood="neighborhood" :query="search" :pinned="pinned" :selected="selected" @select="onSelect" @clear="selected = null"
            >
                <template v-if="selectedNode" #selected>
                    <NodePopover
                        :label="selectedNode.label" :kind="KIND_LABEL[selectedNode.kind] ?? selectedNode.kind" :detail="`出场 ${selectedNode.mentions} 次`"
                        :action="isPerson(selectedNode.kind) ? '打开人物卡' : '连线说明'" :neighborhood="neighborhood"
                        @open="open(selectedNode.id)" @neighborhood="(value: boolean) => (neighborhood = value)" @close="selected = null"
                    />
                </template>
            </StoryNetwork>
        </div>
    </div>
</template>
