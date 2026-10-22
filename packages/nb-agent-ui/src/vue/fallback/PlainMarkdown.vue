<script setup lang="ts">
import type {MarkdownAssetResolver, PromptLocale} from "../../ports";

// 宿主没有注入 Markdown 显示组件时的缺省实现：原文按纯文字显示，保留换行；不解析 Markdown，也就没有可点击的东西。
const props = defineProps<{
    text: string;
    locale: PromptLocale;
    streaming?: boolean;
    resolveAsset?: MarkdownAssetResolver;
}>();
</script>

<template>
    <div class="plain-markdown" :data-streaming="props.streaming || undefined">{{ props.text }}</div>
</template>

<style scoped>
.plain-markdown {
    min-width: 0;
    line-height: 1.7;
    white-space: pre-wrap;
}
</style>
