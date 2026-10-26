<script setup lang="ts">
import {computed} from "vue";

/** 数值余额随章变化的阶梯线（viewer 输出 12）。相对值的段画虚线；原文与累加对不上的一笔标一个点。 */
const props = defineProps<{points: readonly {chapter: number; balance: number; relative: boolean; gap: number | null}[]; chapters: number}>();

const WIDTH = 640;
const HEIGHT = 160;
const PAD = 28;
const geometry = computed(() => {
    const values = props.points.map(point => point.balance);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const x = (chapter: number) => PAD + ((chapter - 1) / Math.max(1, props.chapters - 1)) * (WIDTH - PAD * 2);
    const y = (value: number) => HEIGHT - PAD - ((value - min) / (max - min || 1)) * (HEIGHT - PAD * 2);
    const segments: {d: string; relative: boolean}[] = [];
    props.points.forEach((point, index) => {
        const next = props.points[index + 1];
        const endChapter = next ? next.chapter : props.chapters;
        segments.push({d: `M${x(point.chapter)},${y(point.balance)} H${x(endChapter)}${next ? ` V${y(next.balance)}` : ""}`, relative: point.relative});
    });
    return {segments, marks: props.points.filter(point => point.gap !== null && point.gap !== 0).map(point => ({cx: x(point.chapter), cy: y(point.balance), gap: point.gap!})), min, max, y};
});
</script>

<template>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="h-auto w-full" role="img" aria-label="余额随章变化">
        <line :x1="PAD" :x2="WIDTH - PAD" :y1="HEIGHT - PAD" :y2="HEIGHT - PAD" stroke="var(--divider)" />
        <text :x="PAD - 4" :y="geometry.y(geometry.max) + 4" text-anchor="end" font-size="10" fill="var(--text-muted)">{{ geometry.max }}</text>
        <text :x="PAD - 4" :y="geometry.y(geometry.min) + 4" text-anchor="end" font-size="10" fill="var(--text-muted)">{{ geometry.min }}</text>
        <text :x="PAD" :y="HEIGHT - 8" font-size="10" fill="var(--text-muted)">第 1 章</text>
        <text :x="WIDTH - PAD" :y="HEIGHT - 8" text-anchor="end" font-size="10" fill="var(--text-muted)">第 {{ chapters }} 章</text>
        <path v-for="(segment, index) in geometry.segments" :key="index" :d="segment.d" fill="none" stroke="var(--accent-main)" stroke-width="2" :stroke-dasharray="segment.relative ? '4 3' : undefined" />
        <circle v-for="(mark, index) in geometry.marks" :key="`m${index}`" :cx="mark.cx" :cy="mark.cy" r="4" fill="var(--status-warning)"><title>原文比累加{{ mark.gap > 0 ? "多" : "少" }} {{ Math.abs(mark.gap) }}</title></circle>
    </svg>
</template>
