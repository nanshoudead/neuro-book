<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {useStoryQuery} from "../host/query";

withDefaults(defineProps<{variant?: "badge" | "dot"}>(), {variant: "badge"});
/** 按阅读位置算的数目：不用 `book.info`（它不带阅读位置，是全书的数，会泄漏后文有候选）。 */
const list = useStoryQuery("revisions.list", () => ({limit: 1}));
const count = computed(() => (list.data.value ? list.data.value.counts.pending + list.data.value.counts.stale : 0));
</script>

<template>
    <template v-if="count > 0">
        <Badge v-if="variant === 'badge'" size="sm" tone="accent" data-testid="revisions-badge">{{ count }}</Badge>
        <span v-else class="revisions-dot" role="img" :aria-label="`${count} 条待确认的修订`" data-testid="revisions-dot" />
    </template>
</template>

<style scoped>
.revisions-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: var(--radius-pill);
    background: var(--accent-text);
}
</style>
