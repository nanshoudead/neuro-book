// t12 评测的对照（plan.md 的“验证”第 2 条）：旧写法与新写法各 19 次整理（consolidate-only.ts 的输出）在第 30、60、95 章的
// 主线与对象归纳，和每次整理的输入 token、费用。两组的整理稿都用 --pkg（新代码）的 compile 编，草稿相同。
//
// - 归入比例 = 当前这一批主线所含、在该章可见的不同情节数 ÷ 该章可见的全部情节数；另报这一段（该章往前 5 章）新情节的
//   归入比例、主线条数、最大一条主线的情节数。
// - 输入 token：每次整理成功的那次尝试（最后一次）的 usage.input（含系统提示词）；失败的尝试另计在合计里。
// - 出场最多的 10 个对象（截至该章的提及次数）：各有几个方面的归纳、最近一次更新在第几章。
// - 门槛：三个检查点上新写法的归入比例都不低于旧写法 5 个百分点以上；第 95 章新写法的整理输入不到旧写法的一半。
//
// 用法（仓库根执行）：bun <本文件> --pkg <nb-story 包目录> --old <旧组输出目录> --new <新组输出目录> > compare.md
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";

const {values} = parseArgs({options: {pkg: {type: "string"}, old: {type: "string"}, new: {type: "string"}}});
if (!values.pkg || !values.old || !values.new) throw new Error("用法见文件头");
const pkg = resolve(values.pkg);
const PRICE = {input: 1, output: 4, cacheRead: 0.02};
const CHECKPOINTS = [30, 60, 95];

const {compile} = await import(join(pkg, "src/ingest/compile.ts"));
const {sampleDataset} = await import(join(pkg, "testing/sample.ts"));
const gunzipJson = async <T>(name: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(pkg, "tests/fixtures/ingest", name))).toString("utf8")) as T;

interface Usage {input: number; output: number; cacheRead: number; complete: boolean}
interface RunRecord {chapter: number; since: number; accepted: boolean; consolidation: unknown | null; problems: string[]; attempts: {usage: Usage; error: string | null}[]; error?: string}
interface State {runs: RunRecord[]; incomplete?: string}
interface Arc {id: string; episodes: string[]; through: number; title: string; summary: string; status: string}
interface Dataset {episodes: {id: string; at: {chapter: number}}[]; arcs: Arc[]; summaries: {entity: string; facet: string; through: number}[]; mentions: {entity: string; at: {chapter: number}}[]; entities: {id: string; label: string; names: {text: string; primary: boolean}[]}[]}

const sample = await sampleDataset();
const fixes = await gunzipJson<{chapters: Record<string, {draft: unknown}>}>("prefix-098-fixes.json.gz");
const final = await gunzipJson<{drafts: unknown[]}>("run-med-100-final.json.gz");
const drafts = final.drafts.slice(0, 95).map((draft, index) => fixes.chapters[String(index + 1)]?.draft ?? draft);
const cost = (usage: Usage) => (Math.max(0, usage.input - usage.cacheRead) * PRICE.input + usage.cacheRead * PRICE.cacheRead + usage.output * PRICE.output) / 1_000_000;

async function load(dir: string): Promise<State> {
    return JSON.parse(await readFile(join(resolve(dir), "state.json"), "utf8")) as State;
}

function datasetAt(state: State, chapter: number): Dataset {
    const accepted = state.runs.filter(run => run.accepted && run.chapter <= chapter).map(run => run.consolidation);
    return compile(sample.book, sample.sources.filter((item: {chapter: number}) => item.chapter <= chapter), drafts.slice(0, chapter), accepted).dataset as Dataset;
}

function metrics(dataset: Dataset, chapter: number) {
    const through = Math.max(0, ...dataset.arcs.map(arc => arc.through));
    const batch = dataset.arcs.filter(arc => arc.through === through);
    const visible = new Set(dataset.episodes.map(item => item.id));
    const covered = new Set(batch.flatMap(arc => arc.episodes).filter(id => visible.has(id)));
    const segment = dataset.episodes.filter(item => item.at.chapter > chapter - 5);
    const mentions = new Map<string, number>();
    for (const mention of dataset.mentions) mentions.set(mention.entity, (mentions.get(mention.entity) ?? 0) + 1);
    const top = [...mentions].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
    const facets = top.map(id => {
        const own = dataset.summaries.filter(item => item.entity === id);
        const name = dataset.entities.find(entity => entity.id === id)?.names.find(item => item.primary)?.text ?? id;
        return {id, name, facets: new Set(own.map(item => item.facet)).size, latest: Math.max(0, ...own.map(item => item.through))};
    });
    return {
        batchThrough: through,
        coverage: covered.size / visible.size,
        segmentCoverage: segment.length ? segment.filter(item => covered.has(item.id)).length / segment.length : 1,
        arcs: batch.length,
        maxArc: Math.max(0, ...batch.map(arc => arc.episodes.filter(id => visible.has(id)).length)),
        facets,
    };
}

const groups = {old: await load(values.old), new: await load(values.new)};
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const lines: string[] = ["# t12 评测对照：旧写法（全量重写）vs 新写法（增量）", ""];
for (const [name, state] of Object.entries(groups)) if (state.incomplete) lines.push(`- ${name} 组不完整：${state.incomplete}`);

lines.push("## 每次整理", "", "| 章 | 旧：输入 token | 旧：输出 | 旧：结果 | 新：输入 token | 新：输出 | 新：结果 |", "| --- | --- | --- | --- | --- | --- | --- |");
const settled = (run?: RunRecord) => run?.attempts.at(-1)?.usage;
for (let chapter = 5; chapter <= 95; chapter += 5) {
    const cells = (Object.values(groups) as State[]).flatMap(state => {
        const run = state.runs.find(item => item.chapter === chapter);
        const usage = settled(run);
        const result = !run ? "没跑" : run.error ? `出错（${run.error.slice(0, 30)}）` : run.accepted ? `接受${run.attempts.length > 1 ? `，${run.attempts.length} 次尝试` : ""}${run.problems.length ? `，${run.problems.length} 条问题` : ""}` : `跳过（${run.problems.at(-1)?.slice(0, 40) ?? ""}）`;
        return [usage?.input ?? "", usage?.output ?? "", result];
    });
    lines.push(`| ${chapter} | ${cells.join(" | ")} |`);
}
const totals = (state: State) => {
    const attempts = state.runs.flatMap(run => run.attempts);
    return {requests: attempts.length, input: attempts.reduce((sum, item) => sum + item.usage.input, 0), output: attempts.reduce((sum, item) => sum + item.usage.output, 0), cacheRead: attempts.reduce((sum, item) => sum + item.usage.cacheRead, 0), cost: attempts.reduce((sum, item) => sum + cost(item.usage), 0), skipped: state.runs.filter(run => !run.accepted).length, problems: state.runs.reduce((sum, run) => sum + run.problems.length, 0)};
};
lines.push("", "| 组 | 请求 | 输入 token | 输出 token | 缓存命中 | 费用（元） | 跳过的整理 | 清理去掉的条目与问题 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [name, state] of Object.entries(groups)) {
    const t = totals(state);
    lines.push(`| ${name} | ${t.requests} | ${t.input} | ${t.output} | ${t.cacheRead} | ${t.cost.toFixed(3)} | ${t.skipped} | ${t.problems} |`);
}

lines.push("", "## 检查点", "");
const verdicts: string[] = [];
for (const chapter of CHECKPOINTS) {
    const old = metrics(datasetAt(groups.old, chapter), chapter);
    const fresh = metrics(datasetAt(groups.new, chapter), chapter);
    lines.push(`### 第 ${chapter} 章`, "", "| | 旧 | 新 |", "| --- | --- | --- |");
    lines.push(`| 最近一批主线归纳到 | ${old.batchThrough} | ${fresh.batchThrough} |`);
    lines.push(`| 归入比例 | ${pct(old.coverage)} | ${pct(fresh.coverage)} |`);
    lines.push(`| 最近 5 章新情节的归入比例 | ${pct(old.segmentCoverage)} | ${pct(fresh.segmentCoverage)} |`);
    lines.push(`| 主线条数 | ${old.arcs} | ${fresh.arcs} |`);
    lines.push(`| 最大一条主线的情节数 | ${old.maxArc} | ${fresh.maxArc} |`);
    lines.push("", "出场最多的 10 个对象：方面数（最近更新在第几章），旧 / 新", "");
    for (let index = 0; index < old.facets.length; index++) {
        const a = old.facets[index]!, b = fresh.facets.find(item => item.id === a.id);
        lines.push(`- ${a.name}（${a.id}）：${a.facets}（${a.latest}） / ${b ? `${b.facets}（${b.latest}）` : "无"}`);
    }
    lines.push("");
    verdicts.push(`第 ${chapter} 章归入比例：新 ${pct(fresh.coverage)}，旧 ${pct(old.coverage)}，${fresh.coverage >= old.coverage - 0.05 ? "过" : "没过"}`);
}
const input95 = (state: State) => settled(state.runs.find(run => run.chapter === 95))?.input ?? NaN;
verdicts.push(`第 95 章整理输入：新 ${input95(groups.new)}，旧 ${input95(groups.old)}，${input95(groups.new) < input95(groups.old) / 2 ? "过" : "没过"}`);
lines.push("## 门槛", "", ...verdicts.map(item => `- ${item}`));
console.log(lines.join("\n"));
