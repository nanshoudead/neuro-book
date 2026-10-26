<script setup lang="ts">
import {computed} from "vue";

import NameLink from "./NameLink.vue";

/**
 * 主要人物逐章出场的热力格（viewer 输出 17）：一行一个人，一格一章，颜色越深这一章被提到得越多；横轴是全书的章，
 * 阅读位置之后的格子留空。点格子发出这一章，点名字打开人物卡。
 */
const props = defineProps<{cast: readonly {id: string; label: string; counts: readonly number[]}[]; total: number}>();
const emit = defineEmits<{select: [chapter: number]}>();

const max = computed(() => Math.max(1, ...props.cast.flatMap(person => person.counts)));
function shade(count: number): string {
    if (count === 0) return "transparent";
    // 开方压一下：少数章被提到上百次，线性映射会让其余格子都看不出来。
    const strength = Math.round(15 + 85 * Math.sqrt(count / max.value));
    return `color-mix(in srgb, var(--accent-main) ${strength}%, transparent)`;
}
</script>

<template>
    <div class="heatmap" :style="{gridTemplateColumns: `7em repeat(${total}, minmax(0, 1fr))`}" role="table" aria-label="主要人物逐章出场">
        <template v-for="person in cast" :key="person.id">
            <div class="name" role="rowheader"><NameLink :id="person.id" :label="person.label" /></div>
            <!-- 格子不进 Tab 顺序：12 人乘上百章会有上千个停靠点；键盘用户从原文页的目录选章 -->
            <button
                v-for="(count, index) in person.counts" :key="index" type="button" tabindex="-1" class="cell" :style="{background: shade(count)}"
                :title="`${person.label}：第 ${index + 1} 章出场 ${count} 次`" :aria-label="`${person.label} 第 ${index + 1} 章 ${count} 次`" @click="emit('select', index + 1)"
            />
            <div v-for="index in total - person.counts.length" :key="`unread-${index}`" class="cell is-unread" />
        </template>
        <div />
        <div class="axis" :style="{gridColumn: `2 / span ${total}`}"><span>第 1 章</span><span>第 {{ total }} 章</span></div>
    </div>
</template>

<style scoped>
.heatmap {
    display: grid;
    row-gap: 2px;
    align-items: center;
}
.name {
    overflow: hidden;
    padding-right: 6px;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cell {
    height: 14px;
    border-right: 1px solid var(--panel-surface);
}
.cell:not(.is-unread):hover {
    outline: 1px solid var(--accent-main);
}
.cell.is-unread {
    background: var(--bg-subtle);
}
.axis {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-2xs);
    color: var(--text-muted);
}
</style>
