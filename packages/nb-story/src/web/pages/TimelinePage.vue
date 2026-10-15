<script setup lang="ts">
/**
 * 时间线（docs/specs/story/viewer.md 输出 14）：默认按故事时间（第几天、时段）分组，可切到按章节；后来补叙的点标
 * “第 N 章补叙”；日子不明的单独一组。每个点下列出这一刻的情节、参与者与地点，点情节跳到情节页的那一段。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import NameLink from "../parts/NameLink.vue";
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
/** 故事里过了几天：日子已知的点里最大的那一天。 */
const days = computed(() => Math.max(0, ...(timeline.data.value?.points ?? []).map(point => point.day ?? 0)));
</script>

<template>
    <div class="story-page story-scroll-y" data-testid="page-timeline">
        <div class="story-page-body">
            <div class="flex flex-wrap items-center gap-2">
                <h1 class="story-page-title mb-0">时间线 <span class="sub">截至{{ book.atLabel.value }}<template v-if="timeline.data.value">，{{ timeline.data.value.points.length }} 个时间点，故事里过了 {{ days }} 天</template></span></h1>
                <SegmentedControl v-model="order" class="ml-auto" size="xs" :options="[{value: 'story', label: '按故事时间'}, {value: 'source', label: '按章节'}]" aria-label="排法" />
            </div>
            <PageState :loading="timeline.loading.value && !timeline.data.value" :error="timeline.error.value?.message ?? null" @retry="timeline.reload()" />
            <section v-for="group in groups" :key="group.key" class="day">
                <h2 class="day-title">{{ group.title }}<small>{{ group.points.length }} 个点</small></h2>
                <ul class="min-w-0 flex-1">
                    <li v-for="point in group.points" :key="point.id" class="point" data-testid="time-point">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <span class="part">{{ point.part ? PART[point.part] : order === "story" ? "时段不明" : "" }}{{ point.clock ? ` ${point.clock}` : "" }}</span>
                            <span class="min-w-0 flex-1">{{ point.label }}</span>
                            <span v-if="point.flashback" class="text-[length:var(--text-xs)] text-[var(--status-warning)]" data-testid="flashback">第 {{ point.flashback }} 章补叙</span>
                            <RefLink v-if="point.refs[0]" :ref-text="point.refs[0]" />
                        </div>
                        <p v-if="point.relative" class="ml-[4.5rem] text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ point.relative }}</p>
                        <ul v-if="point.episodes.length" class="ml-[4.5rem] mt-0.5 flex flex-col gap-0.5" data-testid="time-episodes">
                            <li v-for="episode in point.episodes" :key="episode.id" class="episode">
                                <button type="button" class="text-left text-[var(--accent-text)]" @click="book.jump('episodes', {kind: 'episode', id: episode.id})">{{ episode.title }}</button>
                                <span class="ml-2 inline-flex flex-wrap gap-x-1.5 text-[length:var(--text-xs)]">
                                    <NameLink v-for="who in episode.who" :id="who.id" :key="who.id" :label="who.label" />
                                    <span v-if="episode.place" class="text-[var(--text-muted)]"><span class="i-lucide-map-pin align-[-1px]" /> {{ episode.place.label }}</span>
                                </span>
                            </li>
                        </ul>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>

<style scoped>
.day {
    display: flex;
    gap: 16px;
    padding: 10px 0;
    border-bottom: var(--border-w, 1px) solid var(--divider);
}
.day-title {
    flex-shrink: 0;
    width: 4.5rem;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
}
.day-title small {
    display: block;
    font-size: var(--text-2xs);
    font-weight: normal;
    color: var(--text-muted);
}
.point {
    padding: 3px 0;
    font-size: var(--text-sm);
}
.part {
    flex-shrink: 0;
    width: 4rem;
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.episode {
    font-size: var(--text-xs);
}
</style>
