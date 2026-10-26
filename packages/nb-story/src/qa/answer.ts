/**
 * 作答工具 `answer` 的校验（docs/specs/story/qa.md 输出 8）：全部问题一次列出，Agent 照着改了再交。
 */

import {Compile} from "typebox/compile";

import {refsInText} from "../contract/refs";
import {AnswerSchema, type Answer} from "../core/qa-records";
import type {ReadLedger} from "./read-ledger";

const checkAnswer = Compile(AnswerSchema);

export type AnswerCheck = {ok: true; answer: Answer} | {ok: false; problems: string[]};

export function validateAnswer(args: unknown, ledger: ReadLedger): AnswerCheck {
    if (!checkAnswer.Check(args)) {
        const problems = [...checkAnswer.Errors(args)].slice(0, 5).map(item => `参数 ${item.instancePath || "/"} ${item.message}`);
        return {ok: false, problems};
    }
    const answer = args;
    const problems: string[] = [];
    if (answer.conclusion.trim() === "") problems.push("conclusion 不能为空");

    // 结构化的出处，与各段文字里写成出处形状的内容，都按同一个账本查。
    const structured: [string, string][] = [
        ...answer.evidence.map((ref): [string, string] => ["evidence", ref]),
        ...(answer.knowledge ?? []).flatMap((row, index) => row.refs.map((ref): [string, string] => [`knowledge[${index}].refs`, ref])),
        ...(answer.points ?? []).flatMap((point, index) => point.refs.map((ref): [string, string] => [`points[${index}].refs`, ref])),
    ];
    const texts: [string, string][] = [
        ["conclusion", answer.conclusion],
        ["explanation", answer.explanation],
        ["coverage", answer.coverage],
        ...(answer.knowledge ?? []).map((row, index): [string, string] => [`knowledge[${index}].how`, row.how]),
        ...(answer.points ?? []).map((point, index): [string, string] => [`points[${index}].text`, point.text]),
    ];
    const seen = new Set<string>();
    for (const [field, ref] of structured) {
        const problem = ledger.checkRef(ref);
        if (problem && !seen.has(`${field}\u0000${ref}`)) problems.push(`${field}：${problem}`);
        seen.add(`${field}\u0000${ref}`);
    }
    for (const [field, text] of texts) {
        for (const ref of refsInText(text)) {
            const problem = ledger.checkRef(ref);
            if (problem && !seen.has(`${field}\u0000${ref}`)) problems.push(`${field} 正文里的 ${ref}：${problem}（如果它不是出处，请改写这个数字）`);
            seen.add(`${field}\u0000${ref}`);
        }
    }

    (answer.knowledge ?? []).forEach((row, index) => {
        if ((row.state === "知道" || row.state === "怀疑") && row.refs.length === 0) problems.push(`knowledge[${index}]（${row.who}，${row.state}）没有出处：写出他怎么知道的那一段`);
    });
    if (answer.conclusionType !== "无法确定" && answer.evidence.length === 0) problems.push(`结论类型是“${answer.conclusionType}”，evidence 至少要有一个出处；确实找不到依据时结论类型写“无法确定”`);

    return problems.length === 0 ? {ok: true, answer} : {ok: false, problems};
}
