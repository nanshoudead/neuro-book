/**
 * t33 的检测评分（plan.md 的“报告”）。三步，判定写在 evidences/judgments.json（人工，入库），数字都从 .local 的 runs/ 重算：
 *
 *   bun report.ts --collect     收集各组的 graphIssues，按金标的记录自动配对，补齐 judgments.json 里还没有的条目
 *                               （已有的判定不动）；没配上的另写一份去掉组别、打乱顺序的 exploratory-blind.md 供判定
 *   bun report.ts               按 judgments.json 出报告（Markdown 打到标准输出）
 *
 * judgments.json 的每一条：key（组-遍-章-序号）→ {gold: 金标编号或 null, verdict}。verdict：
 * - 配上金标的："hit"（说对了问题，修法方向不错）或 "wrong"（指到了这条记录，但说的问题或修法不对）；
 * - 没配上的（探索集）："valid"（成立，影响查询或理解）、"minor"（成立，但只是相近类别之间的口径）或 "invalid"（不成立）；
 * - gold 可以写几个编号，用逗号分开（一条报告同时说中两条金标）；
 * - 还没判："?"。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {readRecord, RUNS, yuan, type CallRecord} from "./shared";

const HERE = import.meta.dir;
const JUDGMENTS = join(HERE, "../evidences/judgments.json");
const BLIND = join(HERE, "../evidences/exploratory-blind.md");

/** 金标的自动配对：报告的 records 包含这些编号就配上（G1 要两个都在）。只是候选，还要人工判 hit 或 wrong。 */
const GOLD: {id: string; all?: string[]; any?: string[]; visibleFrom: number | null; kind: string}[] = [
    {id: "G1", all: ["e18-1", "e19-1"], visibleFrom: 20, kind: "跨章马甲没连"},
    {id: "G2", any: ["s2-7"], visibleFrom: 18, kind: "说法类别错"},
    {id: "G3", any: ["e10-4"], visibleFrom: 18, kind: "对象种类错"},
    {id: "G4", any: ["e4-1"], visibleFrom: 18, kind: "对象种类错"},
    {id: "G5", any: ["e4-2"], visibleFrom: 18, kind: "对象种类错"},
    {id: "G6", any: ["s29-1"], visibleFrom: 30, kind: "说法类别错"},
    {id: "G7", any: ["s30-11"], visibleFrom: null, kind: "说法挂错对象"},
    {id: "G8", any: ["s25-1", "s25-18"], visibleFrom: 26, kind: "说法挂错对象"},
];
/** P 能指到的金标（evidences/gold.md）。 */
const PROGRAM_DETECTABLE = new Set(["G1", "G2", "G3", "G4", "G5"]);

interface Issue {
    key: string;
    group: string;
    run: number;
    chapter: number;
    index: number;
    type: string;
    records: string[];
    evidence: string[];
    claim: string;
    confidence: string;
}

interface Judgment {
    gold: string | null;
    verdict: "hit" | "wrong" | "valid" | "minor" | "invalid" | "?";
    note?: string;
}

async function records(): Promise<CallRecord[]> {
    const out: CallRecord[] = [];
    for await (const file of new Bun.Glob("*/*.json").scan(RUNS)) {
        const record = await readRecord(join(RUNS, file));
        if (record) out.push(record);
    }
    return out.sort((a, b) => a.group.localeCompare(b.group) || a.run - b.run || a.chapter - b.chapter);
}

function issuesOf(record: CallRecord): Issue[] {
    const list = (record.json as {graphIssues?: unknown} | undefined)?.graphIssues;
    if (!Array.isArray(list)) return [];
    return list.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
        return {
            key: `${record.group}-${record.run}-${record.chapter}-${index}`, group: record.group, run: record.run, chapter: record.chapter, index,
            type: String(item.type ?? ""), records: strings(item.records), evidence: strings(item.evidence), claim: String(item.claim ?? ""), confidence: String(item.confidence ?? ""),
        };
    });
}

const goldFor = (issue: Issue) => GOLD.find(gold => (gold.all ? gold.all.every(id => issue.records.includes(id)) : gold.any!.some(id => issue.records.includes(id))))?.id ?? null;

async function loadJudgments(): Promise<Record<string, Judgment>> {
    try {
        return JSON.parse(await readFile(JUDGMENTS, "utf8")) as Record<string, Judgment>;
    } catch {
        return {};
    }
}

async function collect() {
    const all = (await records()).flatMap(issuesOf);
    const judgments = await loadJudgments();
    for (const issue of all) judgments[issue.key] ??= {gold: goldFor(issue), verdict: "?"};
    await writeFile(JUDGMENTS, `${JSON.stringify(judgments, null, 1)}\n`);
    // 探索集：去掉组别，按 key 的哈希排序（固定的打乱），编号用序号；对照表只在 judgments.json 的 key 里。
    const open = all.filter(issue => judgments[issue.key]!.gold === null);
    const hash = (text: string) => [...text].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
    open.sort((a, b) => hash(a.key) - hash(b.key));
    const lines = ["# 探索集（去掉组别、打乱顺序）", "", "判定写回 judgments.json：valid 或 invalid。", ""];
    for (const issue of open) lines.push(`- \`${issue.key.split("-").slice(-2).join("-")}#${hash(issue.key).toString(36)}\`（读到第 ${issue.chapter} 章）${issue.type}｜${issue.records.join(",")}｜${issue.evidence.join(",")}｜${issue.claim}`);
    await writeFile(BLIND, `${lines.join("\n")}\n`);
    const pending = Object.values(judgments).filter(item => item.verdict === "?").length;
    console.log(`报告 ${all.length} 条，配上金标 ${all.length - open.length} 条，探索集 ${open.length} 条；待判 ${pending} 条`);
}

/** 草稿的形状：按类的记录条数与引用到的已有记录编号（章号小于本章的）。 */
function draftShape(record: CallRecord): {counts: Record<string, number>; refs: Set<string>} | null {
    if (record.outcome !== "ok" || !record.json) return null;
    const json = record.json as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (const key of ["entities", "names", "mentions", "secrets", "statements", "episodes", "episodeLinks", "knowledge", "ledger", "questions", "questionUpdates"]) counts[key] = Array.isArray(json[key]) ? (json[key] as unknown[]).length : 0;
    const refs = new Set<string>();
    const text = JSON.stringify({...json, graphIssues: undefined});
    for (const match of text.matchAll(/"([a-z])(\d+)-(\d+)"/gu)) if (Number(match[2]) < record.chapter) refs.add(`${match[1]}${match[2]}-${match[3]}`);
    return {counts, refs};
}

const outputTokens = (record: CallRecord) => record.attempts.reduce((sum, attempt) => sum + attempt.usage.output, 0);
const cost = (record: CallRecord) => record.attempts.reduce((sum, attempt) => sum + yuan(attempt.usage), 0);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

async function report() {
    const all = await records();
    const judgments = await loadJudgments();
    const out: string[] = [];
    const groups = ["A", "B", "C"];

    out.push("## 调用", "", "| 组-遍 | 请求 | 成功 | 不成形 | 失败 | HTTP 尝试 | 输入 | 缓存读 | 输出 | 费用（元，下界） |", "|---|---|---|---|---|---|---|---|---|---|");
    const byRun = new Map<string, CallRecord[]>();
    for (const record of all) byRun.set(`${record.group}-${record.run}`, [...(byRun.get(`${record.group}-${record.run}`) ?? []), record]);
    for (const [name, list] of byRun) {
        const sum = (pick: (attempt: CallRecord["attempts"][number]) => number) => list.reduce((total, record) => total + record.attempts.reduce((acc, attempt) => acc + pick(attempt), 0), 0);
        out.push(`| ${name} | ${list.length} | ${list.filter(r => r.outcome === "ok").length} | ${list.filter(r => r.outcome === "bad").length} | ${list.filter(r => r.outcome === "error").length} | ${sum(() => 1)} | ${sum(a => a.usage.input)} | ${sum(a => a.usage.cacheRead)} | ${sum(a => a.usage.output)} | ${list.reduce((t, r) => t + cost(r), 0).toFixed(3)} |`);
    }
    out.push("", `合计 ¥${all.reduce((t, r) => t + cost(r), 0).toFixed(2)}（按 deepseek-flash 低谷价，用量不完整的按下界）。`);

    // 检测：每组每遍的金标召回、准确率、最早报出的章。
    out.push("", "## 检测", "", "准确率：成立的报告（命中金标与探索集成立）占已判报告的比例；括号里把“小问题”也算成立。", "", "| 组-遍 | 报告 | 金标命中 | 指到金标但说错 | 探索集成立 | 小问题 | 不成立 | 准确率 | 命中的金标（最早章） |", "|---|---|---|---|---|---|---|---|---|");
    const hitsBy = new Map<string, Map<string, number>>();
    for (const [name, list] of byRun) {
        if (!groups.includes(name.split("-")[0]!)) continue;
        const issues = list.flatMap(issuesOf);
        const verdicts = issues.map(issue => judgments[issue.key] ?? {gold: null, verdict: "?" as const});
        const hit = new Map<string, number>();
        issues.forEach((issue, index) => {
            const judgment = verdicts[index]!;
            if (judgment.verdict === "hit" && judgment.gold) for (const gold of judgment.gold.split(",")) hit.set(gold, Math.min(hit.get(gold) ?? Infinity, issue.chapter));
        });
        hitsBy.set(name, hit);
        const count = (verdict: string) => verdicts.filter(item => item.verdict === verdict).length;
        const judged = issues.length - count("?");
        const percent = (value: number) => (judged ? `${Math.round((value / judged) * 100)}%` : "-");
        const precision = `${percent(count("hit") + count("valid"))}（${percent(count("hit") + count("valid") + count("minor"))}）`;
        const chapterOf = (gold: string, chapter: number) => (name.startsWith("C") ? gold : `${gold}（${chapter}）`);
        out.push(`| ${name} | ${issues.length}${count("?") ? `（待判 ${count("?")}）` : ""} | ${hit.size} | ${count("wrong")} | ${count("valid")} | ${count("minor")} | ${count("invalid")} | ${precision} | ${[...hit].sort().map(([gold, chapter]) => chapterOf(gold, chapter)).join("、") || "无"} |`);
    }
    out.push("", "C 是读完第 30 章后的分段扫描，没有“最早第几章”。", "", "金标各条被哪几遍命中（A、B 写最早报出的章）：", "", "| 金标 | 类别 | A、B 最早可见 | P 能指到 | " + [...hitsBy.keys()].join(" | ") + " |", "|---|---|---|---|" + [...hitsBy.keys()].map(() => "---|").join(""));
    for (const gold of GOLD) out.push(`| ${gold.id} | ${gold.kind} | ${gold.visibleFrom ?? "不可见"} | ${PROGRAM_DETECTABLE.has(gold.id) ? "能" : "不能"} | ${[...hitsBy].map(([name, hit]) => (hit.has(gold.id) ? (name.startsWith("C") ? "命中" : `第 ${hit.get(gold.id)} 章`) : "")).join(" | ")} |`);

    // 拖累草稿：A 与 A0 的差，对照 A0 两遍之间的差。
    out.push("", "## A 对 A0 的草稿形状", "", "| 章 | A0-1 | A0-2 | A-1 | A-2 | 输出 token A0（两遍） | 输出 token A（两遍） | 引用已有记录 A0 两遍的交集比 | A 与 A0 的交集比 |", "|---|---|---|---|---|---|---|---|---|");
    const jaccard = (a: Set<string>, b: Set<string>) => (a.size + b.size ? [...a].filter(x => b.has(x)).length / new Set([...a, ...b]).size : 1);
    const find = (group: string, run: number, chapter: number) => all.find(record => record.group === group && record.run === run && record.chapter === chapter);
    const totals = {a0: [] as number[], a: [] as number[], noise: [] as number[], shift: [] as number[], sizeA0: [] as number[], sizeA: [] as number[]};
    for (let chapter = 18; chapter <= 30; chapter++) {
        const cells = [find("A0", 1, chapter), find("A0", 2, chapter), find("A", 1, chapter), find("A", 2, chapter)];
        const shapes = cells.map(record => (record ? draftShape(record) : null));
        const size = (shape: ReturnType<typeof draftShape>) => (shape ? Object.values(shape.counts).reduce((a, b) => a + b, 0).toString() : "失败");
        // 失败的请求没有草稿，输出 token 不计入平均（否则按 0 算会拉低）。
        const tokens = (records: (CallRecord | undefined)[]) => records.map(record => (record?.outcome === "ok" ? outputTokens(record) : NaN));
        const [a0a, a0b, aa, ab] = shapes;
        const noise = a0a && a0b ? jaccard(a0a.refs, a0b.refs) : NaN;
        const shift = a0a && a0b && aa && ab ? mean([jaccard(aa.refs, a0a.refs), jaccard(aa.refs, a0b.refs), jaccard(ab.refs, a0a.refs), jaccard(ab.refs, a0b.refs)]) : NaN;
        const t0 = tokens(cells.slice(0, 2)), t1 = tokens(cells.slice(2));
        totals.a0.push(...t0); totals.a.push(...t1); totals.noise.push(noise); totals.shift.push(shift);
        const sizes = shapes.map(shape => (shape ? Object.values(shape.counts).reduce((a, b) => a + b, 0) : NaN));
        totals.sizeA0.push(...sizes.slice(0, 2)); totals.sizeA.push(...sizes.slice(2));
        out.push(`| ${chapter} | ${shapes.map(size).join(" | ")} | ${t0.join("、")} | ${t1.join("、")} | ${noise.toFixed(2)} | ${shift.toFixed(2)} |`);
    }
    const finite = (values: number[]) => values.filter(Number.isFinite);
    out.push("", `平均：草稿记录条数 A0 ${mean(finite(totals.sizeA0)).toFixed(1)}、A ${mean(finite(totals.sizeA)).toFixed(1)}；输出 token A0 ${mean(finite(totals.a0)).toFixed(0)}、A ${mean(finite(totals.a)).toFixed(0)}；引用已有记录的交集比，A0 两遍之间 ${mean(finite(totals.noise)).toFixed(2)}，A 与 A0 之间 ${mean(finite(totals.shift)).toFixed(2)}。`);
    const costOf = (group: string) => mean([1, 2].map(run => all.filter(record => record.group === group && record.run === run).reduce((t, r) => t + cost(r), 0)));
    out.push(`每遍 13 章的费用：A0 ¥${costOf("A0").toFixed(3)}、A ¥${costOf("A").toFixed(3)}（顺带报告的增量约 ¥${(costOf("A") - costOf("A0")).toFixed(3)}）、B ¥${costOf("B").toFixed(3)}；C 每遍 ¥${costOf("C").toFixed(3)}。`);
    console.log(out.join("\n"));
}

if (import.meta.main) {
    if (process.argv.includes("--collect")) await collect();
    else await report();
}
