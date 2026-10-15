<script setup lang="ts">
/**
 * 查看器的网络图（docs/specs/story/viewer.md 输出 22 到 29、31），画法与交互沿用 w00024 t01 评审定下的草稿。
 *
 * 三种用法共用这一个组件：
 * - relation：关系图。点与线来自 `graph.relations`，类别筛选由宿主在取数时做。
 * - data：全书图“按关联”。对象、主线（或逐段情节）、秘密、悬念，来自 `graph.book`。
 * - ego：人物卡里的小图（relation 加 `ego`）。只画关系最多的十来个，放射排布。
 *
 * 画法：点一样大、线一样粗，多少写在线上的字里，不靠粗细；一对点之间的几种联系（关系说法、同场、认知）
 * 合并成一条直线，颜色按最要紧的一种，认知用箭头标方向（两边都知道就是双向箭头）。点画成类型色的空心圆圈，
 * 选中时圈加粗、填上淡色、外面一圈光晕（参照 viewer-v7）。
 */
import {createNodeBorderProgram} from "@sigma/node-border";
import {fitViewportToNodes} from "@sigma/utils";
import Graph from "graphology";
import Sigma from "sigma";
import {EdgeArrowProgram, EdgeDoubleArrowProgram} from "sigma/rendering";
import {animateNodes} from "sigma/utils";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {IconButton} from "@notnotype/nb-ui/components";

import {edgeLabelDrawer, estimateLabelWidth, Focus, hoverDrawer, labelDrawer, layoutCircle, layoutConcentric, layoutForce, mix, readTheme, seedSpiral, zoom} from "./sigma-kit";
import type {Theme} from "./sigma-kit";

import type {IdentityState} from "../../contract/contract";

/** 点：`kind` 是对象类别，或全书图里的 arc、episode、secret、question。 */
export type NetworkNode = {id: string; label: string; kind: string; weight: number};
/** 关系图的线：一对点一条，几种联系合在一起（RelationEdge 的形状）。 */
export type NetworkEdge = {a: string; b: string; word: string | null; statements: number; together: number; ab: number; ba: number; identity: IdentityState | null};
/** 全书图的线。 */
export type DataEdge = {a: string; b: string; type: "participates" | "about" | "link" | "relation"; count: number};
export type GraphLayout = "force" | "concentric" | "circle";

const props = withDefaults(defineProps<{
    nodes: NetworkNode[];
    mode: "relation" | "data";
    /** relation 的线。 */
    edges?: NetworkEdge[];
    /** data 的线。 */
    dataEdges?: DataEdge[];
    /** relation：画哪几层连线（relation、co、know）。 */
    layers?: string[];
    /** relation：排版方式。 */
    layout?: GraphLayout;
    /** 点了“重新排版”就加一，组件按当前方式从头排一次。 */
    relayoutKey?: number;
    /** 只画这个点和关系最多的邻居（人物卡里的小图）。 */
    ego?: string | null;
    selected?: string | null;
    /** 选中一个点后只显示它和它的邻居。 */
    neighborhood?: boolean;
    /** data：不画的类型。 */
    hiddenTypes?: string[];
    minCo?: number;
    compact?: boolean;
    /** 在图里找：命中的点高亮，镜头移到第一个。 */
    query?: string;
    /** 一定出标签、名字加粗的点（主要人物）。 */
    pinned?: string[];
}>(), {
    edges: () => [], dataEdges: () => [], layers: () => ["relation", "co"], layout: "force", relayoutKey: 0, ego: null, selected: null, neighborhood: false,
    hiddenTypes: () => [], minCo: 2, compact: false, query: "", pinned: () => [],
});

const emit = defineEmits<{(event: "select", id: string): void}>();

const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
let sigma: Sigma | null = null;
let graph: Graph | null = null;
let focus: Focus | null = null;
let theme: Theme | null = null;
let stopAnimation: (() => void) | null = null;
const EGO_LIMIT = 12;
const KNOW_COLOR = "#b35375";
const NODE_SIZE = 8;
const EDGE_SIZE = 2;

function kindColor(kind: string): string {
    const t = theme!;
    const palette: Record<string, string> = {
        person: t.accent, persona: t.accent, group: t.success, item: t.warning, place: "#0d9488", task: "#8b5cf6",
        concept: t.muted, other: t.muted, episode: "#94a3b8", arc: "#475569", secret: t.danger, question: t.warning,
    };
    return palette[kind] ?? t.muted;
}

function edgeWeight(edge: NetworkEdge): number {
    return edge.statements * 3 + edge.together;
}

function addNode(target: Graph, id: string, attributes: Record<string, unknown>): void {
    target.addNode(id, {size: props.compact ? 5.5 : NODE_SIZE, ...attributes, fillColor: theme!.surface, ringPx: 2, bold: props.pinned.includes(id)});
}

/** 关系图里要画的点（不含线）。线在 `fillRelationEdges` 里另加，切换连线的层时只换线、点留在原处。 */
function relationNodes(): NetworkNode[] {
    let nodes = props.nodes;
    if (props.ego !== null) {
        const ids = new Set(nodes.map((node) => node.id));
        const ranked = props.edges.filter((edge) => (edge.a === props.ego || edge.b === props.ego) && ids.has(edge.a) && ids.has(edge.b) && edge.identity === null)
            .sort((a, b) => edgeWeight(b) - edgeWeight(a) || (a.a + a.b < b.a + b.b ? -1 : 1)).slice(0, EGO_LIMIT);
        const keep = new Set([props.ego, ...ranked.map((edge) => edge.a === props.ego ? edge.b : edge.a)]);
        nodes = nodes.filter((node) => keep.has(node.id));
    }
    return nodes;
}

/** 身份线上的字（输出 28）。 */
const IDENTITY_LABEL: Record<IdentityState, string> = {
    uncertain: "可能是同一人", unaware: "其实是同一人（不知道）", heard: "其实是同一人（听说）", believes: "其实是同一人（认为）",
    suspects: "其实是同一人（怀疑）", "no-record": "可能知道（没有记录）",
};

/**
 * 一对点之间的几种联系合并成一条线（输出 22）。颜色按最要紧的一种：关系说法（蓝）、认知（粉）、同场（灰）；
 * 认知用箭头标方向：只有 A 知道关于 B 的事是 A→B，两边都知道是双向箭头。线上的字把几种都写上，平时只写关系词。
 */
function fillRelationEdges(target: Graph): void {
    const t = theme!;
    const layers = new Set(props.layers);
    target.clearEdges();
    const nameOf = (node: string) => String(target.getNodeAttribute(node, "label"));
    for (const edge of props.edges) {
        if (!target.hasNode(edge.a) || !target.hasNode(edge.b) || edge.a === edge.b) continue;
        const aside = props.ego !== null && edge.a !== props.ego && edge.b !== props.ego;
        if (edge.identity !== null) {
            if (aside) continue;
            // 身份线单独一种样式：读者视角下不确定、角色视角下他不知道的“其实是同一人”用提醒色；没有记录的用灰色
            const color = edge.identity === "no-record" ? t.muted : t.warning;
            const label = IDENTITY_LABEL[edge.identity];
            target.addUndirectedEdgeWithKey(`same:${edge.a}|${edge.b}`, edge.a, edge.b, {
                size: EDGE_SIZE, color: mix(color, t.bg, 0.35), focusColor: color, type: "line", label, shortLabel: label, alwaysLabel: true, weight: 4,
            });
            continue;
        }
        const relation = layers.has("relation") && edge.statements > 0;
        const co = layers.has("co") && edge.together >= props.minCo;
        const ab = layers.has("know") && props.ego === null ? edge.ab : 0;
        const ba = layers.has("know") && props.ego === null ? edge.ba : 0;
        if (!relation && !co && ab === 0 && ba === 0) continue;
        const knows = ab > 0 || ba > 0;
        const color = relation ? t.accent : knows ? KNOW_COLOR : t.muted;
        const word = relation ? (edge.word ?? "") : "";
        const parts = [
            relation ? (word ? `${word}（说法 ${edge.statements}）` : `说法 ${edge.statements}`) : "",
            co ? `同场 ${edge.together}` : "",
            ab > 0 ? `${nameOf(edge.a)}知道关于${nameOf(edge.b)}的 ${ab} 条` : "",
            ba > 0 ? `${nameOf(edge.b)}知道关于${nameOf(edge.a)}的 ${ba} 条` : "",
        ].filter(Boolean);
        const attributes = {
            size: aside ? 0.8 : EDGE_SIZE,
            color: aside ? mix(t.muted, t.bg, 0.7) : mix(color, t.bg, 0.3),
            focusColor: color,
            // 人物卡小图地方小，线上只写关系词
            label: aside ? "" : props.compact ? word : parts.join(" · "),
            shortLabel: word,
            alwaysLabel: !aside && Boolean(word),
            weight: Math.max(1, (relation ? edge.statements * 3 : 0) + (co ? edge.together : 0) + (knows ? Math.log2(1 + ab + ba) : 0)),
            type: aside ? "line" : knows ? (ab > 0 && ba > 0 ? "doubleArrow" : "arrow") : "line",
        };
        // 单向的认知箭头从知道的人指向被知道的人
        if (knows && !(ab > 0 && ba > 0) && ba > 0) target.addDirectedEdgeWithKey(`p:${edge.b}>${edge.a}`, edge.b, edge.a, attributes);
        else if (knows && !(ab > 0 && ba > 0)) target.addDirectedEdgeWithKey(`p:${edge.a}>${edge.b}`, edge.a, edge.b, attributes);
        else target.addUndirectedEdgeWithKey(`p:${edge.a}|${edge.b}`, edge.a, edge.b, attributes);
    }
}

function buildRelation(target: Graph): void {
    for (const node of relationNodes()) {
        addNode(target, node.id, {label: node.label, color: kindColor(node.kind), forceLabel: true, weight: node.weight});
    }
    fillRelationEdges(target);
    // 没有任何线连着的点不画（人物卡小图里的中心点除外）
    for (const node of target.nodes()) if (target.degree(node) === 0 && node !== props.ego) target.dropNode(node);
}

/** 全书图：对象、主线（或情节）、秘密、悬念。情节、主线标题很长，图上只显示前 12 个字，悬停显示全文。 */
function buildData(target: Graph): void {
    const t = theme!;
    const hidden = new Set(props.hiddenTypes);
    const nodes = props.nodes.filter((node) => !hidden.has(node.kind));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = props.dataEdges.filter((edge) => ids.has(edge.a) && ids.has(edge.b));
    const linked = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
    for (const node of nodes) {
        if (!linked.has(node.id)) continue;
        const short = node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label;
        addNode(target, node.id, {
            label: short, fullLabel: node.label, size: node.kind === "episode" ? 4 : 6,
            color: kindColor(node.kind),
            // 点一样大以后，标签格子按 weight 挑谁出名字：出场多的先出
            forceLabel: props.pinned.includes(node.id), weight: node.weight,
        });
    }
    // 线用先和背景色混好的不透明色：半透明的线在 WebGL 里混色会发青，叠多了也会越叠越深
    const EDGE: Record<string, string> = {participates: mix(t.muted, t.bg, 0.72), link: mix("#64748b", t.bg, 0.55), about: mix(t.danger, t.bg, 0.65), relation: mix(t.accent, t.bg, 0.5)};
    for (const edge of edges) {
        if (!target.hasNode(edge.a) || !target.hasNode(edge.b) || edge.a === edge.b) continue;
        const key = `${edge.type}:${edge.a}|${edge.b}`;
        if (target.hasEdge(key)) continue;
        target.addUndirectedEdgeWithKey(key, edge.a, edge.b, {
            weight: edge.count * (edge.type === "relation" ? 3 : edge.type === "link" ? 2 : 1),
            size: 1,
            color: EDGE[edge.type] ?? mix(t.muted, t.bg, 0.72),
            focusColor: edge.type === "relation" ? t.accent : t.muted,
            label: edge.type === "participates" && edge.count > 1 ? `${edge.count} 段` : "",
            type: "line",
        });
    }
}

/** 人物卡小图：中心是这个人，邻居按关系多少顺时针排一圈；左半边的点标签画在左边。 */
function layoutEgo(target: Graph): void {
    const center = props.ego!;
    target.mergeNodeAttributes(center, {x: 0, y: 0});
    const weightTo = (node: string) => Math.max(0, ...target.edges(center, node).map((edge) => Number(target.getEdgeAttribute(edge, "weight"))));
    const others = target.neighbors(center).sort((a, b) => weightTo(b) - weightTo(a));
    // Sigma 的 y 轴朝上：从正上方开始顺时针排，关系最多的在 12 点钟方向
    others.forEach((node, index) => {
        const angle = Math.PI / 2 - index * 2 * Math.PI / others.length;
        // 竖向的椭圆：标签横着排，环的上下两端最挤，纵向多拉开一些
        target.mergeNodeAttributes(node, {x: Math.cos(angle) * 9, y: Math.sin(angle) * 13, labelSide: Math.cos(angle) < -0.15 ? "left" : "right"});
    });
    // Sigma 取景只看点不看标签：左右各放一个看不见的点，给两侧朝外的标签留出地方
    for (const side of [-1, 1]) target.addNode(`pad-${side}`, {x: side * 15.5, y: 0, size: 0.01, color: theme!.bg, fillColor: theme!.bg, ringPx: 0, label: "", weight: 0});
}

/** 按当前排版方式给点算位置。`fresh` 为真时从固定的螺旋起点排，否则从现在的位置接着排（切换连线的层时，点只挪需要挪的）。 */
function applyLayout(target: Graph, fresh: boolean): void {
    if (props.ego !== null && target.hasNode(props.ego)) {
        layoutEgo(target);
        return;
    }
    target.updateEachNodeAttributes((_, attributes) => ({...attributes, labelSide: "right"}));
    if (props.mode === "relation" && props.layout === "concentric") {
        const center = focus?.selected !== null && focus?.selected !== undefined && target.hasNode(focus.selected) ? focus.selected
            : target.nodes().sort((a, b) => target.degree(b) - target.degree(a))[0];
        if (center !== undefined) layoutConcentric(target, center);
        return;
    }
    if (props.mode === "relation" && props.layout === "circle") {
        const KIND: Record<string, string> = {persona: "person", other: "concept"};
        const kinds = new Map(props.nodes.map((item) => [item.id, item.kind]));
        layoutCircle(target, (node) => {
            const kind = kinds.get(node) ?? "other";
            return KIND[kind] ?? kind;
        });
        return;
    }
    if (fresh || target.someNode((_, attributes) => attributes.x === undefined)) seedSpiral(target, (node) => Number(target.getNodeAttribute(node, "weight")));
    layoutForce(target, {
        viewportWidth: host.value?.clientWidth ?? 800, linLog: false, iterations: props.mode === "data" ? 600 : fresh ? 300 : 150,
        labelWidth: (node) => estimateLabelWidth(String(target.getNodeAttribute(node, "label")), props.compact ? 11 : 12),
    });
}

/** 重新排版：在一份拷贝上算出新位置，再让点从旧位置滑过去，看得出谁挪到了哪里。 */
function relayout(fresh: boolean): void {
    if (sigma === null || graph === null) return;
    const copy = graph.copy();
    applyLayout(copy, fresh);
    const targets: Record<string, {x: number; y: number}> = {};
    copy.forEachNode((node, attributes) => { targets[node] = {x: Number(attributes.x), y: Number(attributes.y)}; });
    stopAnimation?.();
    // 拖动时固定过的取景范围要放开，否则新位置跑到框外
    sigma.setCustomBBox(null);
    stopAnimation = animateNodes(graph, targets, {duration: 600, easing: "quadraticInOut"}, () => {
        void sigma?.getCamera().animatedReset({duration: 300});
    });
}

function render(): void {
    if (host.value === null) return;
    stopAnimation?.();
    sigma?.kill();
    theme = readTheme(host.value);
    graph = new Graph({type: "mixed", multi: true});
    if (props.mode === "data") buildData(graph);
    else buildRelation(graph);
    focus = new Focus(graph, theme);
    focus.selected = props.selected !== null && graph.hasNode(props.selected) ? props.selected : null;
    focus.onlyNeighborhood = props.neighborhood;
    applyLayout(graph, true);
    const drawLabel = labelDrawer(theme);
    const drawHover = hoverDrawer(theme);
    const drawEdgeLabel = edgeLabelDrawer(theme);
    sigma = new Sigma(graph, host.value, {
        renderEdgeLabels: true,
        defaultNodeType: "ring",
        nodeProgramClasses: {
            // 类型色的空心圆圈：外圈 2 像素的类型色，里面填面板底色；选中时外圈加粗、里面填淡的类型色
            ring: createNodeBorderProgram({
                borders: [
                    {size: {attribute: "ringPx", defaultValue: 2, mode: "pixels"}, color: {attribute: "color"}},
                    {size: {fill: true}, color: {attribute: "fillColor"}},
                ],
                drawLabel: drawLabel as never,
                drawHover: drawHover as never,
            }),
        },
        edgeProgramClasses: {arrow: EdgeArrowProgram, doubleArrow: EdgeDoubleArrowProgram},
        labelFont: theme.font,
        labelSize: props.compact ? 11 : 12,
        labelWeight: "500",
        labelColor: {color: theme.text},
        edgeLabelFont: theme.font,
        edgeLabelSize: 11,
        edgeLabelColor: {color: theme.muted},
        // 标签按格子去重：同一格只画 weight 最大的点的标签，放大后格子里的点变少，标签逐级出来
        labelDensity: props.mode === "data" ? 0.5 : 1,
        labelGridCellSize: props.mode === "data" ? 110 : 70,
        labelRenderedSizeThreshold: 0,
        defaultDrawNodeLabel: drawLabel as never,
        defaultDrawNodeHover: drawHover as never,
        defaultDrawEdgeLabel: drawEdgeLabel as never,
        nodeReducer: focus.node as never,
        edgeReducer: ((edge: string, data: Record<string, unknown>) => {
            const result = focus!.edge(edge, data);
            // 平时线上只写关系词；悬停、选中时写全（几种联系都列出）
            if (result.forceLabel !== true && !result.hidden && result.alwaysLabel === true) result.label = data.shortLabel;
            return result;
        }) as never,
        zIndex: true,
        // 取景只看点不看名字：留足边距，环形排版左右两侧朝外的名字才不会被裁掉
        stagePadding: props.compact ? 36 : 90,
        minCameraRatio: 0.06,
        maxCameraRatio: 3,
    });
    // 线上的字互相避让：每画一帧前清空已占的位置
    sigma.on("beforeRender", drawEdgeLabel.reset);
    bindEvents(sigma, graph);
    applyQuery();
    if (props.neighborhood) fitNeighborhood();
}

/**
 * 悬停、点选与拖动。按下一个点时先记下它，鼠标移动超过几个像素才算拖动：拖动结束不算点选，免得拖完就打开人物卡。
 * 拖动时固定取景范围（custom bbox），否则 Sigma 每帧按新的外框重新取景，整张图会跟着跑。
 */
function bindEvents(instance: Sigma, target: Graph): void {
    let dragged: string | null = null;
    let moved = false;
    let downAt: {x: number; y: number} | null = null;
    instance.on("enterNode", ({node}) => {
        if (dragged !== null) return;
        focus!.hovered = node;
        host.value!.style.cursor = "grab";
        instance.refresh({skipIndexation: true});
    });
    instance.on("leaveNode", () => {
        if (dragged !== null) return;
        focus!.hovered = null;
        host.value!.style.cursor = "";
        instance.refresh({skipIndexation: true});
    });
    instance.on("downNode", ({node, event}) => {
        dragged = node;
        moved = false;
        downAt = {x: event.x, y: event.y};
        stopAnimation?.();
        if (instance.getCustomBBox() === null) instance.setCustomBBox(instance.getBBox());
    });
    const captor = instance.getMouseCaptor();
    captor.on("mousemovebody", (event) => {
        if (dragged === null || downAt === null) return;
        if (!moved && Math.hypot(event.x - downAt.x, event.y - downAt.y) < 4) return;
        moved = true;
        host.value!.style.cursor = "grabbing";
        const position = instance.viewportToGraph(event);
        target.mergeNodeAttributes(dragged, {x: position.x, y: position.y});
        event.preventSigmaDefault();
        event.original.preventDefault();
        event.original.stopPropagation();
    });
    captor.on("mouseup", () => {
        if (dragged !== null && moved) host.value!.style.cursor = "grab";
        dragged = null;
        downAt = null;
    });
    instance.on("clickNode", ({node}) => {
        if (moved) {
            moved = false;
            return;
        }
        focus!.selected = node;
        instance.refresh({skipIndexation: true});
        if (props.neighborhood) fitNeighborhood();
        if (props.layout === "concentric") relayout(false);
        emit("select", node);
    });
    instance.on("clickStage", () => {
        focus!.selected = null;
        instance.refresh({skipIndexation: true});
    });
}

/** “只看选中的周边”：镜头框住选中的点和它的邻居。 */
function fitNeighborhood(): void {
    if (sigma === null || focus === null || focus.selected === null || graph === null) return;
    if (!graph.hasNode(focus.selected)) return;
    void fitViewportToNodes(sigma, [focus.selected, ...graph.neighbors(focus.selected)], {animate: true});
}

/** 搜索：按名字（情节按标题）包含匹配；命中的点高亮，镜头移到第一个命中的点。 */
function applyQuery(): void {
    if (sigma === null || focus === null || graph === null) return;
    const query = props.query.trim();
    focus.matches = query === "" ? null : new Set(graph.filterNodes((_, attributes) => String(attributes.fullLabel ?? attributes.label).includes(query)));
    sigma.refresh({skipIndexation: true});
    const first = focus.matches?.values().next().value;
    if (first !== undefined) {
        const position = sigma.getNodeDisplayData(first);
        if (position !== undefined) void sigma.getCamera().animate({x: position.x, y: position.y, ratio: 0.45}, {duration: 400});
    }
}

function toggleFullscreen(): void {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void root.value?.requestFullscreen();
}

const themeReady = ref(0);
const legend = computed(() => {
    if (themeReady.value === 0 || theme === null) return [];
    if (props.mode === "data") {
        return [{label: "人物", color: kindColor("person")}, {label: "组织", color: kindColor("group")}, {label: "物品", color: kindColor("item")},
            {label: "主线", color: kindColor("arc")}, {label: "情节", color: kindColor("episode")}, {label: "秘密", color: kindColor("secret")},
            {label: "悬念", color: kindColor("question")}]
            .filter((item) => !(item.label === "悬念" && props.hiddenTypes.includes("question")));
    }
    const KIND: Record<string, string> = {person: "人物", group: "组织", item: "物品", place: "地点", task: "任务", concept: "概念"};
    const present = new Set(props.nodes.map((node) => node.kind === "persona" ? "person" : node.kind));
    return Object.entries(KIND).filter(([kind]) => present.has(kind)).map(([kind, label]) => ({label, color: kindColor(kind)}));
});

let observer: ResizeObserver | null = null;
let lastSize = "";
onMounted(() => {
    // 容器在 Splitter 量好尺寸之前是 0：有了尺寸才排版。之后尺寸变了（收起、展开右侧栏，拖分隔条，全屏）
    // Sigma 不会自己发现，要调 resize 重设画布大小再重画（输出 27）
    observer = new ResizeObserver(([entry]) => {
        const size = `${Math.round(entry!.contentRect.width)}x${Math.round(entry!.contentRect.height)}`;
        if (size === lastSize || entry!.contentRect.width === 0 || entry!.contentRect.height === 0) return;
        const first = lastSize === "";
        lastSize = size;
        if (first) {
            render();
            themeReady.value += 1;
        } else {
            sigma?.resize();
            sigma?.refresh();
        }
    });
    if (host.value !== null) observer.observe(host.value);
});
// 点与线的数据变了（换阅读位置、视角、类别）整张重画，由排版重新决定位置；只换连线的层或同场门槛时换线、重新排版，
// 点从原位置滑到新位置（输出 24）
watch(() => [props.ego, props.hiddenTypes.join(","), props.mode, props.nodes, props.edges, props.dataEdges],
    () => { if (lastSize !== "") render(); });
watch(() => [props.layers.join(","), props.minCo], () => {
    if (sigma === null || graph === null || props.mode !== "relation") return;
    fillRelationEdges(graph);
    sigma.refresh();
    relayout(false);
});
watch(() => props.layout, () => relayout(true));
watch(() => props.relayoutKey, () => relayout(true));
watch(() => props.selected, (value) => {
    if (sigma === null || focus === null || graph === null) return;
    focus.selected = value !== null && graph.hasNode(value) ? value : null;
    sigma.refresh({skipIndexation: true});
    if (props.neighborhood) fitNeighborhood();
});
watch(() => props.neighborhood, (value) => {
    if (sigma === null || focus === null) return;
    focus.onlyNeighborhood = value;
    sigma.refresh({skipIndexation: true});
    if (value) fitNeighborhood();
    else void sigma.getCamera().animatedReset({duration: 300});
});
watch(() => props.query, applyQuery);
onBeforeUnmount(() => { observer?.disconnect(); stopAnimation?.(); sigma?.kill(); });
</script>

<template>
    <div ref="root" class="story-graph">
        <div ref="host" class="canvas" />
        <div v-if="!compact && themeReady > 0" class="legend">
            <span v-for="item in legend" :key="item.label"><i :style="{borderColor: item.color}" />{{ item.label }}</span>
            <template v-if="mode === 'relation'">
                <span v-if="layers.includes('relation')"><b class="line rel" />关系说法</span>
                <span v-if="layers.includes('co')"><b class="line co" />只有同场</span>
                <span v-if="layers.includes('know')"><b class="line know" />只有认知（箭头：谁知道关于谁的事）</span>
            </template>
        </div>
        <div v-if="!compact" class="zoom">
            <IconButton size="xs" icon-class="i-lucide-plus" aria-label="放大" @click="zoom(sigma, 'in')" />
            <IconButton size="xs" icon-class="i-lucide-minus" aria-label="缩小" @click="zoom(sigma, 'out')" />
            <IconButton size="xs" icon-class="i-lucide-scan" aria-label="铺满" @click="zoom(sigma, 'fit')" />
            <IconButton size="xs" icon-class="i-lucide-maximize" aria-label="全屏" @click="toggleFullscreen" />
        </div>
    </div>
</template>

<style scoped>
.story-graph { position: relative; width: 100%; height: 100%; background: var(--panel-surface); }
.canvas { position: absolute; inset: 0; }
.legend { position: absolute; left: 10px; bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 3px 8px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); color: var(--text-secondary); font-size: var(--text-2xs); pointer-events: none; }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.legend i { width: 9px; height: 9px; border: 2px solid; border-radius: 50%; }
.legend .line { display: inline-block; width: 18px; height: 0; border-top: 2px solid; }
.legend .line.rel { border-color: var(--accent-main); }
.legend .line.co { border-color: var(--text-muted); }
.legend .line.know { border-color: #b35375; }
.zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 2px; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--panel-surface) 88%, transparent); }
</style>
