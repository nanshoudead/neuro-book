// story.cli 验收 5：确定性检查与答错计数。用法：bun skill-eval-check.ts <题集> <评测目录>，结果（Markdown）打到 stdout。
// 确定性检查（验收 5 第 1 条）：每份答案至少引用一处“章.段”；引用的章与正文里写的“第 N 章”都不超过这道题的阅读位置。
// 答错（第 2 条）照 t22 v2-data.ts 的 outcomeOf：核心结论判错，或命中“错误”类的错误说法。
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

const [questionsPath, evalDir] = process.argv.slice(2);
if (!questionsPath || !evalDir) throw new Error("用法：bun skill-eval-check.ts <题集> <评测目录>");
const bank = JSON.parse(readFileSync(questionsPath, "utf8"));
const RUNS = ["run1", "run2", "run3"];
const REF = /(\d{1,3})\.(\d{1,3})(?:\s*[-—–~～至]\s*(?:(\d{1,3})\.)?(\d{1,3}))?/gu;
const CHAPTER = /第\s*(\d{1,3})\s*章/gu;

type Row = {run: string; id: string; prefix: number; refs: number; beyond: string[]; outcome: string; core: string | null};
const rows: Row[] = [];
for (const run of RUNS) {
    for (const question of bank.questions) {
        const file = join(evalDir, "answers", run, `batch-${question.id}.json`);
        if (!existsSync(file)) {
            rows.push({run, id: question.id, prefix: question.requiredPrefix, refs: 0, beyond: [], outcome: "未答", core: null});
            continue;
        }
        const answer: string = JSON.parse(readFileSync(file, "utf8")).answers[0].answer;
        const prefix: number = question.requiredPrefix;
        const beyond: string[] = [];
        let refs = 0;
        for (const match of answer.matchAll(REF)) {
            refs += 1;
            const last = match[3] ? Number(match[3]) : Number(match[1]);
            if (Number(match[1]) > prefix || last > prefix) beyond.push(match[0]);
        }
        for (const match of answer.matchAll(CHAPTER)) if (Number(match[1]) > prefix) beyond.push(match[0]);
        const gradeFile = join(evalDir, "judge", run, `${question.id}.json`);
        const grade = existsSync(gradeFile) ? JSON.parse(readFileSync(gradeFile, "utf8")).grade : null;
        rows.push({run, id: question.id, prefix, refs, beyond, outcome: outcomeOf(question, grade), core: grade?.core ?? null});
    }
}

function outcomeOf(question: any, grade: any): string {
    if (!grade) return "未判";
    const score = grade.points.reduce((sum: number, point: any) => sum + (point.status === "对" ? 1 : point.status === "部分" ? 0.5 : 0), 0) / question.mustHave.length;
    const forbiddenError = (grade.errors ?? []).some((error: any) => error.forbidden != null && question.forbidden[error.forbidden]?.kind === "error");
    if (grade.core === "错" || forbiddenError) return "答错";
    if (grade.core === "回避") return "没把握";
    return score >= 0.75 ? "答对" : "答对但不全";
}

const count = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
const wrong = count(row => row.outcome === "答错");
const noRef = rows.filter(row => row.refs === 0 && row.outcome !== "未答");
const complete = count(row => row.outcome === "未答" || row.outcome === "未判") === 0;
const spoil = rows.filter(row => row.beyond.length > 0);
const lines = [
    "# story.cli 验收 5：Agent 按 Skill 作答",
    "",
    `- 份数：${rows.length}（${bank.questions.length} 题 × ${RUNS.length} 次）；未答 ${count(row => row.outcome === "未答")}，未判 ${count(row => row.outcome === "未判")}`,
    `- 答错（一审）：**${wrong}/${rows.length}**，门槛不超过 11 份（基线 11/48）：${!complete ? "还有没答或没判的，暂不下结论" : wrong <= 11 ? "通过" : "不通过"}`,
    `- 结果分布：${["答对", "答对但不全", "没把握", "答错"].map(name => `${name} ${count(row => row.outcome === name)}`).join("，")}`,
    `- 确定性检查：没有引用出处的 ${noRef.length} 份；提到阅读位置之后的 ${spoil.length} 份`,
    "",
    "| 题 | 阅读位置 | " + RUNS.join(" | ") + " |",
    "|---|---|" + RUNS.map(() => "---").join("|") + "|",
    ...bank.questions.map((question: any) => `| ${question.id} | ${question.requiredPrefix} | ${RUNS.map(run => {
        const row = rows.find(item => item.run === run && item.id === question.id)!;
        return `${row.outcome}${row.refs === 0 && row.outcome !== "未答" ? "，无出处" : ""}${row.beyond.length ? `，越界 ${row.beyond.join(" ")}` : ""}`;
    }).join(" | ")} |`),
];
console.log(lines.join("\n"));
