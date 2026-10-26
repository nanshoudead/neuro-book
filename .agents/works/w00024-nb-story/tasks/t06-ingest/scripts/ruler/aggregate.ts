import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

// 把几次抽取各自的尺子结果并成一张表：每条在各次里的结论，以及“稳定对 / 翻转 / 稳定错 / 稳定缺”的归类。
// 用法：bun aggregate.ts --out <汇总文件.md> <结果目录 1> <结果目录 2> …（每个目录里有 check.ts 写的 results.json）

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
const dirs = args.filter((item, index) => index !== outIndex && index !== outIndex + 1);
if (!dirs.length) throw new Error("用法：aggregate.ts --out <汇总文件> <结果目录>…");

interface Row { id: string; category: string; text: string; verdict: string; detail: string }
const runs = await Promise.all(dirs.map(async dir => ({ name: basename(resolve(dir)), rows: (JSON.parse(await readFile(resolve(dir, "results.json"), "utf8")) as { results: Row[] }).results })));
const ids = [...new Set(runs.flatMap(run => run.rows.map(row => row.id)))];

type Group = "稳定对" | "翻转" | "稳定错" | "稳定缺" | "稳定部分";
function classify(verdicts: string[]): Group {
    const set = new Set(verdicts);
    if (set.size === 1) return verdicts[0] === "对" ? "稳定对" : verdicts[0] === "错" ? "稳定错" : verdicts[0] === "缺" ? "稳定缺" : "稳定部分";
    return "翻转";
}

const lines: string[] = [];
const groups = new Map<Group, string[]>();
const header = `| 编号 | 类别 | 核对项 | ${runs.map(run => run.name).join(" | ")} | 归类 |`;
lines.push(header, `| --- | --- | --- | ${runs.map(() => "---").join(" | ")} | --- |`);
for (const id of ids) {
    const rows = runs.map(run => run.rows.find(row => row.id === id));
    const first = rows.find(row => row)!;
    const verdicts = rows.map(row => row?.verdict ?? "—");
    const group = classify(verdicts);
    groups.set(group, [...(groups.get(group) ?? []), id]);
    lines.push(`| ${id} | ${first.category} | ${first.text} | ${verdicts.join(" | ")} | ${group} |`);
}
const perRun = runs.map(run => `${run.name}：对 ${run.rows.filter(row => row.verdict === "对").length}、部分 ${run.rows.filter(row => row.verdict === "部分").length}、错 ${run.rows.filter(row => row.verdict === "错").length}、缺 ${run.rows.filter(row => row.verdict === "缺").length}`);
const summary = (["稳定对", "翻转", "稳定部分", "稳定错", "稳定缺"] as Group[]).map(group => `${group} ${groups.get(group)?.length ?? 0}${groups.get(group)?.length ? `（${groups.get(group)!.join("、")}）` : ""}`);
const text = `# 尺子汇总（${runs.length} 次抽取，${ids.length} 条）\n\n${perRun.map(item => `- ${item}`).join("\n")}\n\n${summary.map(item => `- ${item}`).join("\n")}\n\n${lines.join("\n")}\n`;
if (outPath) await writeFile(resolve(outPath), text);
console.log(text);
