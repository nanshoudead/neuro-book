<script setup lang="ts">
import type {PromptLocale} from "../../ports";

// 宿主没有注入已发送文字的显示组件时的缺省实现：文字写法原样显示，标签与粘贴块不画成小块，也不能点。
const props = defineProps<{
    text: string;
    locale: PromptLocale;
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
}>();
</script>

<template>
    <div class="plain-prompt-text">{{ props.text }}</div>
</template>

<style scoped>
.plain-prompt-text {
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
</style>
