// t11 评测的对照（plan.md 的“验证”）：两项都关的一次抽取，对 t10 三次回归（两项都开）。
//
// - 尺子只比固定的 29 条（去掉 L1 到 L15 数值与 K1 到 K9 知情与秘密），对 3、部分 2、缺 1、错 0，单次满分 87；每份结果的
//   编号集合必须正好是这 29 条，否则直接失败（不同分母的总分不可比）。
// - 用量：每次抽取的请求数（按 usage.jsonl 的结算行）、输入、输出、缓存命中 token、费用与用时，取自 `ingest --status --json`。
// - 模型仍写出多少条关掉的记录：数各章问题里“按书的设置去掉了……”的条数。
//
// 用法（仓库根执行）：bun compare.ts --off <t11 的抽取目录> --off-ruler <t11 的尺子结果目录> --base <t10 的抽取目录>… --base-ruler <t10 的尺子结果目录>…
// 抽取目录是 regress-*.sh 的输出（含 status.json 与 library/），尺子结果目录是 check.ts 的 --out（含 results.json）。
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const SUBSET = ["T1", "T2", "T3", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "E1", "E2", "E3", "E4", "J1", "J2", "J3", "J4", "Q1", "Q2", "P1", "P2", "P3"];
const POINTS: Record<string, number> = { 对: 3, 部分: 2, 缺: 1, 错: 0 };

const { values } = parseArgs({ options: { off: { type: "string" }, "off-ruler": { type: "string" }, base: { type: "string", multiple: true }, "base-ruler": { type: "string", multiple: true } } });
if (!values.off || !values["off-ruler"] || !values.base?.length || !values["base-ruler"]?.length) throw new Error("用法见文件头");

async function verdicts(dir: string): Promise<Map<string, string>> {
    const { results } = JSON.parse(await readFile(resolve(dir, "results.json"), "utf8")) as { results: { id: string; verdict: string }[] };
    const subset = new Map(results.filter(item => SUBSET.includes(item.id)).map(item => [item.id, item.verdict]));
    const missing = SUBSET.filter(id => !subset.has(id));
    if (missing.length) throw new Error(`${dir} 缺这几条：${missing.join("、")}`);
    return subset;
}

async function usage(dir: string) {
    const status = (JSON.parse(await readFile(resolve(dir, "status.json"), "utf8")) as { data: { allRuns: { input: number; output: number; cacheRead: number; costs: { amount: number }[]; ms: number; complete: boolean } } }).data.allRuns;
    const lines = (await readFile(resolve(dir, "library", ".ingest", "sample20", "usage.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as { kind: string; step: string });
    const ends = lines.filter(line => line.kind === "end");
    const steps: Record<string, number> = {};
    for (const line of ends) steps[line.step] = (steps[line.step] ?? 0) + 1;
    return { requests: ends.length, steps, input: status.input, output: status.output, cacheRead: status.cacheRead, cost: status.costs.reduce((sum, cost) => sum + cost.amount, 0), minutes: status.ms / 60_000, complete: status.complete };
}

/** 各章问题里“按书的设置去掉了 5 条数值记录、1 个秘密……”的条数合计。 */
async function removed(dir: string): Promise<Record<string, number>> {
    const book = resolve(dir, "library", "sample20");
    const file = (await readdir(book)).find(name => /^extraction-\d+\.json$/u.test(name));
    if (!file) return {};
    const data = JSON.parse(await readFile(join(book, file), "utf8")) as { chapters: { problems: string[] }[] };
    const totals: Record<string, number> = {};
    for (const chapter of data.chapters) for (const problem of chapter.problems) {
        if (!problem.startsWith("按书的设置去掉了")) continue;
        for (const match of problem.matchAll(/(\d+) (?:条|个)([^、]+)/gu)) totals[match[2]!] = (totals[match[2]!] ?? 0) + Number(match[1]);
    }
    return totals;
}

const score = (map: Map<string, string>) => SUBSET.reduce((sum, id) => sum + POINTS[map.get(id)!]!, 0);
const offVerdicts = await verdicts(values["off-ruler"]);
const baseVerdicts = await Promise.all(values["base-ruler"].map(verdicts));
const names = values["base-ruler"].map(dir => basename(resolve(dir)));

const out: string[] = ["# t11 评测对照：两项都关 vs t10 三次（两项都开）", "", `尺子：固定的 ${SUBSET.length} 条（去掉数值 L1 到 L15、知情与秘密 K1 到 K9），单次满分 ${SUBSET.length * 3}。`, ""];
out.push("| 运行 | 得分 | 对 | 部分 | 缺 | 错 |", "| --- | --- | --- | --- | --- | --- |");
const row = (name: string, map: Map<string, string>) => {
    const count = (verdict: string) => SUBSET.filter(id => map.get(id) === verdict).length;
    return `| ${name} | ${score(map)} | ${count("对")} | ${count("部分")} | ${count("缺")} | ${count("错")} |`;
};
baseVerdicts.forEach((map, index) => out.push(row(`t10 ${names[index]}`, map)));
out.push(row("t11 两项都关", offVerdicts), "");

const changed = SUBSET.filter(id => !baseVerdicts.some(map => map.get(id) === offVerdicts.get(id)));
out.push(`t11 的结论在 t10 三次里都没出现过的：${changed.length ? changed.map(id => `${id}（t10 ${baseVerdicts.map(map => map.get(id)).join("/")} → ${offVerdicts.get(id)}）`).join("、") : "没有"}。`, "");
out.push("| 编号 | " + names.map(name => `t10 ${name}`).join(" | ") + " | t11 |", "| --- | " + names.map(() => "---").join(" | ") + " | --- |");
for (const id of SUBSET) out.push(`| ${id} | ${baseVerdicts.map(map => map.get(id)).join(" | ")} | ${offVerdicts.get(id)} |`);
out.push("");

const usages = await Promise.all([...values.base, values.off].map(usage));
const labels = [...values.base.map(dir => `t10 ${basename(resolve(dir))}`), "t11 两项都关"];
out.push("| 运行 | 请求数 | 各步请求数 | 输入 token | 输出 token | 缓存命中 | 费用（CNY） | 用时（分） |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
usages.forEach((item, index) => out.push(`| ${labels[index]} | ${item.requests} | ${Object.entries(item.steps).map(([step, count]) => `${step} ${count}`).join("、")} | ${item.input} | ${item.output} | ${item.cacheRead} | ${item.cost.toFixed(2)}${item.complete ? "" : "（不完整）"} | ${item.minutes.toFixed(1)} |`));
out.push("", `模型仍写出、提交前去掉的：${Object.entries(await removed(values.off)).map(([kind, count]) => `${kind} ${count}`).join("、") || "没有"}。`);
console.log(out.join("\n"));
