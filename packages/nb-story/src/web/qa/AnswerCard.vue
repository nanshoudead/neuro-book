<script setup lang="ts">
// 答案卡片（w00024 t13 决定 8、15、16）：常显结论类型、结论、“谁知道什么”的表或分点、一行依据；说明、覆盖范围与
// 全部依据收在“详细”里。出处与人名发 reference.open，由问答页交给查看器的抽屉。说明见同名 .md。
import {computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import {argArray, argString, type HostComponentEmits, type ToolComponentProps} from "@notnotype/nb-agent-ui";

import {QA_NAME_LOOKUP} from "./names";
import {refSegments, visibleRefCount, type RefSegment} from "./ref-line";
import {refTarget} from "./link-refs";

const props = defineProps<ToolComponentProps>();
const emit = defineEmits<HostComponentEmits>();

type Knowledge = {who: string; state: string; how: string; refs: string[]};
type Point = {text: string; refs: string[]};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const conclusion = computed(() => argString(props.call, "conclusion"));
const conclusionType = computed(() => argString(props.call, "conclusionType"));
// 流式时参数可能是半截：缺字段的行照样画，字段按空处理。
const knowledge = computed<Knowledge[]>(() =>
    argArray(props.call, "knowledge").flatMap(row => {
        if (typeof row !== "object" || row === null || Array.isArray(row)) return [];
        const value = row as Record<string, unknown>;
        return [{who: typeof value.who === "string" ? value.who : "", state: typeof value.state === "string" ? value.state : "", how: typeof value.how === "string" ? value.how : "", refs: strings(value.refs)}];
    }),
);
const points = computed<Point[]>(() =>
    argArray(props.call, "points").flatMap(point => {
        if (typeof point !== "object" || point === null || Array.isArray(point)) return [];
        const value = point as Record<string, unknown>;
        return [{text: typeof value.text === "string" ? value.text : "", refs: strings(value.refs)}];
    }),
);
const evidence = computed(() => strings(argArray(props.call, "evidence")));
const explanation = computed(() => argString(props.call, "explanation"));
const coverage = computed(() => argString(props.call, "coverage"));
const detailed = ref(false);

const STATE_TONE: Record<string, string> = {"知道": "is-yes", "怀疑": "is-maybe", "不知道": "is-no", "原文没有表明": "is-unknown"};
const TYPE_TONE: Record<string, string> = {"明说": "is-yes", "推断": "is-maybe", "解读": "is-reading", "无法确定": "is-unknown"};

function openRef(refText: string): void {
    emit("action", {type: "reference.open", target: refTarget(refText)});
}

// 人名：问答页按名字查到唯一的对象才做成链接（决定 16）；查之前与查不到都是纯文字。
const lookup = inject(QA_NAME_LOOKUP, null);
const people = shallowRef<ReadonlyMap<string, string>>(new Map());
watch(
    () => knowledge.value.map(row => row.who),
    async (names, _old, onCleanup) => {
        let stale = false;
        onCleanup(() => (stale = true));
        if (lookup === null) return;
        const found = await Promise.all(names.map(async name => [name, await lookup(name)] as const));
        if (!stale) people.value = new Map(found.filter((pair): pair is readonly [string, string] => pair[1] !== null));
    },
    {immediate: true},
);
function openPerson(id: string): void {
    emit("action", {type: "reference.open", target: `entity://${id}`});
}

const segments = (text: string): RefSegment[] => refSegments(text);

// 依据一行：量出放得下几个出处，其余收成“等 N 处”（宽度变了才重算，点击不改变个数）。
const line = ref<HTMLElement | null>(null);
const measure = ref<HTMLElement | null>(null);
const shown = ref(Number.POSITIVE_INFINITY);
let observer: ResizeObserver | null = null;
function layout(): void {
    const box = line.value;
    const ruler = measure.value;
    if (box === null || ruler === null) return;
    const chips = [...ruler.querySelectorAll<HTMLElement>("[data-ref-chip]")];
    const more = ruler.querySelector<HTMLElement>("[data-ref-more]");
    const gap = 4;
    shown.value = visibleRefCount({widths: chips.map(chip => chip.offsetWidth + gap), available: box.clientWidth, moreWidth: (more?.offsetWidth ?? 48) + gap});
}
onMounted(() => {
    observer = new ResizeObserver(layout);
    if (line.value !== null) observer.observe(line.value);
    layout();
});
onBeforeUnmount(() => observer?.disconnect());
watch(evidence, () => requestAnimationFrame(layout));
const hidden = computed(() => Math.max(0, evidence.value.length - shown.value));
</script>

<template>
    <div class="answer-card" data-qa-answer>
        <div class="answer-head">
            <span v-if="conclusionType" class="answer-badge" :class="TYPE_TONE[conclusionType]">{{ conclusionType }}</span>
            <p class="answer-conclusion">
                <template v-for="(part, index) in segments(conclusion)" :key="index">
                    <button v-if="part.ref" type="button" class="answer-ref" @click="openRef(part.ref)">{{ part.text }}</button>
                    <template v-else>{{ part.text }}</template>
                </template>
            </p>
        </div>

        <table v-if="knowledge.length > 0" class="answer-table">
            <thead>
                <tr><th>谁</th><th>知道吗</th><th>怎么知道的</th><th>出处</th></tr>
            </thead>
            <tbody>
                <tr v-for="(row, index) in knowledge" :key="index">
                    <td>
                        <button v-if="people.get(row.who)" type="button" class="answer-person" @click="openPerson(people.get(row.who)!)">{{ row.who }}</button>
                        <span v-else>{{ row.who }}</span>
                    </td>
                    <td><span v-if="row.state" class="answer-badge" :class="STATE_TONE[row.state]">{{ row.state }}</span></td>
                    <td class="answer-how">{{ row.how }}</td>
                    <td class="answer-row-refs">
                        <button v-for="refText in row.refs" :key="refText" type="button" class="answer-ref" @click="openRef(refText)">{{ refText }}</button>
                        <span v-if="row.refs.length === 0" class="answer-muted">—</span>
                    </td>
                </tr>
            </tbody>
        </table>
        <ol v-else-if="points.length > 0" class="answer-points">
            <li v-for="(point, index) in points" :key="index">
                <template v-for="(part, partIndex) in segments(point.text)" :key="partIndex">
                    <button v-if="part.ref" type="button" class="answer-ref" @click="openRef(part.ref)">{{ part.text }}</button>
                    <template v-else>{{ part.text }}</template>
                </template>
                <button v-for="refText in point.refs" :key="refText" type="button" class="answer-ref" @click="openRef(refText)">{{ refText }}</button>
            </li>
        </ol>

        <div class="answer-foot">
            <span class="answer-muted shrink-0">依据</span>
            <span ref="line" class="answer-line">
                <button v-for="refText in evidence.slice(0, shown)" :key="refText" type="button" class="answer-ref" @click="openRef(refText)">{{ refText }}</button>
                <button v-if="hidden > 0" type="button" class="answer-more-refs" @click="detailed = true">等 {{ hidden }} 处</button>
                <span v-if="evidence.length === 0" class="answer-muted">没有</span>
            </span>
            <button type="button" class="answer-toggle" :aria-expanded="detailed" @click="detailed = !detailed">
                详细<span :class="detailed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
            </button>
            <!-- 量宽度用：与上面同样的小块，不显示、不占位。 -->
            <span ref="measure" class="answer-ruler" aria-hidden="true">
                <span v-for="refText in evidence" :key="refText" class="answer-ref" data-ref-chip>{{ refText }}</span>
                <span class="answer-more-refs" data-ref-more>等 {{ evidence.length }} 处</span>
            </span>
        </div>
        <div v-if="detailed" class="answer-detail">
            <p>
                <template v-for="(part, index) in segments(explanation)" :key="index">
                    <button v-if="part.ref" type="button" class="answer-ref" @click="openRef(part.ref)">{{ part.text }}</button>
                    <template v-else>{{ part.text }}</template>
                </template>
            </p>
            <p class="answer-muted"><span class="answer-label">覆盖范围</span>{{ coverage }}</p>
            <p v-if="evidence.length > 0" class="answer-all-refs">
                <span class="answer-label">全部依据</span>
                <button v-for="refText in evidence" :key="refText" type="button" class="answer-ref" @click="openRef(refText)">{{ refText }}</button>
            </p>
        </div>
    </div>
</template>

<style scoped>
.answer-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    padding: 12px 14px;
    font-size: var(--text-sm);
    line-height: 1.65;
}
.answer-head { display: flex; gap: 8px; align-items: flex-start; }
.answer-conclusion { margin: 0; color: var(--text-main); }
.answer-badge {
    flex-shrink: 0;
    border-radius: var(--radius-control);
    padding: 0 6px;
    font-size: var(--text-2xs);
    line-height: 20px;
    white-space: nowrap;
    background: var(--bg-subtle);
    color: var(--text-secondary);
}
.answer-head .answer-badge { margin-top: 2px; }
.is-yes { background: var(--status-success-bg); color: var(--status-success); }
.is-maybe { background: var(--status-warning-bg); color: var(--status-warning); }
.is-reading { color: var(--accent-text); }
.is-unknown { background: transparent; box-shadow: inset 0 0 0 1px var(--border-color); color: var(--text-muted); }
.answer-table { width: 100%; border-collapse: collapse; }
.answer-table th { text-align: left; font-weight: var(--weight-strong); color: var(--text-muted); font-size: var(--text-xs); padding: 4px 8px 4px 0; border-bottom: 1px solid var(--divider); }
.answer-table td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--divider); vertical-align: top; }
.answer-table tr:last-child td { border-bottom: 0; }
.answer-how { color: var(--text-secondary); }
.answer-row-refs { white-space: nowrap; }
.answer-points { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-main); }
.answer-foot { position: relative; display: flex; align-items: baseline; gap: 6px; font-size: var(--text-xs); }
.answer-line { display: flex; flex: 1 1 0; min-width: 0; gap: 4px; overflow: hidden; white-space: nowrap; }
.answer-ruler { position: absolute; visibility: hidden; pointer-events: none; display: flex; gap: 4px; white-space: nowrap; left: 0; top: 0; }
.answer-ref, .answer-person, .answer-more-refs { border-radius: var(--radius-control); padding: 0 3px; color: var(--accent-text); white-space: nowrap; }
.answer-person { padding: 0; }
.answer-more-refs { color: var(--text-secondary); min-width: 4.5em; text-align: left; }
.answer-ref:hover, .answer-person:hover, .answer-more-refs:hover { background: var(--bg-hover); }
.answer-toggle { display: inline-flex; flex-shrink: 0; align-items: center; gap: 2px; color: var(--text-secondary); }
.answer-toggle:hover { color: var(--text-main); }
.answer-muted { color: var(--text-muted); }
.answer-label { font-weight: var(--weight-strong); margin-right: 8px; }
.answer-detail { border-top: 1px solid var(--divider); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; color: var(--text-main); }
.answer-detail p { margin: 0; }
.answer-all-refs { display: flex; flex-wrap: wrap; gap: 2px 4px; font-size: var(--text-xs); }
</style>
