<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";

import type {Tags} from "../../contract/contract";

/** 记录标记：明说、角色的说法、角色认为、推断（viewer 输出 7）。 */
const props = defineProps<{tags: Tags | null}>();
const KIND = {fact: "明说", claim: "角色的说法", belief: "角色认为"} as const;
</script>

<template>
    <span v-if="props.tags" class="inline-flex gap-1">
        <Badge v-if="props.tags.kind" size="sm" variant="soft" :tone="props.tags.kind === 'fact' ? 'neutral' : 'warning'">{{ KIND[props.tags.kind] }}</Badge>
        <Badge v-if="props.tags.inferred" size="sm" variant="outline" tone="neutral">推断</Badge>
    </span>
</template>
