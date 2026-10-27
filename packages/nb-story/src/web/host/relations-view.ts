/**
 * 关系图页上的控件选择（docs/specs/story/viewer.md 输出 22）：存进浏览器偏好，刷新、换书后保持。读出来逐项校验，
 * 不认识的值回到缺省（偏好可能是旧版本写的，或被手改过）。
 */

import type {GraphLayout} from "../graph/StoryNetwork.vue";
import {readJsonPref, writeJsonPref} from "./prefs";

export interface RelationsView {
    kindIds: string[];
    layers: string[];
    minTogether: number;
    layout: GraphLayout;
    neighborhood: boolean;
    showAnonymous: boolean;
}

const KIND_IDS = ["person", "group", "item", "place", "concept", "task"];
const LAYER_IDS = ["relation", "co", "know"];
const LAYOUTS: readonly GraphLayout[] = ["force", "concentric", "circle"];
const KEY = "relations-view";

export const DEFAULT_RELATIONS_VIEW: RelationsView = {kindIds: ["person", "group"], layers: ["relation", "co"], minTogether: 2, layout: "force", neighborhood: false, showAnonymous: false};

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
    };
}

export function writeRelationsView(view: RelationsView): void {
    writeJsonPref(KEY, view);
}
