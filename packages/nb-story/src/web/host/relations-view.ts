/**
 * 关系图页上的控件选择（docs/specs/story/viewer.md 输出 22）：存进浏览器偏好，刷新、换书后保持。读出来逐项校验，
 * 不认识的值回到缺省（偏好可能是旧版本写的，或被手改过）。
 */

import {partsStrength, edgeParts, hasParts, type EdgeFacts} from "../graph/edge-parts";
import type {GraphLayout} from "../graph/StoryNetwork.vue";
import {readJsonPref, writeJsonPref} from "./prefs";

export interface RelationsView {
    kindIds: string[];
    layers: string[];
    minTogether: number;
    layout: GraphLayout;
    neighborhood: boolean;
    showAnonymous: boolean;
    /** 只画最强的线：每个点只留它最强的几条线（`strongestEdges`），默认不开。 */
    strongOnly: boolean;
}

const KIND_IDS = ["person", "group", "item", "place", "concept", "task"];
const LAYER_IDS = ["relation", "co", "know"];
const LAYOUTS: readonly GraphLayout[] = ["force", "concentric", "circle", "stress"];
const KEY = "relations-view";

export const DEFAULT_RELATIONS_VIEW: RelationsView = {kindIds: ["person", "group"], layers: ["relation", "co"], minTogether: 2, layout: "force", neighborhood: false, showAnonymous: false, strongOnly: false};

const pick = (value: unknown, allowed: readonly string[], fallback: string[]): string[] =>
    Array.isArray(value) && value.every(item => typeof item === "string" && allowed.includes(item)) ? [...(value as string[])] : [...fallback];

export function readRelationsView(): RelationsView {
    const raw = readJsonPref(KEY);
    const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = DEFAULT_RELATIONS_VIEW;
    return {
        kindIds: pick(value.kindIds, KIND_IDS, d.kindIds),
        layers: pick(value.layers, LAYER_IDS, d.layers),
        minTogether: typeof value.minTogether === "number" && Number.isInteger(value.minTogether) && value.minTogether >= 1 && value.minTogether <= 8 ? value.minTogether : d.minTogether,
        layout: LAYOUTS.includes(value.layout as GraphLayout) ? (value.layout as GraphLayout) : d.layout,
        neighborhood: typeof value.neighborhood === "boolean" ? value.neighborhood : d.neighborhood,
        showAnonymous: typeof value.showAnonymous === "boolean" ? value.showAnonymous : d.showAnonymous,
        strongOnly: typeof value.strongOnly === "boolean" ? value.strongOnly : d.strongOnly,
    };
}

export function writeRelationsView(view: RelationsView): void {
    writeJsonPref(KEY, view);
}

/** 每个点保留的最强的线条数（`strongestEdges`）。 */
export const STRONG_PER_NODE = 3;

/**
 * 只留最强的线：先按当前连线层与同场门槛决定每条线画出哪些联系（`edgeParts`，画布用的同一条规则），没有可画联系的线不参与；
 * 再在画出来的线里，一条线只要是它某一端的点最强的 `STRONG_PER_NODE` 条之一就留，所以没有点因此变成孤点。强度是画出来的
 * 联系的条数之和；同样强的按原来的顺序取。身份线（“其实是同一人”）单独画、不参与排名，原样保留。
 */
export function strongestEdges<T extends EdgeFacts & {a: string; b: string}>(edges: readonly T[], options: {layers: readonly string[]; minCo: number; knowsAllowed: boolean}): T[] {
    const parts = edges.map(edge => (edge.identity === null ? edgeParts(edge, options.layers, options.minCo, options.knowsAllowed) : null));
    const strength = (index: number) => partsStrength(edges[index]!, parts[index]!);
    const byNode = new Map<string, number[]>();
    edges.forEach((edge, index) => {
        const part = parts[index];
        if (part === null || !hasParts(part)) return;
        for (const node of [edge.a, edge.b]) byNode.set(node, [...(byNode.get(node) ?? []), index]);
    });
    const keep = new Set<number>();
    for (const indexes of byNode.values()) {
        const ranked = [...indexes].sort((x, y) => strength(y) - strength(x) || x - y);
        for (const index of ranked.slice(0, STRONG_PER_NODE)) keep.add(index);
    }
    return edges.filter((edge, index) => edge.identity !== null || keep.has(index));
}
