<script setup lang="ts">
/**
 * 抽屉里的人物卡（viewer 输出 10）：名字、称呼、同一身份；概况、关系、记录、情节四个页签，带条数。
 * 页签停在哪由会话决定（从关系图点进来停在关系），切页签写回会话，所以地址与保存都跟着变。
 */
import {FormInput, IconButton, SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook, type Tab} from "../host/book";
import {usePagedQuery, useStoryQuery} from "../host/query";
import PagedList from "../parts/PagedList.vue";
import PageState from "../parts/PageState.vue";
import RecordTags from "../parts/RecordTags.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";
import CardRelations from "./CardRelations.vue";

const props = defineProps<{entity: string; tab: Tab}>();
const book = useBook();
/** 称呼默认只列前几个。 */
const NAMES_SHOWN = 8;
const FACETS: Record<string, string> = {overview: "概况", appearance: "外貌", personality: "性格", relations: "关系", history: "过去", abilities: "能力", goals: "目标"};
const STATES = [{value: "", label: "全部"}, {value: "knows", label: "知道"}, {value: "believes", label: "认为"}, {value: "suspects", label: "怀疑"}, {value: "heard", label: "听说"}, {value: "unaware", label: "不知道"}];

const card = useStoryQuery("entity.card", () => ({entity: props.entity}));
const allNames = ref(false);
const recordKind = ref<"knowledge" | "statements">("knowledge");
const stateFilter = ref("");
const recordQuery = ref("");

const tabs = computed(() => {
    const counts = card.data.value?.counts;
    return [
        {value: "summary", label: "概况"},
        {value: "relations", label: "关系", count: counts?.relations},
        {value: "records", label: "记录", count: counts ? counts.knowledge + counts.statements : undefined},
        {value: "episodes", label: "情节", count: counts?.episodes},
    ];
});

const knowledge = usePagedQuery("entity.knowledge", () =>
    props.tab === "records" && recordKind.value === "knowledge"
        ? {entity: props.entity, ...(stateFilter.value ? {state: stateFilter.value as "knows"} : {}), ...(recordQuery.value.trim() ? {query: recordQuery.value.trim()} : {})}
        : null,
);
const statements = usePagedQuery("entity.statements", () => (props.tab === "records" && recordKind.value === "statements" ? {entity: props.entity, ...(recordQuery.value.trim() ? {query: recordQuery.value.trim()} : {})} : null));
const episodes = usePagedQuery("entity.episodes", () => (props.tab === "episodes" ? {entity: props.entity} : null));

function setTab(value: string): void {
    book.openCard(props.entity, value as Tab);
}
const STATE_WORD = {knows: "知道", believes: "认为", suspects: "怀疑", heard: "听说", read: "读到", unaware: "不知道"} as const;
</script>

<template>
    <div class="flex h-full flex-col" data-testid="entity-card">
        <PageState class="px-3" :loading="card.loading.value && !card.data.value" :error="card.error.value?.code === 'entity_not_found' ? '这个对象在当前阅读位置还没出现' : (card.error.value?.message ?? null)" @retry="card.reload()" />
        <template v-if="card.data.value">
            <header class="flex flex-col gap-1 border-b border-[var(--divider)] px-3 pb-2 pt-3">
                <div class="flex items-center gap-2">
                    <h2 class="text-[var(--text-lg)] font-[var(--weight-strong)]" data-testid="card-name">{{ card.data.value.label }}</h2>
                    <IconButton class="ml-auto" size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="book.closeDrawer()" />
                </div>
                <p class="text-[var(--text-sm)] text-[var(--text-secondary)]" data-testid="card-names">
                    称呼：<template v-for="(name, index) in (allNames ? card.data.value.names : card.data.value.names.slice(0, NAMES_SHOWN))" :key="name.text">{{ index ? "、" : "" }}{{ name.text }}</template>
                    <button v-if="card.data.value.names.length > NAMES_SHOWN" type="button" class="ml-1 text-[var(--accent-text)]" @click="allNames = !allNames">{{ allNames ? "收起" : `等 ${card.data.value.names.length} 个` }}</button>
                </p>
                <p v-if="card.data.value.identities.length" class="text-[var(--text-sm)]" data-testid="card-identities">
                    同一身份：<span v-for="item in card.data.value.identities" :key="item.id" class="mr-2">{{ item.label }} <RefLink :ref-text="item.ref" /></span>
                </p>
            </header>
            <Tabs class="px-3" size="sm" :model-value="tab" :items="tabs" aria-label="人物卡" @update:model-value="setTab" />
            <div class="story-scroll-y min-h-0 flex-1 px-3 py-2">
                <template v-if="tab === 'summary'">
                    <section v-for="facet in card.data.value.facets" :key="facet.facet" class="mb-3">
                        <h3 class="text-[var(--text-sm)] font-[var(--weight-strong)]">{{ FACETS[facet.facet] ?? facet.facet }} <span class="text-[var(--text-2xs)] text-[var(--text-muted)]">归纳到第 {{ facet.through }} 章</span></h3>
                        <p v-for="(item, index) in facet.items" :key="index" class="text-[var(--text-sm)] leading-relaxed">{{ item }}</p>
                    </section>
                    <section class="mb-3">
                        <h3 class="text-[var(--text-sm)] font-[var(--weight-strong)]">知道的秘密</h3>
                        <ul class="flex flex-col gap-1">
                            <li v-for="secret in card.data.value.secrets" :key="secret.id" class="flex items-center gap-2 text-[var(--text-sm)]">
                                <StateBadge :state="secret.state" /><span class="min-w-0 flex-1">{{ secret.title }}</span><RefLink v-if="secret.ref" :ref-text="secret.ref" />
                            </li>
                        </ul>
                        <p class="mt-1 text-[var(--text-2xs)] text-[var(--text-muted)]">“没有记录”不等于不知道。</p>
                    </section>
                </template>
                <CardRelations v-else-if="tab === 'relations'" :entity="card.data.value.id" />
                <template v-else-if="tab === 'records'">
                    <div class="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-[var(--bg-panel)] py-1">
                        <SegmentedControl v-model="recordKind" size="xs" :options="[{value: 'knowledge', label: `他知道的 ${card.data.value.counts.knowledge}`}, {value: 'statements', label: `关于他的 ${card.data.value.counts.statements}`}]" aria-label="记录的种类" />
                        <SegmentedControl v-if="recordKind === 'knowledge'" v-model="stateFilter" size="xs" :options="STATES" aria-label="按状态筛" />
                        <div class="w-32"><FormInput v-model="recordQuery" size="sm" icon-class="i-lucide-search" placeholder="按字搜" /></div>
                    </div>
                    <PagedList v-if="recordKind === 'knowledge'" :items="knowledge.items.value" :total="knowledge.total.value" :loading="knowledge.loading.value" :has-more="knowledge.hasMore.value" :error="knowledge.error.value?.message ?? null" @more="knowledge.more()">
                        <template #item="{item, index}">
                            <h4 v-if="index === 0 || knowledge.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                            <p class="record" data-testid="record">
                                <span class="mr-1 text-[var(--text-muted)]">{{ STATE_WORD[item.state] }}</span>{{ item.text }}
                                <RecordTags :tags="item.tags" />
                                <RefLink v-for="ref in item.refs" :key="ref" class="ml-1" :ref-text="ref" />
                            </p>
                        </template>
                    </PagedList>
                    <PagedList v-else :items="statements.items.value" :total="statements.total.value" :loading="statements.loading.value" :has-more="statements.hasMore.value" :error="statements.error.value?.message ?? null" @more="statements.more()">
                        <template #item="{item, index}">
                            <h4 v-if="index === 0 || statements.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                            <p class="record" data-testid="record">
                                {{ item.text }}
                                <RecordTags :tags="item.tags" />
                                <RefLink v-for="ref in item.refs" :key="ref" class="ml-1" :ref-text="ref" />
                            </p>
                        </template>
                    </PagedList>
                </template>
                <PagedList v-else :items="episodes.items.value" :total="episodes.total.value" :loading="episodes.loading.value" :has-more="episodes.hasMore.value" :error="episodes.error.value?.message ?? null" @more="episodes.more()">
                    <template #item="{item, index}">
                        <h4 v-if="index === 0 || episodes.items.value[index - 1]!.chapter !== item.chapter" class="chapter-head">第 {{ item.chapter }} 章</h4>
                        <p class="record">{{ item.title }} <RefLink v-for="ref in item.refs.slice(0, 1)" :key="ref" :ref-text="ref" /></p>
                    </template>
                </PagedList>
            </div>
        </template>
    </div>
</template>

<style scoped>
.chapter-head {
    position: sticky;
    top: 30px;
    background: var(--bg-panel);
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding: 4px 0 2px;
}
.record {
    font-size: var(--text-sm);
    line-height: 1.6;
    padding: 2px 0;
}
</style>
