// t12 旧整理稿的编译基线：用 t12 开工前的代码（1d4ad1ffa）把 run-med-100-final 的草稿与 20 批整理稿编到第 5、10、…、100 章，
// 记下每个前缀的 SHA-256。归纳的 `entity` 单独记（t12 有意改了它：被后来合并掉的对象名下的旧归纳改记到合并后的对象），
// 算摘要时去掉；一条归纳写下时解析出的对象在各前缀里相同，所以只记最终那一份。
//
// 用法（在 nb-story 包目录执行）：bun <本文件> <输出 json>
import {readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

const root = process.cwd();
const {compile} = await import(join(root, "src/ingest/compile.ts"));
const {sampleDataset} = await import(join(root, "testing/sample.ts"));
const sample = await sampleDataset();
const final = JSON.parse(gunzipSync(await readFile(join(root, "tests/fixtures/ingest/run-med-100-final.json.gz"))).toString("utf8")) as {drafts: unknown[]; consolidations: {through: number}[]};
const prefixes: Record<string, string> = {};
let entities: string[] = [];
for (let through = 5; through <= 100; through += 5) {
    const {dataset} = compile(sample.book, sample.sources.filter((item: {chapter: number}) => item.chapter <= through), final.drafts.slice(0, through), final.consolidations.filter(item => item.through <= through));
    entities = dataset.summaries.map((item: {entity: string}) => item.entity);
    const stripped = {...dataset, summaries: dataset.summaries.map(({entity: _entity, ...rest}: {entity: string}) => rest)};
    prefixes[String(through)] = createHash("sha256").update(JSON.stringify(stripped)).digest("hex");
}
await writeFile(process.argv[2]!, `${JSON.stringify({source: "w00024 t12 开工前（1d4ad1ffa）的 compile", prefixes, summaryEntities: entities}, null, 1)}\n`);
