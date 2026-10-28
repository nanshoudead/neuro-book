/**
 * t34 的评分（plan.md 的“评分”与“第 3 版的改动”）：只读冻结的 evidences/gold.json 与 .local 的 runs/，不做人工判定。
 *
 *   bun score.ts            Markdown 打到标准输出
 *
 * 每次回答按它的答案与所在章归类（答案各带 certainFrom、candidateFrom）：
 * - correct：答对且 certain，章不早于该答案的 certainFrom；not-persona 用例答 not-persona 也算；
 * - cautious：答对但写 candidate，章不早于 certainFrom（对，但没给确定）；
 * - guess-ok：答对、写 candidate，章在 candidateFrom 与 certainFrom 之间（有根据的猜）；
 * - premature-certain：答对但写 certain，章早于 certainFrom（提前确定）；
 * - premature-guess：答对、写 candidate，章早于 candidateFrom（提前猜）；
 * - wrong：答 same 但对象不在允许答案里，或在不该答 not-persona 的用例答 not-persona；
 * - unknown：答 unknown。
 */

import {join} from "node:path";

import {readRecord, yuan, type CallRecord} from "../../t33-graph-issue-reports/scripts/shared";
import {GOLD, type Case} from "./cases";
import {RUNS, schedule} from "./probe";

type Label = "correct" | "cautious" | "guess-ok" | "premature-certain" | "premature-guess" | "wrong" | "unknown" | "failed";

interface Reply {verdict?: string; entity?: string | null; certainty?: string}

export function classify(item: Case, chapter: number, reply: Reply | null): Label {
    if (!reply) return "failed";
    if (reply.verdict === "unknown") return "unknown";
    const target = reply.verdict === "not-persona" ? "not-persona" : reply.entity ?? "";
    const answer = item.answers.find(candidate => candidate.entity === target);
    if (!answer) return "wrong";
    if (target === "not-persona") return chapter >= answer.certainFrom ? "correct" : "premature-certain";
    if (reply.certainty === "certain") return chapter >= answer.certainFrom ? "correct" : "premature-certain";
    if (chapter >= answer.certainFrom) return "cautious";
    return chapter >= answer.candidateFrom ? "guess-ok" : "premature-guess";
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");

async function main() {
    const cases = (await Bun.file(GOLD).json()) as Case[];
    const runs = [1, 2];
    const rows: {item: Case; run: number; chapter: number; label: Label; record: CallRecord | null; reply: Reply | null}[] = [];
    for (const run of runs) for (const item of cases) for (const chapter of schedule(item)) {
        const record = await readRecord(join(RUNS, String(run), `${item.id}-ch${chapter}.json`));
        const reply = record?.outcome === "ok" ? (record.json as Reply) : null;
        rows.push({item, run, chapter, label: record ? classify(item, chapter, reply) : "failed", record, reply});
    }
    const out: string[] = [];
    const count = (list: typeof rows, label: Label) => list.filter(row => row.label === label).length;
    const missing = rows.filter(row => !row.record).length;
    const cost = rows.reduce((sum, row) => sum + (row.record?.attempts ?? []).reduce((acc, attempt) => acc + yuan(attempt.usage), 0), 0);
    out.push(`请求 ${rows.length}（两遍），没有记录 ${missing}，失败 ${count(rows, "failed") - missing}；费用 ¥${cost.toFixed(2)}（下界，deepseek-flash 低谷价），每次约 ¥${(cost / Math.max(1, rows.length - missing)).toFixed(4)}。`);

    // Q1 与 Q2：遮掉与真实漏连的用例，揭示后与揭示前分开。
    const linkable = rows.filter(row => row.item.kind === "masked" || row.item.kind === "real");
    const after = linkable.filter(row => row.chapter >= row.item.reveal!);
    const before = linkable.filter(row => row.chapter < row.item.reveal!);
    out.push("", "## 揭示后（问题 1）", "", "| 分层 | 次数 | 答对且确定 | 答对但写候选 | 答错 | 不知道 | 失败 |", "|---|---|---|---|---|---|---|");
    for (const stratum of ["explicit", "label", "inferred"] as const) {
        const list = after.filter(row => row.item.stratum === stratum);
        out.push(`| ${stratum} | ${list.length} | ${count(list, "correct")} | ${count(list, "cautious")} | ${count(list, "wrong")} | ${count(list, "unknown")} | ${count(list, "failed")} |`);
    }
    out.push("", "每个用例揭示后第几次问到时答对（certain 或 candidate 都算；- 表示揭示后的几次都没答对）：", "", "| 用例 | 分层 | 揭示章 | 第 1 遍 | 第 2 遍 | 揭示后问的章 |", "|---|---|---|---|---|---|");
    for (const item of cases.filter(item => item.kind === "masked" || item.kind === "real")) {
        const first = (run: number) => {
            const list = after.filter(row => row.item.id === item.id && row.run === run);
            const index = list.findIndex(row => row.label === "correct" || row.label === "cautious");
            return index < 0 ? "-" : `${index + 1}（第 ${list[index]!.chapter} 章${list[index]!.label === "cautious" ? "，候选" : ""}）`;
        };
        out.push(`| ${item.id} | ${item.stratum} | ${item.reveal}${item.revealTriggered === false ? "（漏触发）" : ""} | ${first(1)} | ${first(2)} | ${schedule(item).filter(chapter => chapter >= item.reveal!).join("、") || "无"} |`);
    }
    out.push("", "## 揭示前（问题 2）", "", `揭示前共问 ${before.length} 次：提前确定 ${count(before, "premature-certain")}，提前猜 ${count(before, "premature-guess")}，有根据的猜 ${count(before, "guess-ok")}，答错 ${count(before, "wrong")}，不知道 ${count(before, "unknown")}，失败 ${count(before, "failed")}。`);
    for (const row of before.filter(row => ["premature-certain", "premature-guess", "wrong"].includes(row.label))) out.push(`- 第 ${row.run} 遍 ${row.item.id} 第 ${row.chapter} 章（揭示 ${row.item.reveal}）：${row.label}，答 ${row.reply?.verdict} ${row.reply?.entity ?? ""} ${row.reply?.certainty ?? ""}｜${row.reply && "reason" in row.reply ? String((row.reply as {reason?: string}).reason) : ""}`);

    // Q3：不是马甲与一直没揭示。
    out.push("", "## 不是马甲与一直没揭示（问题 3）", "", "| 用例 | 次数 | 答对 | 答错 | 不知道 | 失败 | 答错时答的 |", "|---|---|---|---|---|---|---|");
    for (const item of cases.filter(item => item.kind === "not-persona" || item.kind === "never")) {
        const list = rows.filter(row => row.item.id === item.id);
        const wrong = list.filter(row => row.label === "wrong" || row.label === "premature-certain" || row.label === "premature-guess");
        out.push(`| ${item.id}（${item.kind}） | ${list.length} | ${count(list, "correct")} | ${wrong.length} | ${count(list, "unknown")} | ${count(list, "failed")} | ${[...new Set(wrong.map(row => `${row.reply?.verdict}:${row.reply?.entity ?? ""}:${row.reply?.certainty ?? ""}`))].join("、")} |`);
    }

    // Q4：触发量（不封顶的全部触发章，按书平均到每章）与“答出就停”的回放。
    out.push("", "## 触发与费用（问题 4）", "");
    for (const book of ["witch", "sample"] as const) {
        const list = cases.filter(item => item.book === book);
        const chapters = book === "witch" ? 30 : 100;
        const total = list.reduce((sum, item) => sum + item.triggers.length, 0);
        out.push(`- ${book}：${list.length} 个马甲用例，按触发规则不封顶共 ${total} 次，平均每章 ${(total / chapters).toFixed(1)} 次`);
    }
    out.push("", "“答出就停”回放（产品策略：第一次答 same 或 not-persona 就写下或进待确认，之后不再问）：", "", "| 遍 | 用例 | 停在 | 那一次的归类 | 停之前问了几次 |", "|---|---|---|---|---|");
    const replay: Record<string, number> = {};
    for (const run of runs) for (const item of cases) {
        const list = rows.filter(row => row.run === run && row.item.id === item.id);
        const index = list.findIndex(row => row.reply?.verdict === "same" || row.reply?.verdict === "not-persona");
        if (index < 0) continue;
        const row = list[index]!;
        replay[row.label] = (replay[row.label] ?? 0) + 1;
        out.push(`| ${run} | ${item.id} | 第 ${row.chapter} 章 | ${row.label} | ${index + 1} |`);
    }
    out.push("", `回放合计：${Object.entries(replay).map(([label, n]) => `${label} ${n}`).join("，")}。`);

    // 两遍一致：同一请求的 verdict 与对象都相同。
    const pairs = rows.filter(row => row.run === 1).map(row => [row, rows.find(other => other.run === 2 && other.item.id === row.item.id && other.chapter === row.chapter)] as const).filter(([a, b]) => a.reply && b?.reply);
    const same = pairs.filter(([a, b]) => a.reply!.verdict === b!.reply!.verdict && (a.reply!.entity ?? null) === (b!.reply!.entity ?? null)).length;
    out.push("", `两遍一致：${same}/${pairs.length}（${pct(same, pairs.length)}），按 verdict 与对象。`);
    console.log(out.join("\n"));
}

if (import.meta.main) await main();
