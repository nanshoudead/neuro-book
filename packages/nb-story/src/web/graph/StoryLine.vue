<script setup lang="ts">
/**
 * 全书图“按章节”：故事线（docs/specs/story/viewer.md 输出 30），画法沿用 w00024 t01 评审定下的草稿。
 *
 * 横轴是章，一行一个主要人物或事物；点是他参与的一段情节，同一段情节里的几个人用竖线连起来。行与行的顺序由
 * `graph.storyline` 给出（交汇最多的在中间）。位置全由章号和行号算出，不跑力导向。
 */
import Graph from "graphology";
import Sigma from "sigma";
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import {IconButton} from "@notnotype/nb-ui/components";

import type {StoryResult} from "../../contract/contract";
import {Focus, hoverDrawer, labelDrawer, mix, readTheme, zoom} from "./sigma-kit";

const props = defineProps<{storyline: StoryResult<"graph.storyline">; chapters: number}>();
const emit = defineEmits<{select: [episode: string]}>();

const host = ref<HTMLElement | null>(null);
let sigma: Sigma | null = null;

const X = 10;
const LANE_COLORS = ["#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#65a30d", "#92400e"];

function render(): void {
    if (host.value === null) return;
    sigma?.kill();
    sigma = null;
    const theme = readTheme(host.value);
    const lanes = props.storyline.lanes;
    const row = new Map(lanes.map((lane, index) => [lane.id, index]));
    // 行距按画布比例算：Sigma 取景保持横纵比，行距太小整张图只占中间一窄条（输出 30：行距铺满高度）
    const box = host.value.getBoundingClientRect();
    const Y = Math.max(14, Math.min(40, (props.chapters * X) * (box.height / Math.max(1, box.width)) / (lanes.length + 1)));
    const color = (index: number) => LANE_COLORS[index % LANE_COLORS.length]!;
    const graph = new Graph({type: "undirected", multi: false});
    lanes.forEach((lane, index) => {
        graph.addNode(`lane-${lane.id}`, {x: 0, y: -index * Y, size: 0.1, color: theme.bg, label: lane.label, forceLabel: true, labelSide: "left", kind: "lane"});
    });
    // 行名画在点的左边，Sigma 取景只看点不看标签：左边放一个看不见的点，把行名的位置也算进取景
    graph.addNode("pad-left", {x: -7 * X, y: 0, size: 0.1, color: theme.bg, label: "", kind: "axis"});
    for (let chapter = 1; chapter <= props.chapters; chapter += 1) {
        if (chapter !== 1 && chapter % 5 !== 0 && chapter !== props.chapters) continue;
        graph.addNode(`ch-${chapter}`, {x: chapter * X, y: Y * 0.9, size: 0.1, color: theme.bg, label: `${chapter}`, forceLabel: true, kind: "axis"});
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
        const x = episode.chapter * X - X / 2 + (slot % 4 + 0.5) * (X / 4);
        const ids: string[] = [];
        for (const index of rows) {
            const node = `${id}@${index}`;
            ids.push(node);
            graph.addNode(node, {x, y: -index * Y, size: 4, color: color(index), label: "", fullLabel: `第 ${episode.chapter} 章 · ${episode.title}`, episode: id, kind: "dot"});
            const previous = last.get(index);
            if (previous !== undefined) graph.addEdge(previous, node, {size: 2.5, color: mix(color(index), theme.bg, 0.6), kind: "lane"});
            last.set(index, node);
        }
        for (let index = 1; index < ids.length; index += 1) {
            graph.addEdge(ids[index - 1]!, ids[index]!, {size: 1, color: mix(theme.muted, theme.bg, 0.45), kind: "meet"});
        }
    }
    const focus = new Focus(graph, theme);
    // 悬停一个点时，高亮同一段情节在各行上的点和竖线，其余淡掉
    const sameEpisode = (node: string) => focus.hovered !== null && graph.getNodeAttribute(node, "episode") !== undefined
        && graph.getNodeAttribute(node, "episode") === graph.getNodeAttribute(focus.hovered, "episode");
    const instance = new Sigma(graph, host.value, {
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
            const [source, target] = graph.extremities(edge);
            return data.kind === "meet" && sameEpisode(source) && sameEpisode(target) ? {...data, color: theme.text, size: 2, zIndex: 1} : data;
        }) as never,
        zIndex: true,
        stagePadding: 40,
        minCameraRatio: 0.1,
        maxCameraRatio: 2,
    });
    instance.on("enterNode", ({node}) => {
        if (graph.getNodeAttribute(node, "kind") !== "dot") return;
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
        const episode = graph.getNodeAttribute(node, "episode");
        if (typeof episode === "string") emit("select", episode);
    });
    sigma = instance;
}

let observer: ResizeObserver | null = null;
let rendered = false;
onMounted(() => {
    // 第一次有尺寸时排版；之后尺寸变了（收起右侧栏、拖分隔条）Sigma 不会自己发现，要 resize 再重画
    observer = new ResizeObserver(([entry]) => {
        if (entry!.contentRect.width === 0 || entry!.contentRect.height === 0) return;
        if (rendered) {
            sigma?.resize();
            sigma?.refresh();
            return;
        }
        rendered = true;
        render();
    });
    if (host.value !== null) observer.observe(host.value);
});
watch(() => [props.storyline, props.chapters], () => {
    if (rendered) render();
});
onBeforeUnmount(() => {
    observer?.disconnect();
    sigma?.kill();
});
</script>

<template>
    <div class="story-line" data-testid="storyline">
        <div ref="host" class="canvas" />
        <div class="zoom">
            <IconButton size="xs" icon-class="i-lucide-plus" aria-label="放大" @click="zoom(sigma, 'in')" />
            <IconButton size="xs" icon-class="i-lucide-minus" aria-label="缩小" @click="zoom(sigma, 'out')" />
            <IconButton size="xs" icon-class="i-lucide-maximize" aria-label="铺满" @click="zoom(sigma, 'fit')" />
        </div>
    </div>
</template>

<style scoped>
.story-line { position: relative; width: 100%; height: 100%; }
.canvas { position: absolute; inset: 0; }
.zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 2px; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); }
</style>
