/**
 * 生成 tests/fixtures/ingest/prefix-098-fixes.json.gz：把 w00005 t34 的前 N 章最终草稿照新管线的兜底逐章处理一遍，
 * 只记下有改动的章（testing/ingest-state.ts 用它造“前 N 章已提交”的书）。
 *
 * 为什么要处理：t34 的旧管线不要求提交时全书没有错误，它的草稿里有时间点自相矛盾（第 11 章起）与随之的引用缺失；
 * 新管线抽第 k 章时编译前 k 章，归到本章的错误由兜底丢弃（src/ingest/chapter.ts 的 dropOffending）消掉。这里照做，
 * 不调用模型，也不带整理稿（t34 的整理稿引用的记录可能已被丢掉）。
 *
 * 运行：`bun testing/build-prefix-fixes.ts [N]`（N 默认 98），在本机约 50 分钟。改了编译或兜底规则后要重新生成。
 */

import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync, gzipSync} from "node:zlib";

import {compile, type Issue} from "../src/ingest/compile";
import {checkDraft, dropOffending, type RawDraft} from "../src/ingest/draft-tools";
import {splitChapters} from "../src/ingest/text";
import {sampleSourceText} from "./sample";

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures", "ingest");
const through = Number(process.argv[2] ?? 98);
const final = JSON.parse(gunzipSync(await readFile(join(FIXTURES, "run-med-100-final.json.gz"))).toString("utf8")) as {drafts: RawDraft[]};
const all = splitChapters(await sampleSourceText(100)).chapters;
const book = {id: "prefix", title: "prefix"};
const chapterOfId = (id: string) => Number(/^[a-z]+(\d+)-/u.exec(id)?.[1] ?? Number.NaN);

const drafts: RawDraft[] = [];
const changed: Record<string, {dropped: number; draft: RawDraft}> = {};
for (let chapter = 1; chapter <= through; chapter++) {
    const sources = all.filter(item => item.chapter <= chapter);
    // 与 chapter.ts 的 chapterIssues 相同：本章的错误，加上点到本章记录的全书错误。
    const own = (issues: Issue[]) => issues.filter(issue => issue.level === "error" && (issue.chapter === chapter || (issue.chapter === null && (issue.records ?? []).some(id => chapterOfId(id) === chapter))));
    const evaluate = (candidate: RawDraft) => {
        const checked = checkDraft(candidate);
        return {clean: checked.clean, errors: [...checked.problems, ...own(compile(book, sources, [...drafts, checked.clean]).issues).map(issue => ({message: issue.message, subject: issue}))]};
    };
    const original = final.drafts[chapter - 1]!;
    const first = evaluate(original);
    let clean = first.clean;
    let dropped = 0;
    if (first.errors.length) {
        const result = dropOffending(original, evaluate);
        if (result.remaining.length) throw new Error(`第 ${chapter} 章兜底之后仍有问题：${result.remaining.map(problem => problem.message).join("；")}`);
        clean = result.clean;
        dropped = result.dropped;
    }
    drafts.push(clean);
    if (JSON.stringify(clean) !== JSON.stringify(original)) changed[String(chapter)] = {dropped, draft: clean};
    process.stdout.write(`第 ${chapter} 章：丢弃 ${dropped}\n`);
}
await writeFile(join(FIXTURES, `prefix-${String(through).padStart(3, "0")}-fixes.json.gz`), gzipSync(JSON.stringify({through, chapters: changed}), {level: 9}));
