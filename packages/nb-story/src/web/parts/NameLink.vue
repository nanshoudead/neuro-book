<script setup lang="ts">
import {useBook, type Tab} from "../host/book";

/** 人名：点开人物卡，不离开当前页（viewer 输出 20）。 */
withDefaults(defineProps<{id: string; label: string; tab?: Tab; strong?: boolean}>(), {tab: "summary", strong: false});
const book = useBook();
</script>

<template>
    <button type="button" class="name-link" :class="strong ? 'is-strong' : ''" @click.stop="book.openCard(id, tab)">{{ label }}</button>
</template>

<style scoped>
.name-link {
    display: inline;
    text-align: inherit;
    color: inherit;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    padding: 0 2px;
}
.name-link:hover {
    background: color-mix(in srgb, var(--accent-main) 24%, transparent);
}
.name-link.is-strong {
    font-weight: var(--weight-strong);
}
</style>
