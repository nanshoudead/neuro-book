<script setup lang="ts">
/** 抽屉里引用某一段的记录（viewer 输出 16）。 */
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import RecordTags from "../parts/RecordTags.vue";
import RefLink from "../parts/RefLink.vue";

const props = defineProps<{chapter: number; paragraph: number}>();
const TYPE = {statement: "说法", knowledge: "知情", episode: "情节", ledger: "数值", question: "悬念", time: "时间", secret: "秘密"} as const;
const query = useStoryQuery("source.records", () => ({chapter: props.chapter, paragraph: props.paragraph}));
</script>

<template>
    <div class="flex flex-col gap-2 p-3" data-testid="drawer-records">
        <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">引用 {{ chapter }}.{{ paragraph }} 的记录</h2>
        <PageState :loading="query.loading.value && !query.data.value" :error="query.error.value?.message ?? null" @retry="query.reload()" />
        <p v-if="query.data.value && query.data.value.records.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">这一段没有可见的记录</p>
        <ul class="flex flex-col gap-2">
            <li v-for="record in query.data.value?.records ?? []" :key="`${record.type}:${record.id}`" class="text-[length:var(--text-sm)]">
                <span class="mr-1 text-[var(--text-muted)]">{{ TYPE[record.type] }}</span>{{ record.text }}
                <RecordTags :tags="record.tags" />
                <span class="ml-1 inline-flex gap-1"><RefLink v-for="item in record.refs" :key="item" :ref-text="item" /></span>
            </li>
        </ul>
    </div>
</template>
