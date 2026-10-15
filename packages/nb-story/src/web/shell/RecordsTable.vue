<script setup lang="ts">
/**
 * 人物卡记录“在主区打开”的宽表格（docs/specs/story/viewer.md 输出 10）：筛选与人物卡相同，多出“怎么知道的”一列。
 */
import {FormInput, IconButton, SegmentedControl} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import {useBook} from "../host/book";
import {usePagedQuery, useStoryQuery} from "../host/query";
import PagedList from "../parts/PagedList.vue";
import RecordTags from "../parts/RecordTags.vue";
import RefLink from "../parts/RefLink.vue";
import StateBadge from "../parts/StateBadge.vue";

const props = defineProps<{entity: string}>();
const book = useBook();
const STATES = [{value: "", label: "全部"}, {value: "knows", label: "知道"}, {value: "believes", label: "认为"}, {value: "suspects", label: "怀疑"}, {value: "heard", label: "听说"}, {value: "unaware", label: "不知道"}];
const kind = ref<"knowledge" | "statements">("knowledge");
const state = ref("");
const text = ref("");
const card = useStoryQuery("entity.card", () => ({entity: props.entity}));
const knowledge = usePagedQuery("entity.knowledge", () => (kind.value === "knowledge" ? {entity: props.entity, ...(state.value ? {state: state.value as "knows"} : {}), ...(text.value.trim() ? {query: text.value.trim()} : {})} : null), 200);
const statements = usePagedQuery("entity.statements", () => (kind.value === "statements" ? {entity: props.entity, ...(text.value.trim() ? {query: text.value.trim()} : {})} : null), 200);
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="records-table">
        <div class="story-page-body max-w-none">
            <div class="mb-2 flex flex-wrap items-center gap-2">
                <IconButton size="xs" icon-class="i-lucide-arrow-left" aria-label="回到页面" @click="book.wideRecords.value = null" />
                <h1 class="story-page-title mb-0">{{ card.data.value?.label ?? "" }} 的记录 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            </div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
                <SegmentedControl v-model="kind" size="xs" :options="[{value: 'knowledge', label: '他知道的'}, {value: 'statements', label: '关于他的'}]" aria-label="记录的种类" />
                <SegmentedControl v-if="kind === 'knowledge'" v-model="state" size="xs" :options="STATES" aria-label="按状态筛" />
                <div class="w-44"><FormInput v-model="text" size="sm" icon-class="i-lucide-search" placeholder="按字搜" /></div>
            </div>
            <table class="story-table w-full">
                <thead>
                    <tr v-if="kind === 'knowledge'"><th>章</th><th>状态</th><th>知道了什么</th><th>怎么知道的</th><th>标记</th><th>出处</th></tr>
                    <tr v-else><th>章</th><th>说法</th><th>标记</th><th>出处</th></tr>
                </thead>
                <tbody v-if="kind === 'knowledge'">
                    <tr v-for="item in knowledge.items.value" :key="item.id" data-testid="wide-record">
                        <td>{{ item.chapter }}</td><td><StateBadge :state="item.state" /></td><td>{{ item.text }}</td><td>{{ item.how ?? "" }}</td>
                        <td><RecordTags :tags="item.tags" /></td><td><RefLink v-for="ref in item.refs" :key="ref" :ref-text="ref" class="mr-1" /></td>
                    </tr>
                </tbody>
                <tbody v-else>
                    <tr v-for="item in statements.items.value" :key="item.id" data-testid="wide-record">
                        <td>{{ item.chapter }}</td><td>{{ item.text }}</td><td><RecordTags :tags="item.tags" /></td><td><RefLink v-for="ref in item.refs" :key="ref" :ref-text="ref" class="mr-1" /></td>
                    </tr>
                </tbody>
            </table>
            <PagedList v-if="kind === 'knowledge'" :items="[]" :total="knowledge.total.value" :loading="knowledge.loading.value" :has-more="knowledge.hasMore.value" :error="knowledge.error.value?.message ?? null" @more="knowledge.more()" @retry="knowledge.reload()"><template #item /></PagedList>
            <PagedList v-else :items="[]" :total="statements.total.value" :loading="statements.loading.value" :has-more="statements.hasMore.value" :error="statements.error.value?.message ?? null" @more="statements.more()" @retry="statements.reload()"><template #item /></PagedList>
        </div>
    </div>
</template>
