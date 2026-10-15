<script setup lang="ts">
/**
 * 全书图（docs/specs/story/viewer.md 输出 30、31）：默认按章节（故事线），可切到按关联（对象、主线或逐段情节、秘密、
 * 悬念四类点，悬念默认不显示）。
 */
import {FormCheckbox, FormInput, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import NodePopover from "../graph/NodePopover.vue";
import StoryLine from "../graph/StoryLine.vue";
import StoryNetwork from "../graph/StoryNetwork.vue";

const book = useBook();
const arrange = ref<"storyline" | "force">("storyline");
const grain = ref<"arc" | "episode">("arc");
const TYPES = [{id: "entity", label: "对象"}, {id: "arc", label: "主线"}, {id: "episode", label: "情节"}, {id: "secret", label: "秘密"}, {id: "question", label: "悬念"}] as const;
const hidden = ref<string[]>(["question"]);
const search = ref("");

const storyline = useStoryQuery("graph.storyline", () => (arrange.value === "storyline" ? {} : null));
const data = useStoryQuery("graph.book", () => (arrange.value === "force" ? {grain: grain.value, types: ["entity", "arc", "episode", "secret", "question"] as ("entity" | "arc" | "episode" | "secret" | "question")[]} : null));
const nodes = computed(() => (data.data.value?.nodes ?? []).map(node => ({id: node.id, label: node.label, kind: node.type === "entity" ? "person" : node.type, weight: node.weight})));
const dataEdges = computed(() => data.data.value?.edges ?? []);
const pinned = computed(() => (data.data.value?.nodes ?? []).filter(node => node.type === "entity").sort((a, b) => b.weight - a.weight).slice(0, 8).map(node => node.id));
function toggle(id: string): void {
    hidden.value = hidden.value.includes(id) ? hidden.value.filter(item => item !== id) : [...hidden.value, id];
}
const neighborhood = ref(false);
/**
 * 点一下只选中（输出 27、31），旁边的小卡片按类型给去处：对象打开人物卡，主线、情节、秘密、悬念跳到对应的页并
 * 定位。抽屉开着时，选中的对象跟着换人物卡。
 */
const selected = ref<string | null>(null);
const selectedNode = computed(() => (selected.value === null ? null : (data.data.value?.nodes.find(node => node.id === selected.value) ?? null)));
const TYPE_LABEL = {entity: "对象", arc: "主线", episode: "情节", secret: "秘密", question: "悬念"} as const;
const ACTION = {entity: "打开人物卡", arc: "看这条主线的情节", episode: "到情节页看这段", secret: "到秘密页看这一行", question: "到悬念页看这一条"} as const;
function onSelect(id: string): void {
    selected.value = id;
    if (book.drawer.value !== null && selectedNode.value?.type === "entity") book.openCard(id);
}
function openSelected(): void {
    const node = selectedNode.value;
    if (!node) return;
    if (node.type === "entity") book.openCard(node.id);
    else if (node.type === "arc") book.jump("episodes", {kind: "arc", id: node.id});
    else if (node.type === "episode") book.jump("episodes", {kind: "episode", id: node.id});
    else if (node.type === "secret") book.jump("secrets", {kind: "secret", id: node.id});
    else book.jump("questions", {kind: "question", id: node.id});
}
</script>

<template>
    <div class="story-page flex flex-col" data-testid="page-book-graph">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 select-none">
            <h1 class="story-page-title mb-0">全书图 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <SegmentedControl v-model="arrange" size="xs" :options="[{value: 'storyline', label: '按章节'}, {value: 'force', label: '按关联'}]" aria-label="排布" />
            <template v-if="arrange === 'force'">
                <SegmentedControl v-model="grain" size="xs" :options="[{value: 'arc', label: '按主线'}, {value: 'episode', label: '逐段情节'}]" aria-label="情节的粒度" />
                <button v-for="type in TYPES.filter(item => item.id !== (grain === 'arc' ? 'episode' : 'arc'))" :key="type.id" type="button" class="story-chip" :class="hidden.includes(type.id) ? '' : 'is-on'" :aria-pressed="!hidden.includes(type.id)" @click="toggle(type.id)">{{ type.label }}</button>
                <FormCheckbox v-model="neighborhood" label="只看选中的周边" />
                <div class="ml-auto w-40"><FormInput v-model="search" size="sm" icon-class="i-lucide-search" placeholder="在图里找" /></div>
            </template>
        </div>
        <PageState class="px-3" :loading="(storyline.loading.value && !storyline.data.value) || (data.loading.value && !data.data.value)" :error="storyline.error.value?.message ?? data.error.value?.message ?? null" @retry="arrange === 'storyline' ? storyline.reload() : data.reload()" />
        <div class="relative min-h-0 flex-1">
            <StoryLine v-if="arrange === 'storyline' && storyline.data.value" :storyline="storyline.data.value" :chapters="book.at.value.chapter" @select="(episode: string) => book.jump('episodes', {kind: 'episode', id: episode})" />
            <StoryNetwork
                v-else-if="arrange === 'force' && data.data.value" mode="data" :nodes="nodes" :data-edges="dataEdges" :hidden-types="hidden" :query="search" :pinned="pinned" :selected="selected"
                :neighborhood="neighborhood" @select="onSelect" @clear="selected = null"
            >
                <template v-if="selectedNode" #selected>
                    <NodePopover
                        :label="selectedNode.label" :kind="TYPE_LABEL[selectedNode.type]" :action="ACTION[selectedNode.type]" :neighborhood="neighborhood"
                        @open="openSelected" @neighborhood="(value: boolean) => (neighborhood = value)" @close="selected = null"
                    />
                </template>
            </StoryNetwork>
        </div>
        <p class="px-3 pb-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            <template v-if="arrange === 'storyline'">横轴是章，一行一个主要人物或事物，点是他参与的一段情节，竖线把同一段情节里的几个人连起来；悬停一个点显示章号与标题。</template>
            <template v-else>默认按主线聚合（线上写这个人在这条主线里出场的情节数），默认不显示悬念；点多时只显示出场多的名字，放大后逐级出现。</template>
        </p>
    </div>
</template>
