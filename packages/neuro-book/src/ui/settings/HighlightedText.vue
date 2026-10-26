<script setup lang="ts">
/**
 * 搜索结果里的一段文字（同名 .md）：命中的字用 `<mark>` 标底色，其余原样。按片段渲染、不拼 HTML，用户的字不会被当成标签。
 */
import {computed} from "vue";

import {highlightSegments} from "./highlight";

defineOptions({name: "HighlightedText"});

const props = withDefaults(defineProps<{
    text: string;
    /** 要标出的词（小写）；空时原样显示。 */
    words?: ReadonlyArray<string>;
}>(), {words: () => []});

const segments = computed(() => highlightSegments(props.text, props.words));
</script>

<template>
    <span class="highlighted-text"><template v-for="(segment, index) in segments" :key="index"><mark v-if="segment.hit" class="highlighted-text__mark" data-settings-hit>{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></span>
</template>

<style scoped>
.highlighted-text__mark {
    border-radius: calc(var(--radius-control) / 2);
    background: color-mix(in srgb, var(--accent-main) 22%, transparent);
    color: inherit;
}
</style>
