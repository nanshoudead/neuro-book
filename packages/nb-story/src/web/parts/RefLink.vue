<script setup lang="ts">
import {useBook} from "../host/book";

/** 出处“章.段”：点开在抽屉里显示那几段原文（viewer 输出 19）。 */
defineProps<{refText: string}>();
const book = useBook();
</script>

<template>
    <button type="button" class="ref-link" :title="`看原文 ${refText}`" @click.stop="book.openSource(refText)">{{ refText }}</button>
</template>

<style scoped>
.ref-link {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    color: var(--accent-text);
    white-space: nowrap;
}
.ref-link:hover {
    text-decoration: underline;
}
</style>
