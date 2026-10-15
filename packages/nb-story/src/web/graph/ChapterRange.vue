<script setup lang="ts">
/**
 * 全书图“按章节”下方的章节条（docs/specs/story/viewer.md 输出 30）：整条代表第 1 章到阅读位置所在章，高亮的一段是
 * 图上正看着的范围。拖高亮段平移，拖两端改范围；受控，变化经 update:range 交给宿主。
 */
import {computed, ref} from "vue";

/** 范围用章的连续坐标：第 c 章占 [c - 0.5, c + 0.5]。 */
export type ChapterWindow = {start: number; end: number};
const props = defineProps<{range: ChapterWindow; chapters: number; minSpan: number}>();
const emit = defineEmits<{"update:range": [ChapterWindow]}>();

const track = ref<HTMLElement | null>(null);
const full = computed(() => ({start: 0.5, end: props.chapters + 0.5}));
const left = computed(() => ((props.range.start - full.value.start) / (full.value.end - full.value.start)) * 100);
const width = computed(() => ((props.range.end - props.range.start) / (full.value.end - full.value.start)) * 100);
const label = computed(() => `第 ${Math.max(1, Math.round(props.range.start + 0.5))} 到 ${Math.min(props.chapters, Math.round(props.range.end - 0.5))} 章`);

/** 按拖动的部位改范围：move 平移，start、end 只动一端；不越出全书，也不小于 minSpan。 */
function drag(event: PointerEvent, part: "move" | "start" | "end"): void {
    const element = track.value;
    if (element === null) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const perPx = (full.value.end - full.value.start) / Math.max(1, rect.width);
    const origin = event.clientX;
    const initial = {...props.range};
    const onMove = (move: PointerEvent) => {
        const delta = (move.clientX - origin) * perPx;
        let {start, end} = initial;
        if (part === "move") {
            const span = end - start;
            start = Math.min(Math.max(full.value.start, start + delta), full.value.end - span);
            end = start + span;
        } else if (part === "start") {
            start = Math.min(Math.max(full.value.start, start + delta), end - props.minSpan);
        } else {
            end = Math.max(Math.min(full.value.end, end + delta), start + props.minSpan);
        }
        emit("update:range", {start, end});
    };
    const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
}
</script>

<template>
    <div class="chapter-range" data-testid="chapter-range">
        <span class="edge-label">1</span>
        <div ref="track" class="track">
            <div class="thumb" :style="{left: `${left}%`, width: `${width}%`}" :title="label" data-testid="chapter-range-thumb" @pointerdown="drag($event, 'move')">
                <span class="handle is-start" aria-label="改起点" @pointerdown.stop="drag($event, 'start')" />
                <span class="handle is-end" aria-label="改终点" @pointerdown.stop="drag($event, 'end')" />
            </div>
        </div>
        <span class="edge-label">{{ chapters }}</span>
        <span class="range-label" data-testid="chapter-range-label">{{ label }}</span>
    </div>
</template>

<style scoped>
.chapter-range {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    user-select: none;
}
.track {
    position: relative;
    flex: 1;
    height: 14px;
    border-radius: 4px;
    background: var(--bg-subtle);
}
.thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 8px;
    border: 1px solid var(--border-accent, var(--accent-main));
    border-radius: 4px;
    background: var(--accent-bg);
    cursor: grab;
}
.handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
}
.handle.is-start {
    left: -3px;
}
.handle.is-end {
    right: -3px;
}
.range-label {
    min-width: 8em;
    text-align: right;
    color: var(--text-secondary);
}
</style>
