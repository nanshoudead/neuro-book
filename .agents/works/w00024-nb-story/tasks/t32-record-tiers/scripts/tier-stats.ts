/**
 * t32 第 3 片：真实模型小抽取得到的先验 tier 的写入率、分布，以及与 t28 第一遍标注的加权 κ。
 *
 *   bun tier-stats.ts <抽取得到的 dataset-v9.json>
 *
 * 新抽的说法编号与样例书不同，按“同一章、字的二元组 Jaccard 最高且不低于 0.5”对到样例书的说法，再用 t28 的标注比较。
 * 通过标准见 plan.md 的“抽取”：写入率 ≥ 95%，1 级 10% 到 35%，3 级 15% 到 45%，加权 κ ≥ 0.4。
 */
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

const ROOT = join(import.meta.dir, "..");
const NB = join(ROOT, "../../../../../packages/nb-story");
type Rec = {id: string; text: string; at: {chapter: number}; tier?: number};
const extracted = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {statements: Rec[]; episodes: (Rec & {title: string})[]};
const sample = JSON.parse(gunzipSync(await readFile(join(NB, "tests/fixtures/sample-100ch.json.gz"))).toString("utf8")) as {statements: Rec[]};
const labels = JSON.parse(await readFile(join(ROOT, "../t28-graph-tiering/evidences/tiers-run-1.json"), "utf8")).tiers as Record<string, number>;

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;
function report(kind: string, records: Rec[]): void {
    const tiered = records.filter(record => record.tier !== undefined);
    const dist = [1, 2, 3].map(tier => `${tier} 级 ${tiered.filter(record => record.tier === tier).length}（${pct(tiered.filter(record => record.tier === tier).length, tiered.length)}）`).join("，");
    console.log(`${kind}：${records.length} 条，写了 tier 的 ${tiered.length}（${pct(tiered.length, records.length)}）；${dist}`);
}
report("说法", extracted.statements);
report("情节", extracted.episodes);

const bigrams = (text: string) => {
    const chars = Array.from(text.replace(/[^\p{L}\p{N}]/gu, ""));
    return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
};
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter(item => b.has(item)).length / Math.max(1, new Set([...a, ...b]).size);
const pairs: [number, number][] = [];
for (const statement of extracted.statements) {
    if (statement.tier === undefined) continue;
    const mine = bigrams(statement.text);
    let best: {score: number; id: string} | null = null;
    for (const other of sample.statements) {
        if (other.at.chapter !== statement.at.chapter || labels[other.id] === undefined) continue;
        const score = jaccard(mine, bigrams(other.text));
        if (!best || score > best.score) best = {score, id: other.id};
    }
    if (best && best.score >= 0.5) pairs.push([statement.tier, labels[best.id]!]);
}
// 线性加权 κ（三级）。
const k = 3;
const observed = Array.from({length: k}, () => Array(k).fill(0) as number[]);
for (const [a, b] of pairs) observed[a - 1]![b - 1]! += 1;
const n = pairs.length;
const rows = observed.map(row => row.reduce((s, v) => s + v, 0));
const cols = [0, 1, 2].map(j => observed.reduce((s, row) => s + row[j]!, 0));
let po = 0;
let pe = 0;
for (let i = 0; i < k; i += 1) for (let j = 0; j < k; j += 1) {
    const weight = 1 - Math.abs(i - j) / (k - 1);
    po += (weight * observed[i]![j]!) / n;
    pe += (weight * rows[i]! * cols[j]!) / (n * n);
}
console.log(`与 t28 第一遍标注对上的说法 ${n} 条，完全一致 ${pct(pairs.filter(([a, b]) => a === b).length, n)}，线性加权 κ ${((po - pe) / (1 - pe)).toFixed(2)}`);
console.log(`交叉表（行：这次的先验，列：t28 标注）：${JSON.stringify(observed)}`);
