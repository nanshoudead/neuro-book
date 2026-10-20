/**
 * 造出“样例书前 N 章已经抽完并提交”的抽取状态，不经模型：用 w00005 t34 的最终草稿
 * （tests/fixtures/ingest/run-med-100-final.json.gz）编译后提交。只回放后面几章的测试（例如服务响应，只回放第 99、
 * 100 章）用它，免得先回放前面几十章。原文是样例书的全部 100 章。
 *
 * t34 的数据不全是新管线能产生的状态，这里按新管线的规则补齐两处，造出的书提交前全书没有错误：
 * - 第 11 章的时间点自相矛盾（凌晨一点半记成当天、却在晚上十一点之后），新管线抽这一章时由兜底丢弃消掉；这里照同样
 *   的兜底处理第 11 章，只编译前 11 章（与当时一样）。
 * - 不带整理稿：t34 的整理稿引用的记录在上面的丢弃之后可能不在了，会连锁出错。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import type {Library} from "../src/core/library";
import {compile, type Issue} from "../src/ingest/compile";
import {checkDraft, dropOffending, type RawDraft} from "../src/ingest/draft-tools";
import type {ExtractionData} from "../src/ingest/job";
import {applyPlan, planFromText} from "../src/ingest/start";
import {IngestStore} from "../src/ingest/store";
import {sampleSourceText} from "./sample";

const FINAL = join(import.meta.dir, "..", "tests", "fixtures", "ingest", "run-med-100-final.json.gz");
const CONTRADICTORY_CHAPTER = 11;

export async function commitFinalPrefix(library: Library, input: {id: string; title: string; through: number}): Promise<void> {
    const store = new IngestStore(library, input.id);
    const lock = await store.tryLock();
    if (!lock) throw new Error(`书 ${input.id} 已有抽取任务在运行`);
    try {
        await applyPlan(library, await planFromText(library, {text: await sampleSourceText(100), title: input.title, id: input.id}));
        const source = (await store.readSource())!;
        const book = {id: source.id, title: source.title};
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: RawDraft[]};
        const drafts = final.drafts.filter(draft => (draft.chapter as number) <= input.through);

        if (input.through >= CONTRADICTORY_CHAPTER) {
            const sources = source.chapters.filter(chapter => chapter.chapter <= CONTRADICTORY_CHAPTER);
            const own = (issues: Issue[]) => issues.filter(issue => issue.level === "error");
            const result = dropOffending(drafts[CONTRADICTORY_CHAPTER - 1]!, candidate => {
                const checked = checkDraft(candidate);
                const errors = own(compile(book, sources, [...drafts.slice(0, CONTRADICTORY_CHAPTER - 1), checked.clean]).issues);
                return {clean: checked.clean, errors: [...checked.problems, ...errors.map(issue => ({message: issue.message, subject: issue}))]};
            });
            if (result.remaining.length) throw new Error(`第 ${CONTRADICTORY_CHAPTER} 章兜底之后仍有问题：${result.remaining.map(problem => problem.message).join("；")}`);
            drafts[CONTRADICTORY_CHAPTER - 1] = result.clean;
        }

        const compiled = compile(book, source.chapters.filter(chapter => chapter.chapter <= input.through), drafts);
        const errors = compiled.issues.filter(issue => issue.level === "error");
        if (errors.length) throw new Error(`造出的前 ${input.through} 章仍有错误：${errors.map(issue => issue.message).join("；")}`);
        const extraction: ExtractionData = {through: input.through, drafts, consolidations: [], chapters: drafts.map(draft => ({chapter: draft.chapter as number, dropped: 0, problems: []}))};
        await library.commitExtraction({id: input.id, title: input.title, generation: undefined, dataset: compiled.dataset, through: input.through, extraction: JSON.stringify(extraction)});
    } finally {
        lock.release();
    }
}
