<script setup lang="ts">
import {IconButton, Slider} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {PositionInput} from "../../contract/contract";

/**
 * 顶栏的阅读位置：上一章、下一章、章滑块；“段”打开后多一个段滑块；读到抽取终点时写“全部读完”，没到时有一个
 * 一步跳到终点的按钮（viewer 输出 5）。`end` 是抽取到的最后一章。
 */
const props = defineProps<{at: PositionInput; paragraphs: readonly number[]; end: number; atEnd: boolean; compact?: boolean}>();
const emit = defineEmits<{"update:at": [PositionInput]; "to-end": []}>();

const chapters = computed(() => props.paragraphs.length);
const fine = ref(props.at.paragraph !== undefined);
watch(() => props.at.paragraph, value => {
    if (value !== undefined) fine.value = true;
});
// 滑块拖动时先只改本地的值，松手（或键盘）后才提交，免得每挪一格就整页重取。
const chapterDraft = ref(props.at.chapter);
const paragraphDraft = ref(props.at.paragraph ?? props.paragraphs[props.at.chapter - 1] ?? 1);
watch(() => props.at, value => {
    chapterDraft.value = value.chapter;
    paragraphDraft.value = value.paragraph ?? props.paragraphs[value.chapter - 1] ?? 1;
});
const paragraphCount = computed(() => props.paragraphs[chapterDraft.value - 1] ?? 1);

function scalar(value: number | number[]): number {
    return typeof value === "number" ? value : (value[0] ?? 1);
}
function commitChapter(chapter: number): void {
    const next = Math.min(Math.max(1, chapter), chapters.value);
    emit("update:at", fine.value ? {chapter: next, paragraph: props.paragraphs[next - 1] ?? 1} : {chapter: next});
}
function commitParagraph(paragraph: number): void {
    emit("update:at", {chapter: chapterDraft.value, paragraph: Math.min(Math.max(1, paragraph), paragraphCount.value)});
}
function toggleFine(): void {
    fine.value = !fine.value;
    if (!fine.value && props.at.paragraph !== undefined) emit("update:at", {chapter: props.at.chapter});
}
</script>

<template>
    <div class="reading flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[var(--radius-control)] bg-[var(--control-surface)] px-2 py-1" data-testid="reading-control">
        <span class="i-lucide-bookmark text-[var(--text-secondary)]" />
        <IconButton size="xs" icon-class="i-lucide-chevron-left" aria-label="上一章" :disabled="props.at.chapter <= 1" @click="commitChapter(props.at.chapter - 1)" />
        <span class="whitespace-nowrap text-[length:var(--text-sm)]" data-testid="reading-label">
            <template v-if="props.atEnd && chapterDraft === props.at.chapter"><b>全部读完</b><span class="text-[var(--text-muted)]">（{{ chapters }} 章）</span></template>
            <template v-else>读到 <b>第 {{ chapterDraft }} 章</b><span class="text-[var(--text-muted)]"> / {{ chapters }}</span></template>
        </span>
        <IconButton size="xs" icon-class="i-lucide-chevron-right" aria-label="下一章" :disabled="props.at.chapter >= chapters" @click="commitChapter(props.at.chapter + 1)" />
        <IconButton v-if="!props.atEnd" size="xs" icon-class="i-lucide-chevrons-right" aria-label="读完（跳到最后）" title="读完（跳到最后）" data-testid="reading-end" @click="emit('to-end')" />
        <div class="reading-slider" :class="props.compact ? 'is-short' : ''">
            <Slider v-model="chapterDraft" :min="1" :max="chapters" size="sm" aria-label="读到第几章" @value-commit="(value: number | number[]) => commitChapter(scalar(value))" />
        </div>
        <button type="button" class="fine-toggle" :class="fine ? 'is-on' : ''" :aria-pressed="fine" title="精确到段" @click="toggleFine">段</button>
        <div v-if="fine" class="flex items-center gap-1.5">
            <span class="whitespace-nowrap text-[length:var(--text-sm)]">第 <b>{{ paragraphDraft }}</b> 段<span class="text-[var(--text-muted)]"> / {{ paragraphCount }}</span></span>
            <div class="reading-slider">
                <Slider v-model="paragraphDraft" :min="1" :max="paragraphCount" size="sm" aria-label="读到这一章的第几段" @value-commit="(value: number | number[]) => commitParagraph(scalar(value))" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.reading-slider {
    width: 160px;
}
.reading-slider.is-short {
    width: 96px;
}
.fine-toggle {
    font-size: var(--text-xs);
    border-radius: var(--radius-control);
    padding: 0 6px;
    color: var(--text-secondary);
    border: var(--border-w, 1px) solid var(--border-color);
}
.fine-toggle.is-on {
    color: var(--accent-text);
    border-color: var(--border-accent);
    background: var(--accent-bg);
}
</style>
