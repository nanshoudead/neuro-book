<script setup lang="ts">
/**
 * 全书图“按章节”：故事线（docs/specs/story/viewer.md 输出 30），画法沿用 w00024 t01 评审定下的草稿。
 *
 * 横轴是章，一行一个主要人物或事物；点是他参与的一段情节，同一段情节里的几个人用竖线连起来。行与行的顺序由
 * `graph.storyline` 给出（交汇最多的在中间）。位置全由章号和行号算出，不跑力导向。
 *
 * 只在水平方向缩放：Sigma 的镜头只能等比缩放，所以镜头固定不动（关掉镜头的缩放与平移，取景范围固定），由这里维护
 * 正看着的章节范围 `range`，按范围重算横坐标；行名、行距不随缩放变。Ctrl 加滚轮以鼠标所在的章为中心缩放，滚轮与
 * 拖动画布平移，下方的章节条与滑块也能改范围。
 */
import Graph from "graphology";
import Sigma from "sigma";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {IconButton, Slider} from "@notnotype/nb-ui/components";

import type {StoryResult} from "../../contract/contract";
import {useLayoutMotion} from "../host/motion";
import {appearance} from "../host/theme";
import ChapterRange, {type ChapterWindow} from "./ChapterRange.vue";
import {fixedColors, Focus, hoverDrawer, labelDrawer, mix, readTheme} from "./sigma-kit";

/**
 * `range` 由页面持有：换阅读位置时图要重新取数，这个组件会被卸载再挂上，范围放在这里会丢（审查 F07）。null 表示看全部
 * 章节，章数变多时跟着扩到新的全书。
 */
const props = defineProps<{storyline: StoryResult<"graph.storyline">; chapters: number; range?: ChapterWindow | null}>();
const emit = defineEmits<{select: [episode: string]; "update:range": [ChapterWindow | null]}>();

const host = ref<HTMLElement | null>(null);
let sigma: Sigma | null = null;
let graph: Graph | null = null;

/** 图坐标里章节区的宽度；行名区在它左边，宽度按画布像素换算。 */
const W = 1000;
/** 最窄能看几章。 */
const MIN_SPAN = 4;
const full = computed<ChapterWindow>(() => ({start: 0.5, end: props.chapters + 0.5}));
const range = ref<ChapterWindow>(props.range ? clampRange(props.range) : {...full.value});
/** 横向放大倍数（全书章数除以看着的章数），给滑块用。 */
const scale = computed(() => (full.value.end - full.value.start) / (range.value.end - range.value.start));
const maxScale = computed(() => Math.max(1, (full.value.end - full.value.start) / MIN_SPAN));

function clampRange(next: ChapterWindow): ChapterWindow {
    const span = Math.min(Math.max(next.end - next.start, Math.min(MIN_SPAN, full.value.end - full.value.start)), full.value.end - full.value.start);
    const start = Math.min(Math.max(full.value.start, next.start), full.value.end - span);
    return {start, end: start + span};
}
function setRange(next: ChapterWindow): void {
    range.value = clampRange(next);
    const isFull = range.value.start <= full.value.start + 0.01 && range.value.end >= full.value.end - 0.01;
    emit("update:range", isFull ? null : range.value);
}
/** 以某一章（连续坐标）为中心缩放到 span 章宽，这一章在屏幕上的位置不变。 */
function zoomAround(center: number, span: number): void {
    const current = range.value;
    const ratio = (center - current.start) / (current.end - current.start);
    setRange({start: center - ratio * span, end: center - ratio * span + span});
}
function zoomBy(factor: number): void {
    const current = range.value;
    zoomAround((current.start + current.end) / 2, (current.end - current.start) * factor);
}
function setScale(value: number | number[]): void {
    const next = typeof value === "number" ? value : (value[0] ?? 1);
    zoomAround((range.value.start + range.value.end) / 2, (full.value.end - full.value.start) / Math.max(1, next));
}

const toX = (chapter: number) => ((chapter - range.value.start) / (range.value.end - range.value.start)) * W;

/** 每隔几章标一个章号：相邻两个章号至少隔 32 像素（窄屏上也不叠在一起）。 */
function tickStep(pxPerChapterValue: number): number {
    for (const step of [1, 2, 5, 10, 20, 50]) if (step * pxPerChapterValue >= 32) return step;
    return 100;
}

/** 按当前范围摆点：章节区外左边的点藏起来（免得压在行名上），右边的由画布边缘裁掉。 */
function place(): void {
    if (graph === null || sigma === null) return;
    const {start, end} = range.value;
    const step = tickStep(pxPerChapter());
    graph.updateEachNodeAttributes((node, attributes) => {
        const at = attributes.cx as number | undefined;
        if (at === undefined) return attributes;
        if (attributes.kind === "axis") {
            const chapter = Math.round(at);
            const shown = at >= start && at <= end && (chapter === 1 || chapter % step === 0 || chapter === props.chapters);
            return {...attributes, x: toX(at), hidden: !shown};
        }
        return {...attributes, x: toX(at), hidden: at < start - 0.02};
    });
    sigma.refresh();
}

function render(): void {
    if (host.value === null) return;
    sigma?.kill();
    sigma = null;
    const theme = readTheme(host.value);
    const lanes = props.storyline.lanes;
    const row = new Map(lanes.map((lane, index) => [lane.id, index]));
    const box = host.value.getBoundingClientRect();
    // 行名区约 100 像素：按“章节区 W 占画布宽度减去行名区与留白”换算成图坐标。
    const STAGE = 40;
    const labelUnits = (W * 100) / Math.max(200, box.width - 100 - STAGE * 2);
    // Sigma 取景保持横纵比：按画布宽高比算出这张图能有多高，再分给各行与轴标那一行，行距就铺满高度（输出 30）。
    const Y = ((W + labelUnits) * ((box.height - STAGE * 2) / Math.max(1, box.width - STAGE * 2))) / (lanes.length + 1);
    const lanesColors = fixedColors(theme).lanes;
    const color = (index: number) => lanesColors[index % lanesColors.length]!;
    const target = new Graph({type: "undirected", multi: false});
    lanes.forEach((lane, index) => {
        target.addNode(`lane-${lane.id}`, {x: 0, y: -index * Y, size: 0.1, color: theme.bg, label: lane.label, forceLabel: true, labelSide: "left", kind: "lane"});
    });
    for (let chapter = 1; chapter <= props.chapters; chapter += 1) {
        target.addNode(`ch-${chapter}`, {cx: chapter, x: 0, y: Y * 0.9, size: 0.1, color: theme.bg, label: `${chapter}`, forceLabel: true, kind: "axis"});
    }
    // 同一段情节的几个点挨在一起：按情节分组，保持 dots 的先后
    const episodes = new Map<string, {title: string; chapter: number; rows: number[]}>();
    for (const dot of props.storyline.dots) {
        const index = row.get(dot.lane);
        if (index === undefined) continue;
        const episode = episodes.get(dot.episode) ?? {title: dot.title, chapter: dot.chapter, rows: []};
        episode.rows.push(index);
        episodes.set(dot.episode, episode);
    }
    const perChapter = new Map<number, number>();
    const last = new Map<number, string>();
    for (const [id, episode] of episodes) {
        const rows = [...new Set(episode.rows)].sort((a, b) => a - b);
        // 同一章的几段情节在章内错开，按出现先后从左到右
        const slot = perChapter.get(episode.chapter) ?? 0;
        perChapter.set(episode.chapter, slot + 1);
        const cx = episode.chapter - 0.5 + (slot % 4 + 0.5) / 4;
        const ids: string[] = [];
        for (const index of rows) {
            const node = `${id}@${index}`;
            ids.push(node);
            target.addNode(node, {cx, x: 0, y: -index * Y, size: 4, color: color(index), label: "", fullLabel: `第 ${episode.chapter} 章 · ${episode.title}`, episode: id, kind: "dot"});
            const previous = last.get(index);
            if (previous !== undefined) target.addEdge(previous, node, {size: 2.5, color: mix(color(index), theme.bg, 0.6), kind: "lane"});
            last.set(index, node);
        }
        for (let index = 1; index < ids.length; index += 1) {
            target.addEdge(ids[index - 1]!, ids[index]!, {size: 1, color: mix(theme.muted, theme.bg, 0.45), kind: "meet"});
        }
    }
    const focus = new Focus(target, theme);
    // 悬停一个点时，高亮同一段情节在各行上的点和竖线，其余淡掉
    const sameEpisode = (node: string) => focus.hovered !== null && target.getNodeAttribute(node, "episode") !== undefined
        && target.getNodeAttribute(node, "episode") === target.getNodeAttribute(focus.hovered, "episode");
    graph = target;
    const instance = new Sigma(target, host.value, {
        labelFont: theme.font,
        labelSize: 12,
        labelWeight: "600",
        labelColor: {color: theme.text},
        labelRenderedSizeThreshold: 0,
        defaultDrawNodeLabel: labelDrawer(theme) as never,
        defaultDrawNodeHover: hoverDrawer(theme) as never,
        nodeReducer: ((node: string, data: Record<string, unknown>) => {
            if (focus.hovered === null || data.kind === "lane" || data.kind === "axis") return data;
            return sameEpisode(node) ? {...data, size: 6, zIndex: 2} : {...data, color: mix(String(data.color), theme.bg, 0.75), zIndex: 0};
        }) as never,
        edgeReducer: ((edge: string, data: Record<string, unknown>) => {
            if (focus.hovered === null) return data;
            const [source, end] = target.extremities(edge);
            return data.kind === "meet" && sameEpisode(source) && sameEpisode(end) ? {...data, color: theme.text, size: 2, zIndex: 1} : data;
        }) as never,
        zIndex: true,
        stagePadding: STAGE,
        enableCameraZooming: false,
        enableCameraPanning: false,
    });
    // 取景范围固定为“行名区加章节区”：点的横坐标随范围变，Sigma 不再按点重新取景。
    instance.setCustomBBox({x: [-labelUnits, W], y: [-(lanes.length - 1) * Y, Y * 0.9]});
    instance.on("enterNode", ({node}) => {
        if (target.getNodeAttribute(node, "kind") !== "dot") return;
        focus.hovered = node;
        host.value!.style.cursor = "pointer";
        instance.refresh({skipIndexation: true});
    });
    instance.on("leaveNode", () => {
        focus.hovered = null;
        host.value!.style.cursor = "";
        instance.refresh({skipIndexation: true});
    });
    instance.on("clickNode", ({node}) => {
        if (dragged) return;
        const episode = target.getNodeAttribute(node, "episode");
        if (typeof episode === "string") emit("select", episode);
    });
    sigma = instance;
    place();
}

/** 屏幕横坐标对应的章（连续坐标）；章节区外返回 null。 */
function chapterAt(clientX: number): number | null {
    if (sigma === null || host.value === null) return null;
    const rect = host.value.getBoundingClientRect();
    const left = sigma.graphToViewport({x: 0, y: 0}).x;
    const right = sigma.graphToViewport({x: W, y: 0}).x;
    const ratio = (clientX - rect.left - left) / Math.max(1, right - left);
    if (ratio < 0 || ratio > 1) return null;
    return range.value.start + ratio * (range.value.end - range.value.start);
}
function pxPerChapter(): number {
    if (sigma === null) return 1;
    return (sigma.graphToViewport({x: W, y: 0}).x - sigma.graphToViewport({x: 0, y: 0}).x) / (range.value.end - range.value.start);
}
function onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
        const center = chapterAt(event.clientX) ?? (range.value.start + range.value.end) / 2;
        zoomAround(center, (range.value.end - range.value.start) * (event.deltaY > 0 ? 1.2 : 1 / 1.2));
        return;
    }
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) / pxPerChapter();
    setRange({start: range.value.start + delta, end: range.value.end + delta});
}
// 拖动画布平移：按下时记下位置，移动超过几个像素才算拖动，拖完的松手不算点选。
let dragged = false;
function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const origin = event.clientX;
    const initial = {...range.value};
    const perPx = 1 / pxPerChapter();
    dragged = false;
    const onMove = (move: PointerEvent) => {
        const dx = move.clientX - origin;
        if (!dragged && Math.abs(dx) < 4) return;
        dragged = true;
        setRange({start: initial.start - dx * perPx, end: initial.end - dx * perPx});
    };
    const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // click 在 pointerup 之后才派发：等这一轮事件过去再清掉，免得拖完的松手被当成点选。
        setTimeout(() => (dragged = false), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
}

let observer: ResizeObserver | null = null;
let rendered = false;
let resizeFrame: number | null = null;
const layoutMotion = useLayoutMotion();
/** 分栏过渡期间收到的尺寸变化先记下，过渡结束后再重画（见 host/motion.ts）。 */
let resizePending = false;
function redrawForSize(): void {
    if (layoutMotion.value) {
        resizePending = true;
        return;
    }
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        render();
    });
}
watch(layoutMotion, (moving) => {
    if (moving || !resizePending) return;
    resizePending = false;
    redrawForSize();
});
onMounted(() => {
    // 行名区与行距按画布尺寸算，尺寸变了（收起右侧栏、拖分隔条）就整张重画，范围不变；一帧里最多重画一次，
    // 分栏收起、展开的过渡期间不画，结束后画一次。
    observer = new ResizeObserver(([entry]) => {
        if (entry!.contentRect.width === 0 || entry!.contentRect.height === 0) return;
        if (!rendered) {
            rendered = true;
            render();
            return;
        }
        redrawForSize();
    });
    if (host.value !== null) observer.observe(host.value);
});
watch(() => [props.storyline, props.chapters], () => {
    range.value = props.range ? clampRange(props.range) : {...full.value};
    if (rendered) render();
});
watch(range, place, {deep: true});
watch(appearance, () => {
    if (rendered) render();
});
onBeforeUnmount(() => {
    observer?.disconnect();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    sigma?.kill();
});
</script>

<template>
    <div class="story-line" data-testid="storyline">
        <div class="relative min-h-0 flex-1">
            <div ref="host" class="canvas" @wheel="onWheel" @pointerdown="onPointerDown" />
            <div class="zoom">
                <IconButton size="xs" icon-class="i-lucide-plus" aria-label="横向放大" title="横向放大（Ctrl 加滚轮）" @click="zoomBy(1 / 1.5)" />
                <IconButton size="xs" icon-class="i-lucide-minus" aria-label="横向缩小" title="横向缩小" @click="zoomBy(1.5)" />
                <IconButton size="xs" icon-class="i-lucide-maximize" aria-label="看全部章节" title="看全部章节" @click="setRange(full)" />
            </div>
        </div>
        <div class="flex items-center gap-3 px-3 pb-1 pt-1.5">
            <span class="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">横向 {{ scale.toFixed(1) }}×</span>
            <div class="w-28 shrink-0"><Slider :model-value="scale" :min="1" :max="maxScale" :step="0.1" size="sm" aria-label="横向缩放" data-testid="storyline-scale" @update:model-value="setScale" /></div>
            <ChapterRange class="min-w-0 flex-1" :range="range" :chapters="chapters" :min-span="MIN_SPAN" @update:range="setRange" />
        </div>
    </div>
</template>

<style scoped>
.story-line { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; user-select: none; }
.canvas { position: absolute; inset: 0; }
.zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 2px; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); }
</style>
