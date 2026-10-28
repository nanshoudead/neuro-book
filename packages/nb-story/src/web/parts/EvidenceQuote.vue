<script setup lang="ts">
import RefLink from "./RefLink.vue";

defineProps<{refText: string; text: string}>();
</script>

<template>
    <blockquote v-if="text" class="evidence-quote"><RefLink :ref-text="refText" class="mr-1.5" />{{ text }}</blockquote>
</template>

<style scoped>
.evidence-quote {
    margin: 0;
    padding: 2px 10px;
    border-left: 3px solid var(--border-accent);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: 1.6;
}
</style>
