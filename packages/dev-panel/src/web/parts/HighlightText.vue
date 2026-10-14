<script setup lang="ts">
import {computed} from "vue";
import {highlightParts} from "../host/highlight.js";

/** 一段文字，搜索词用 `<mark>` 标出；契约见同名 .md。 */
const props = defineProps<{text: string; q: string}>();
const parts = computed(() => highlightParts(props.text, props.q));
</script>

<template>
    <template v-for="(part, index) in parts" :key="index"><mark v-if="part.hit" class="nbdev-mark">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
</template>
