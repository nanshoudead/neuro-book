<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";

import type {Awareness} from "../../contract/contract";

/** 知情状态：知道、读到、认为、听说、怀疑、不知道、没有记录。“没有记录”用描边，与“明确不知道”区分（viewer 输出 11）。 */
defineProps<{state: Awareness}>();
const LABEL: Record<Awareness, string> = {knows: "知道", read: "读到", believes: "认为", heard: "听说", suspects: "怀疑", unaware: "不知道", "no-record": "没有记录"};
const TONE = {knows: "success", read: "success", believes: "accent", heard: "accent", suspects: "warning", unaware: "danger", "no-record": "neutral"} as const;
</script>

<template>
    <Badge size="sm" :variant="state === 'no-record' ? 'outline' : 'soft'" :tone="TONE[state]" :data-state="state">{{ LABEL[state] }}</Badge>
</template>
