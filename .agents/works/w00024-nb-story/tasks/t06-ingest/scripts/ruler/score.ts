// 验收 11 的总分（docs/specs/story/ingest.md 验收 11）：每条每次按 对 3、部分 2、缺 1、错 0 计分，几次合计；另数三次间
// 结论不一致（翻转）的条数。计分法同 w00005 t33 的过程记录。用法：bun score.ts <结果目录 1> <结果目录 2> …（check.ts 的 --out）
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const POINTS: Record<string, number> = { 对: 3, 部分: 2, 缺: 1, 错: 0 };
const dirs = process.argv.slice(2);
if (!dirs.length) throw new Error("用法：score.ts <结果目录>…");
const runs = await Promise.all(dirs.map(async dir => ({ name: basename(resolve(dir)), results: (JSON.parse(await readFile(resolve(dir, "results.json"), "utf8")) as { results: { id: string; verdict: string }[] }).results })));
let total = 0;
for (const run of runs) {
    const score = run.results.reduce((sum, item) => sum + (POINTS[item.verdict] ?? 0), 0);
    total += score;
    const count = (verdict: string) => run.results.filter(item => item.verdict === verdict).length;
    console.log(`${run.name}：${run.results.length} 条，对 ${count("对")}、部分 ${count("部分")}、错 ${count("错")}、缺 ${count("缺")}，得分 ${score}`);
}
const ids = [...new Set(runs.flatMap(run => run.results.map(item => item.id)))];
const flips = ids.filter(id => new Set(runs.map(run => run.results.find(item => item.id === id)?.verdict ?? "—")).size > 1);
console.log(`合计 ${total}（满分 ${ids.length * 3 * runs.length}）；翻转 ${flips.length} 条${flips.length ? `：${flips.join("、")}` : ""}`);
