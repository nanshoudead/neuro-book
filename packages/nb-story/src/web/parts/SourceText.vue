<script setup lang="ts">
import {computed} from "vue";

import NameLink from "./NameLink.vue";

/** 一段原文，称呼带底色、可点开人物卡（viewer 输出 16、19）。称呼的位置来自查询结果，不在这里另行匹配。 */
const props = defineProps<{text: string; names: readonly {entity: string; text: string; start: number; end: number}[]}>();

const parts = computed(() => {
    const result: ({kind: "text"; text: string} | {kind: "name"; text: string; entity: string})[] = [];
    let cursor = 0;
    for (const name of [...props.names].sort((a, b) => a.start - b.start)) {
        // 位置越界或与前一个称呼重叠时跳过这个称呼，保证原文一字不丢。
        if (name.start < cursor || name.end > props.text.length || props.text.slice(name.start, name.end) !== name.text) continue;
        if (name.start > cursor) result.push({kind: "text", text: props.text.slice(cursor, name.start)});
        result.push({kind: "name", text: name.text, entity: name.entity});
        cursor = name.end;
    }
    if (cursor < props.text.length) result.push({kind: "text", text: props.text.slice(cursor)});
    return result;
});
</script>

<template>
    <span><template v-for="(part, index) in parts" :key="index"><NameLink v-if="part.kind === 'name'" :id="part.entity" :label="part.text" /><template v-else>{{ part.text }}</template></template></span>
</template>
