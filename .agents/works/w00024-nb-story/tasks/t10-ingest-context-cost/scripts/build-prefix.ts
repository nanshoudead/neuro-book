/**
 * 长书评估的起点（t10 plan.md“验证”第 3 条）：样例书前 `through` 章按 testing/ingest-state.ts 的做法直接提交（t34 最终
 * 草稿按 prefix-098-fixes 修正过，不带整理稿，全图 0 错误），原文只放前 `total` 章，接着抽时抽到第 `total` 章为止。
 * 用法：bun build-prefix.ts <nb-story 包目录> <书库目录> <through> <total>
 */
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

const [pkg, libraryRoot, throughText, totalText] = process.argv.slice(2);
if (!pkg || !libraryRoot || !throughText || !totalText) throw new Error("用法：bun build-prefix.ts <包目录> <书库目录> <through> <total>");
const through = Number(throughText), total = Number(totalText);
const {Library} = await import(join(pkg, "src/core/library.ts"));
const {compile} = await import(join(pkg, "src/ingest/compile.ts"));
const {applyPlan, planFromText} = await import(join(pkg, "src/ingest/start.ts"));
const {IngestStore} = await import(join(pkg, "src/ingest/store.ts"));
const {sampleSourceText} = await import(join(pkg, "testing/sample.ts"));
const gunzipJson = async (name: string) => JSON.parse(gunzipSync(await readFile(join(pkg, "tests/fixtures/ingest", name))).toString("utf8"));

const library = new Library(libraryRoot);
const id = "long", title = "样例书";
const store = new IngestStore(library, id);
const lock = await store.tryLock();
if (!lock) throw new Error("书已有抽取任务在运行");
try {
    await applyPlan(library, await planFromText(library, {text: await sampleSourceText(total), title, id}));
    const source = (await store.readSource())!;
    const fixes = await gunzipJson("prefix-098-fixes.json.gz");
    const final = await gunzipJson("run-med-100-final.json.gz");
    const drafts = final.drafts.slice(0, through).map((draft: unknown, index: number) => fixes.chapters[String(index + 1)]?.draft ?? draft);
    const compiled = compile({id, title}, source.chapters.filter((chapter: {chapter: number}) => chapter.chapter <= through), drafts);
    const errors = compiled.issues.filter((issue: {level: string}) => issue.level === "error");
    if (errors.length) throw new Error(`前 ${through} 章有 ${errors.length} 个错误`);
    const chapters = drafts.map((_: unknown, index: number) => ({chapter: index + 1, dropped: fixes.chapters[String(index + 1)]?.dropped ?? 0, problems: []}));
    await library.commitExtraction({id, title, generation: undefined, dataset: compiled.dataset, through, extraction: JSON.stringify({through, drafts, consolidations: [], chapters})});
    console.log(`已提交前 ${through} 章（原文 ${source.chapters.length} 章），全图 0 错误`);
} finally {
    lock.release();
}
