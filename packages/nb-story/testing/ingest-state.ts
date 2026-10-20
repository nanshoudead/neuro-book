/**
 * 造出“样例书前 N 章已经抽完并提交”的抽取状态，不经模型：w00005 t34 的最终草稿
 * （tests/fixtures/ingest/run-med-100-final.json.gz）按新管线的兜底处理过的版本（prefix-098-fixes.json.gz，由
 * testing/build-prefix-fixes.ts 生成），编译后一次提交。只回放后面几章的测试（例如服务响应，只回放第 99、100 章）
 * 用它，免得先回放前面几十章。原文是样例书的全部 100 章；不带整理稿。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import type {Library} from "../src/core/library";
import {compile} from "../src/ingest/compile";
import type {RawDraft} from "../src/ingest/draft-tools";
import type {ExtractionData} from "../src/ingest/job";
import {applyPlan, planFromText} from "../src/ingest/start";
import {IngestStore} from "../src/ingest/store";
import {sampleSourceText} from "./sample";

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures", "ingest");

async function gunzipJson<T>(name: string): Promise<T> {
    return JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as T;
}

export async function commitFinalPrefix(library: Library, input: {id: string; title: string; through: number}): Promise<void> {
    const fixes = await gunzipJson<{through: number; chapters: Record<string, {dropped: number; draft: RawDraft}>}>("prefix-098-fixes.json.gz");
    if (input.through > fixes.through) throw new Error(`处理过的草稿只到第 ${fixes.through} 章`);
    const store = new IngestStore(library, input.id);
    const lock = await store.tryLock();
    if (!lock) throw new Error(`书 ${input.id} 已有抽取任务在运行`);
    try {
        await applyPlan(library, await planFromText(library, {text: await sampleSourceText(100), title: input.title, id: input.id}));
        const source = (await store.readSource())!;
        const final = await gunzipJson<{drafts: RawDraft[]}>("run-med-100-final.json.gz");
        const drafts = final.drafts.slice(0, input.through).map((draft, index) => fixes.chapters[String(index + 1)]?.draft ?? draft);
        const compiled = compile({id: source.id, title: source.title}, source.chapters.filter(chapter => chapter.chapter <= input.through), drafts);
        const errors = compiled.issues.filter(issue => issue.level === "error");
        if (errors.length) throw new Error(`造出的前 ${input.through} 章仍有错误：${errors.map(issue => issue.message).join("；")}`);
        const chapters = drafts.map((_draft, index) => ({chapter: index + 1, dropped: fixes.chapters[String(index + 1)]?.dropped ?? 0, problems: []}));
        const extraction: ExtractionData = {through: input.through, drafts, consolidations: [], chapters};
        await library.commitExtraction({id: input.id, title: input.title, generation: undefined, dataset: compiled.dataset, through: input.through, extraction: JSON.stringify(extraction)});
    } finally {
        lock.release();
    }
}
