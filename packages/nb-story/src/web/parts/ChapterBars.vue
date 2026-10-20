<script setup lang="ts">
import {computed} from "vue";

/**
 * 逐章记录量的堆叠柱（viewer 输出 17）：每章一根柱，按类堆起来；横轴是全书的章，阅读位置之后的部分画成浅色的“未读”
 * 区。点一根柱发出这一章。纯 SVG，随容器宽度缩放。
 */
export type ChapterRow = {chapter: number; statements: number; knowledge: number; episodes: number; ledger: number};
const props = defineProps<{rows: readonly ChapterRow[]; total: number; omit?: readonly SeriesKey[]}>();
const emit = defineEmits<{select: [chapter: number]}>();

const ALL_SERIES = [
    {key: "statements", label: "说法", color: "var(--accent-main)"},
    {key: "knowledge", label: "知情", color: "var(--status-success)"},
    {key: "episodes", label: "情节", color: "var(--status-warning)"},
    {key: "ledger", label: "数值", color: "var(--status-danger)"},
] as const;
export type SeriesKey = (typeof ALL_SERIES)[number]["key"];
// 颜色跟着类走，去掉一类时其余各类的颜色不变。
const shownSeries = computed(() => ALL_SERIES.filter(item => !props.omit?.includes(item.key)));
// 画布坐标：横向按容器拉伸（preserveAspectRatio none），高度固定，轴上的字在 SVG 外面用 HTML 写，不随拉伸变形。
const WIDTH = 1000;
const HEIGHT = 140;
const PAD = {left: 0, right: 0, top: 4, bottom: 0};
const geometry = computed(() => {
    const SERIES = shownSeries.value;
    const max = Math.max(1, ...props.rows.map(row => SERIES.reduce((sum, series) => sum + row[series.key], 0)));
    const step = (WIDTH - PAD.left - PAD.right) / Math.max(1, props.total);
    const plot = HEIGHT - PAD.top - PAD.bottom;
    const bars = props.rows.map(row => {
        let y = HEIGHT - PAD.bottom;
        const parts = SERIES.map(series => {
            const height = (row[series.key] / max) * plot;
            y -= height;
            return {color: series.color, y, height};
        });
        const sum = SERIES.reduce((total, series) => total + row[series.key], 0);
        return {chapter: row.chapter, x: PAD.left + (row.chapter - 1) * step, parts, title: `第 ${row.chapter} 章：${SERIES.map(series => `${series.label} ${row[series.key]}`).join("，")}（共 ${sum}）`};
    });
    const readEnd = PAD.left + props.rows.length * step;
    return {max, step, bars, readEnd};
});
</script>

<template>
    <div>
        <div class="flex gap-1">
            <div class="flex w-7 shrink-0 flex-col justify-between text-right text-[length:var(--text-2xs)] text-[var(--text-muted)]"><span>{{ geometry.max }}</span><span>0</span></div>
            <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" preserveAspectRatio="none" class="block h-[140px] min-w-0 flex-1" role="img" aria-label="逐章记录量">
                <rect v-if="rows.length < total" :x="geometry.readEnd" :y="PAD.top" :width="WIDTH - PAD.right - geometry.readEnd" :height="HEIGHT - PAD.top - PAD.bottom" fill="var(--bg-subtle)" />
                <line :x1="PAD.left" :x2="WIDTH - PAD.right" :y1="HEIGHT - 0.5" :y2="HEIGHT - 0.5" stroke="var(--divider)" vector-effect="non-scaling-stroke" />
                <g v-for="bar in geometry.bars" :key="bar.chapter" class="bar" @click="emit('select', bar.chapter)">
                    <title>{{ bar.title }}</title>
                    <rect :x="bar.x" :y="PAD.top" :width="geometry.step" :height="HEIGHT - PAD.top - PAD.bottom" fill="transparent" />
                    <rect v-for="(part, index) in bar.parts" :key="index" :x="bar.x + geometry.step * 0.12" :y="part.y" :width="geometry.step * 0.76" :height="part.height" :fill="part.color" />
                </g>
            </svg>
        </div>
        <div class="ml-8 flex justify-between text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            <span>第 1 章</span><span v-if="rows.length < total">读到第 {{ rows.length }} 章，之后未读</span><span>第 {{ total }} 章</span>
        </div>
        <div class="mt-1 flex flex-wrap gap-3 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
            <span v-for="item in shownSeries" :key="item.key" class="inline-flex items-center gap-1"><i class="inline-block h-2 w-2 rounded-sm" :style="{background: item.color}" />{{ item.label }}</span>
        </div>
    </div>
</template>

<style scoped>
.bar {
    cursor: pointer;
}
.bar:hover rect:first-of-type {
    fill: var(--bg-hover);
}
</style>
