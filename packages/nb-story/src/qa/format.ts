/**
 * 问答结果给人读的格式（docs/specs/story/qa.md 输出 12、16）：`nbstory ask` 与 `nbstory qa <id>` 共用。出处一律
 * “章.段”。
 */

import type {Answer, QaRecord} from "../core/qa-records";

function refs(list: readonly string[]): string {
    return list.length > 0 ? `〔${list.join("，")}〕` : "";
}

/**
 * 答案正文：结论、结论类型、表或分点、展开说明与覆盖说明。不含用量、记录 id 这类运行信息；回归送判时也用它，
 * 判分器只看到作答内容。
 */
export function answerText(answer: Answer): string {
    const lines = [`结论（${answer.conclusionType}）：${answer.conclusion}`];
    if (answer.knowledge && answer.knowledge.length > 0) {
        lines.push("", "| 谁 | 知道吗 | 怎么知道的 | 依据 |", "|---|---|---|---|");
        for (const row of answer.knowledge) lines.push(`| ${row.who} | ${row.state} | ${row.how} | ${row.refs.join("，")} |`);
    }
    if (answer.points && answer.points.length > 0) {
        lines.push("");
        for (const point of answer.points) lines.push(`- ${point.text} ${refs(point.refs)}`.trimEnd());
    }
    lines.push("", `说明：${answer.explanation}`, "", `依据：${answer.evidence.join("，") || "无"}`, `覆盖：${answer.coverage}`);
    return lines.join("\n");
}

const STATUS_WORDS = {answered: "已答", failed: "失败", interrupted: "中断"} as const;

function usageText(record: QaRecord): string {
    const {usage} = record;
    const tokens = `输入 ${usage.input}（缓存读 ${usage.cacheRead}、写 ${usage.cacheWrite}）、输出 ${usage.output} token`;
    const cost = usage.cost === null ? "费用未知（没有配置单价）" : `费用 ${usage.cost.toFixed(4)}`;
    return `${tokens}；${cost}${usage.complete ? "" : "（不完整，只是下界）"}`;
}

/** 一条记录的完整显示。 */
export function recordText(record: QaRecord): string {
    const head = [`问题：${record.question}`, `阅读位置 ${record.at.chapter}.${record.at.paragraph}，${record.mode === "graph" ? "图当目录" : "全读"}，${STATUS_WORDS[record.status]}`];
    const body = record.answer
        ? [answerText(record.answer)]
        : record.error
          ? [`失败（${record.error.code}${record.error.kind ? `，${record.error.kind}` : ""}）：${record.error.message}`]
          : ["已中断，没有答案"];
    const tail = [
        `读过的章：${record.chaptersRead.join("、") || "无"}；作答被退回 ${record.rejections} 次`,
        `用量：${usageText(record)}`,
        `用时 ${(record.ms / 1000).toFixed(1)} 秒；模型 ${record.model}；记录 ${record.id}`,
    ];
    return [...head, "", ...body, "", ...tail].join("\n");
}

/** 列表里的一行。 */
export function recordLine(record: QaRecord): string {
    return `${record.id}  ${record.startedAt.slice(0, 16).replace("T", " ")}  ${STATUS_WORDS[record.status]}  @${record.at.chapter}.${record.at.paragraph}  ${record.question}`;
}
