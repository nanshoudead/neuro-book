<script setup lang="ts">
import type {MarkdownAssetResolver, PromptLocale} from "../../ports";

// 宿主没有注入 Markdown 显示组件时的缺省实现：原文按纯文字显示，保留换行，流式时末尾有光标；不解析 Markdown，也就没有可点击的东西。
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

/* 流式生成时末尾的光标，同真 Markdown 显示的样子；减少动效时不闪。 */
.plain-markdown[data-streaming]::after {
    content: "";
    display: inline-block;
    width: 0.45em;
    height: 1.1em;
    margin-left: 2px;
    vertical-align: text-bottom;
    background: currentColor;
    opacity: 0.55;
    animation: plain-markdown-caret 1s step-end infinite;
}

@keyframes plain-markdown-caret {
    50% {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .plain-markdown[data-streaming]::after {
        animation: none;
    }
}
</style>
