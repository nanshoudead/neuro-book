/**
 * 插件页要的“本位置的问题”（docs/specs/runtime/plugin-install.md 的插件页）：从内核目录里只取这个运行位置的入口，合并插件
 * 顶层与入口下的贡献，丢掉声明、实现与作用域，得到可以跨进程传的纯 JSON。内核目录本身带实现对象与别处的入口，不直接交给
 * 界面。
 */

import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionState, PluginCatalog} from "@notnotype/nb-runtime/plugins";

import type {PluginProblem} from "./types";

const KIND_ORDER: Readonly<Record<PluginProblem["kind"], number>> = {"entry-failed": 0, "entry-blocked": 1, "contribution-rejected": 2, "catalog-unavailable": 3};

function rejected(plugin: string, location: RuntimeLocation, contribution: ContributionState): PluginProblem | null {
    if (contribution.validation.status !== "rejected") return null;
    return {kind: "contribution-rejected", plugin, entry: contribution.entry, location, capability: contribution.capability, id: contribution.id, reason: contribution.validation.reason, detail: contribution.validation.detail};
}

/**
 * 这个运行位置上各插件的问题：入口激活失败与受阻、被拒的贡献；按插件、种类、入口、贡献点与 id 排好。消息目录的问题不在内核的插件
 * 目录里，由窗口另外并入，同样按 `comparePluginProblems` 排。
 */
export function pluginProblems(catalog: PluginCatalog, location: RuntimeLocation): PluginProblem[] {
    const problems: PluginProblem[] = [];
    for (const plugin of catalog.plugins) {
        for (const contribution of plugin.contributions) {
            const problem = rejected(plugin.id, location, contribution);
            if (problem !== null) problems.push(problem);
        }
        for (const entry of plugin.entries) {
            if (entry.location !== location) continue;
            const {state} = entry;
            if (state.status === "failed" && state.failure !== null) {
                problems.push({kind: "entry-failed", plugin: plugin.id, entry: entry.entry, location, stage: state.failure.stage, reason: state.failure.reason, message: state.failure.error?.message ?? null});
            } else if (state.status === "blocked" && state.blocked !== null) {
                problems.push({kind: "entry-blocked", plugin: plugin.id, entry: entry.entry, location, reason: state.blocked.reason, key: state.blocked.key});
            }
            for (const contribution of entry.contributions) {
                const problem = rejected(plugin.id, location, contribution);
                if (problem !== null) problems.push(problem);
            }
        }
    }
    return problems.sort(comparePluginProblems);
}

function sortKey(problem: PluginProblem): string {
    const position = problem.kind === "catalog-unavailable" ? problem.locale : (problem.entry ?? "");
    return [problem.plugin, String(KIND_ORDER[problem.kind]), position, problem.kind === "contribution-rejected" ? `${problem.capability}\u0000${problem.id}` : ""].join("\u0001");
}

/** 问题的排列顺序：插件、种类、入口（目录问题是语言）、贡献点与 id。 */
export function comparePluginProblems(a: PluginProblem, b: PluginProblem): number {
    const left = sortKey(a);
    const right = sortKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
}
