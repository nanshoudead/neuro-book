<script setup lang="ts">
/**
 * 抽屉里的出处原文：那几段与前后各几段，被引用的段落高亮，称呼可点（viewer 输出 19）。
 */
import {computed} from "vue";

import {parseRef} from "../../contract/refs";
import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import SourceText from "../parts/SourceText.vue";

const props = defineProps<{refText: string}>();
const book = useBook();
/** 出处前后各带几段。 */
const CONTEXT = 3;

// 出处可以跨章（问答的依据，例如 38.50—39.2）：前文从起点那一章往前带几段，后文在终点那一章往后带几段。
const range = computed(() => {
    const parsed = parseRef(props.refText);
    if (parsed === null) return null;
    const {from, to} = parsed;
    const lastOfTo = book.info.paragraphs[to.chapter - 1] ?? to.paragraph;
    return {from, to, first: {chapter: from.chapter, paragraph: Math.max(1, from.paragraph - CONTEXT)}, last: {chapter: to.chapter, paragraph: Math.min(lastOfTo, to.paragraph + CONTEXT)}};
});
const query = useStoryQuery("source.read", () => (range.value ? {from: range.value.first, to: range.value.last} : null));
const order = (chapter: number, paragraph: number): number => chapter * 1_000_000 + paragraph;
function cited(chapter: number, paragraph: number): boolean {
    const value = range.value;
    if (value === null) return false;
    const at = order(chapter, paragraph);
    return at >= order(value.from.chapter, value.from.paragraph) && at <= order(value.to.chapter, value.to.paragraph);
}
</script>

<template>
    <div class="flex flex-col gap-2 p-3" data-testid="drawer-source">
        <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">原文 {{ refText }}</h2>
        <div v-if="query.error.value?.code === 'beyond_position' && range" class="text-[length:var(--text-sm)]" data-testid="beyond-position">
            第 {{ range.to.chapter }} 章还没读到。
            <button type="button" class="ml-1 text-[var(--accent-text)] underline" @click="book.setAt({chapter: range.to.chapter})">把阅读位置拨到第 {{ range.to.chapter }} 章</button>
        </div>
        <PageState v-else :loading="query.loading.value && !query.data.value" :error="query.error.value?.message ?? null" @retry="query.reload()" />
        <p
            v-for="paragraph in query.data.value?.paragraphs ?? []" :key="`${paragraph.chapter}.${paragraph.paragraph}`"
            class="source-para" :class="cited(paragraph.chapter, paragraph.paragraph) ? 'is-cited' : ''"
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
