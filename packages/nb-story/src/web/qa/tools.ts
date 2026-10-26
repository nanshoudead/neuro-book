/**
 * 问答 Agent 的工具在对话视图里的登记（docs/specs/story/viewer.md 的问答页）。查询都归 `explore`：一轮里连着的查询
 * 收成一行，短语按这一组的调用写；`answer` 是结果节点，画成答案卡片。参数名与 `src/qa/tools.ts` 登记的工具一致。
 *
 * 读原文超出章数上限时工具照常返回“没有读：……”（qa.md 输出 5），这一行写“已到章数上限，没读”，不算失败。
 *
 * 答案卡片组件由问答页传进来：这个文件保持纯 TS，单测不用编译 .vue。
 */

import {argNumber, argString, type AgentViewContribution, type ToolCallView, type ToolRendererEntry, type ViewText} from "@notnotype/nb-agent-ui";
import type {Component} from "vue";

function position(value: unknown): string {
    if (typeof value !== "object" || value === null) return "";
    const {chapter, paragraph} = value as {chapter?: unknown; paragraph?: unknown};
    if (typeof chapter !== "number") return "";
    return typeof paragraph === "number" ? `${chapter}.${paragraph}` : `第 ${chapter} 章`;
}

/** 读原文被章数上限挡下（工具结果以“没有读：”开头）。 */
export function readRefused(call: ToolCallView): boolean {
    return call.status === "success" && (call.result?.text.startsWith("没有读：") ?? false);
}

function readSummary(call: ToolCallView): string {
    const args = (call.args ?? {}) as {from?: unknown; to?: unknown};
    const from = position(args.from);
    const to = position(args.to);
    const range = to === "" ? from : `${from}—${to}`;
    return readRefused(call) ? `${range}：已到章数上限，没读` : range;
}

/** 这一组读到的章：连续的写成“33–37”，“读了第 33–37 章”。被上限挡下的不算。 */
export function chaptersPhrase(calls: readonly ToolCallView[]): string {
    const chapters = new Set<number>();
    for (const call of calls) {
        if (call.status !== "success" || readRefused(call)) continue;
        const args = (call.args ?? {}) as {from?: {chapter?: unknown}; to?: {chapter?: unknown}};
        const from = args.from?.chapter;
        const to = args.to?.chapter ?? from;
        if (typeof from !== "number" || typeof to !== "number") continue;
        for (let chapter = Math.min(from, to); chapter <= Math.max(from, to); chapter += 1) chapters.add(chapter);
    }
    if (chapters.size === 0) return calls.length > 0 ? `读了 ${calls.length} 次原文` : "";
    const sorted = [...chapters].sort((a, b) => a - b);
    const runs: string[] = [];
    let start = sorted[0]!;
    let end = start;
    for (const chapter of [...sorted.slice(1), Number.NaN]) {
        if (chapter === end + 1) {
            end = chapter;
            continue;
        }
        runs.push(start === end ? `${start}` : `${start}–${end}`);
        start = chapter;
        end = chapter;
    }
    return `读了第 ${runs.join("、")} 章`;
}

const entity = (call: ToolCallView) => argString(call, "entity");

type Query = {names: string[]; label: string; icon: string; summary: (call: ToolCallView) => string; phrase: (calls: readonly ToolCallView[]) => ViewText};
const QUERIES: Query[] = [
    {names: ["read"], label: "读原文", icon: "i-lucide-book-open", summary: readSummary, phrase: chaptersPhrase},
    {names: ["para"], label: "这一段的记录", icon: "i-lucide-pilcrow", summary: call => `${argNumber(call, "chapter") ?? "?"}.${argNumber(call, "paragraph") ?? "?"}`, phrase: calls => `查了 ${calls.length} 段的记录`},
    {names: ["chapter"], label: "这一章的变化", icon: "i-lucide-bookmark", summary: call => `第 ${argNumber(call, "chapter") ?? "?"} 章`, phrase: calls => `看了 ${calls.length} 章的变化`},
    {names: ["info"], label: "书的信息与目录", icon: "i-lucide-info", summary: () => "目录", phrase: () => "看了目录"},
    {
        names: ["arcs", "episodes", "timeline", "questions"],
        label: "情节与主线",
        icon: "i-lucide-list-tree",
        summary: call => [({arcs: "主线", episodes: "情节", timeline: "时间线", questions: "悬念"} as Record<string, string>)[call.name] ?? call.name, argString(call, "query")].filter(Boolean).join("："),
        phrase: calls => `查了 ${calls.length} 次情节`,
    },
    {
        names: ["find", "card", "knowledge", "statements", "appearances", "ties"],
        label: "人物",
        icon: "i-lucide-user-round",
        summary: call => {
            const what = ({find: "找", card: "人物卡", knowledge: "知道的事", statements: "说法", appearances: "出场", ties: "关系"} as Record<string, string>)[call.name] ?? call.name;
            return `${what}：${call.name === "find" ? argString(call, "query") : entity(call)}`;
        },
        phrase: calls => `查了 ${calls.length} 次人物`,
    },
    {
        names: ["between", "relations", "knows"],
        label: "关系与秘密",
        icon: "i-lucide-users",
        summary: call => (call.name === "between" ? `${entity(call)} × ${argString(call, "other")}` : call.name === "knows" ? "谁知道什么" : "关系总表"),
        phrase: calls => `查了 ${calls.length} 次关系与秘密`,
    },
    {names: ["ledger", "track"], label: "数值", icon: "i-lucide-coins", summary: call => argString(call, "track") || "数值总表", phrase: calls => `查了 ${calls.length} 次数值`},
    {names: ["search"], label: "搜索", icon: "i-lucide-search", summary: call => argString(call, "query"), phrase: calls => `搜了 ${calls.length} 次`},
];

/** 交卷被退回时过程里那一行写原因（结果工具出错不画节点）。 */
function answerSummary(call: ToolCallView): string {
    if (call.status === "error" || call.status === "invalid") return `退回：${(call.error ?? call.result?.text ?? "").split("\n")[0]}`;
    return argString(call, "conclusion");
}

export function storyToolsContribution(answerCard: Component): AgentViewContribution {
    const tools: ToolRendererEntry[] = [
        ...QUERIES.map(
            (query): ToolRendererEntry => ({
                id: `nb-story.${query.names[0]}`,
                toolNames: query.names,
                category: "explore",
                icon: query.icon,
                label: query.label,
                summary: query.summary,
                groupPhrase: query.phrase,
                presentation: "line",
            }),
        ),
        {id: "nb-story.answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text", label: "交卷", summary: answerSummary, presentation: "node", node: answerCard, outcome: true},
    ];
    return {source: "nb-story:qa", tools};
}
