<script setup lang="ts">
/**
 * 时间线（docs/specs/story/viewer.md 输出 14）：默认按故事时间（第几天、时段）分组，可切到按章节；后来补叙的点标
 * “第 N 章补叙”；日子不明的单独一组。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import RefLink from "../parts/RefLink.vue";

const book = useBook();
const order = ref<"story" | "source">("story");
const timeline = useStoryQuery("timeline", () => ({order: order.value}));
const PART: Record<string, string> = {dawn: "黎明", morning: "早上", forenoon: "上午", noon: "中午", afternoon: "下午", dusk: "傍晚", evening: "晚上", night: "夜里"};
const groups = computed(() => {
    const result: {key: string; title: string; points: NonNullable<typeof timeline.data.value>["points"]}[] = [];
    const unknown: typeof result[number]["points"] = [];
    for (const point of timeline.data.value?.points ?? []) {
        if (order.value === "story" && point.day === null) {
            unknown.push(point);
            continue;
        }
        const key = order.value === "story" ? `d${point.day}` : `c${point.chapter}`;
        const title = order.value === "story" ? `第 ${point.day} 天` : `第 ${point.chapter} 章`;
        const last = result.at(-1);
        if (last?.key === key) last.points.push(point);
        else result.push({key, title, points: [point]});
    }
    if (unknown.length) result.push({key: "unknown", title: "日子不明", points: unknown});
    return result;
});
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-timeline">
        <div class="story-page-body">
            <h1 class="story-page-title">时间线 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <SegmentedControl v-model="order" size="xs" :options="[{value: 'story', label: '按故事时间'}, {value: 'source', label: '按章节'}]" aria-label="排法" />
            <PageState :loading="timeline.loading.value && !timeline.data.value" :error="timeline.error.value?.message ?? null" @retry="timeline.reload()" />
            <section v-for="group in groups" :key="group.key" class="story-block">
                <h2>{{ group.title }}</h2>
                <ul class="flex flex-col gap-1 text-[var(--text-sm)]">
                    <li v-for="point in group.points" :key="point.id" class="flex flex-wrap items-baseline gap-x-2" data-testid="time-point">
                        <span class="w-14 shrink-0 text-[var(--text-xs)] text-[var(--text-muted)]">{{ point.part ? PART[point.part] : "" }}{{ point.clock ? ` ${point.clock}` : "" }}</span>
                        <span>{{ point.label }}</span>
                        <span v-if="point.relative" class="text-[var(--text-xs)] text-[var(--text-secondary)]">{{ point.relative }}</span>
                        <span v-if="point.flashback" class="text-[var(--text-xs)] text-[var(--status-warning)]" data-testid="flashback">第 {{ point.flashback }} 章补叙</span>
                        <RefLink v-if="point.refs[0]" class="ml-auto" :ref-text="point.refs[0]" />
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
