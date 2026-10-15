<script setup lang="ts">
/**
 * 抽屉里的出处原文：那几段与前后各几段，被引用的段落高亮，称呼可点（viewer 输出 19）。
 */
import {computed} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import SourceText from "../parts/SourceText.vue";

const props = defineProps<{refText: string}>();
const book = useBook();
/** 出处前后各带几段。 */
const CONTEXT = 3;

const range = computed(() => {
    const match = /^(\d+)\.(\d+)(?:—(\d+)\.(\d+))?$/u.exec(props.refText);
    if (!match) return null;
    const chapter = Number(match[1]);
    const from = Number(match[2]);
    const to = match[4] ? Number(match[4]) : from;
    const length = book.info.paragraphs[chapter - 1] ?? to;
    return {chapter, from, to, first: Math.max(1, from - CONTEXT), last: Math.min(length, to + CONTEXT)};
});
const query = useStoryQuery("source.read", () => (range.value ? {from: {chapter: range.value.chapter, paragraph: range.value.first}, to: {chapter: range.value.chapter, paragraph: range.value.last}} : null));
</script>

<template>
    <div class="flex flex-col gap-2 p-3" data-testid="drawer-source">
        <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">原文 {{ refText }}</h2>
        <div v-if="query.error.value?.code === 'beyond_position' && range" class="text-[length:var(--text-sm)]" data-testid="beyond-position">
            第 {{ range.chapter }} 章还没读到。
            <button type="button" class="ml-1 text-[var(--accent-text)] underline" @click="book.setAt({chapter: range.chapter})">把阅读位置拨到第 {{ range.chapter }} 章</button>
        </div>
        <PageState v-else :loading="query.loading.value && !query.data.value" :error="query.error.value?.message ?? null" @retry="query.reload()" />
        <p
            v-for="paragraph in query.data.value?.paragraphs ?? []" :key="paragraph.paragraph"
            class="source-para" :class="range && paragraph.paragraph >= range.from && paragraph.paragraph <= range.to ? 'is-cited' : ''"
        >
            <span class="para-no">{{ paragraph.chapter }}.{{ paragraph.paragraph }}</span>
            <SourceText :text="paragraph.text" :names="paragraph.names" />
        </p>
    </div>
</template>

<style scoped>
.source-para {
    line-height: 1.75;
    padding: 2px 6px;
    border-radius: var(--radius-control);
}
.source-para.is-cited {
    background: var(--accent-bg);
}
.para-no {
    margin-right: 6px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}
</style>
