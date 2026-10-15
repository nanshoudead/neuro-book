<script setup lang="ts">
import {computed} from "vue";

/**
 * 悬念逐章累计的提出与解答两条线（viewer 输出 17），两线之间就是当时还没解开的。点图上的一章发出这一章。纯 SVG。
 */
const props = defineProps<{rows: readonly {chapter: number; raised: number; answered: number}[]; total: number}>();
const emit = defineEmits<{select: [chapter: number]}>();

// 同 ChapterBars：横向拉伸、高度固定，轴上的字用 HTML，线宽不随拉伸变。
const WIDTH = 1000;
const HEIGHT = 120;
const PAD = {left: 0, right: 0, top: 4, bottom: 0};
const geometry = computed(() => {
    let raised = 0;
    let answered = 0;
    const points = props.rows.map(row => {
        raised += row.raised;
        answered += row.answered;
        return {chapter: row.chapter, raised, answered};
    });
    const max = Math.max(1, raised);
    const step = (WIDTH - PAD.left - PAD.right) / Math.max(1, props.total);
    const x = (chapter: number) => PAD.left + (chapter - 0.5) * step;
    const y = (value: number) => HEIGHT - PAD.bottom - (value / max) * (HEIGHT - PAD.top - PAD.bottom);
    const line = (key: "raised" | "answered") => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.chapter)},${y(point[key])}`).join(" ");
    const area = points.length ? `${line("raised")} ${[...points].reverse().map(point => `L${x(point.chapter)},${y(point.answered)}`).join(" ")} Z` : "";
    return {points, max, step, x, raisedLine: line("raised"), answeredLine: line("answered"), area, last: points.at(-1)};
});
</script>

<template>
    <div>
        <div class="flex gap-1">
            <div class="flex w-7 shrink-0 flex-col justify-between text-right text-[length:var(--text-2xs)] text-[var(--text-muted)]"><span>{{ geometry.max }}</span><span>0</span></div>
            <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" preserveAspectRatio="none" class="block h-[120px] min-w-0 flex-1" role="img" aria-label="悬念累计提出与解答">
                <line :x1="PAD.left" :x2="WIDTH - PAD.right" :y1="HEIGHT - 0.5" :y2="HEIGHT - 0.5" stroke="var(--divider)" vector-effect="non-scaling-stroke" />
                <path :d="geometry.area" fill="color-mix(in srgb, var(--status-warning) 14%, transparent)" />
                <path :d="geometry.raisedLine" fill="none" stroke="var(--status-warning)" stroke-width="2" vector-effect="non-scaling-stroke" />
                <path :d="geometry.answeredLine" fill="none" stroke="var(--status-success)" stroke-width="2" vector-effect="non-scaling-stroke" />
                <rect
                    v-for="point in geometry.points" :key="point.chapter" class="hit" :x="geometry.x(point.chapter) - geometry.step / 2" :y="PAD.top" :width="geometry.step" :height="HEIGHT - PAD.top - PAD.bottom"
                    fill="transparent" @click="emit('select', point.chapter)"
                ><title>第 {{ point.chapter }} 章：累计提出 {{ point.raised }}，解答 {{ point.answered }}，没解开 {{ point.raised - point.answered }}</title></rect>
            </svg>
        </div>
        <div class="ml-8 flex justify-between text-[length:var(--text-2xs)] text-[var(--text-muted)]"><span>第 1 章</span><span>第 {{ total }} 章</span></div>
        <div class="mt-1 flex flex-wrap gap-3 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
            <span class="inline-flex items-center gap-1"><i class="inline-block h-0.5 w-3 bg-[var(--status-warning)]" />累计提出<template v-if="geometry.last"> {{ geometry.last.raised }}</template></span>
            <span class="inline-flex items-center gap-1"><i class="inline-block h-0.5 w-3 bg-[var(--status-success)]" />累计解答<template v-if="geometry.last"> {{ geometry.last.answered }}</template></span>
            <span>两线之间是当时没解开的</span>
        </div>
    </div>
</template>

<style scoped>
.hit {
    cursor: pointer;
}
.hit:hover {
    fill: var(--bg-hover);
    fill-opacity: 0.6;
}
</style>
