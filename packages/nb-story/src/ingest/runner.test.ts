/**
 * 抽取任务与书库（docs/specs/story/ingest.md 输出 1 到 3、6、7、11、13、16、17，验收 1 到 4、8；queries 的“抽取进度”）。
 *
 * 真实的抽取线程（Worker）、真实的书库与查询接口；模型是本机端点回放 w00005 t34 录下的回复。要让任务停在某一步时，
 * 端点对那一步不回应（`hang`），直到请求被取消。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {loadReplay, replay, type ReplayKey, type Replay} from "../../testing/ingest-replay";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {sampleDataset} from "../../testing/sample";
import {createStoryApi} from "../core/api";
import {StoryError} from "../core/errors";
import {Library} from "../core/library";
import {ingestRemoveGuard} from "./guard";
import {startIngest, type Runner} from "./runner";
import {ingestStatus, ingestStatuses} from "./status";

const KEY_ENV = "NBSTORY_INGEST_TEST_KEY";
process.env[KEY_ENV] = "ingest-test-credential";

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * 样例书前 `chapters` 章拼回的原文，前面加一段简介（切章时丢掉）。要抽完的书用 5 或 10 章：末章要整理，录下的整理
 * 回复只有第 5、10 章的。
 */
async function sampleText(chapters: number): Promise<string> {
    const sample = await sampleDataset();
    return `转生反派萝莉，找茬魔法少女\n作者：测试\n\n${sample.sources.slice(0, chapters).map(source => source.paragraphs.join("\n")).join("\n\n")}`;
}

async function setup(name: string, override?: (key: ReplayKey, nth: number) => EndpointReply | undefined) {
    const root = await createTestTmpRoot("nb-story", `ingest-${name}`);
    const runners = new Map<string, Runner>();
    let library!: Library;
    library = new Library(join(root, "library"), {removeGuard: ingestRemoveGuard(() => library, runners)});
    const played: Replay = replay(await loadReplay(), override);
    const endpoint: Endpoint = startEndpoint(played.responder);
    cleanups.push(() => endpoint.stop());
    const api = createStoryApi({library});
    const start = async (input: {text?: string; title?: string; id?: string}) => {
        const result = await startIngest({
            library, ...input, title: input.title ?? "转生反派萝莉，找茬魔法少女",
            endpoint: {baseUrl: endpoint.url, model: "gpt-6-luna", apiKeyEnv: KEY_ENV, maxTokens: 32_000},
            price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"},
            runner: "serve",
        });
        if (result.runner) {
            runners.set(result.runner.id, result.runner);
            const runner = result.runner;
            cleanups.push(async () => {
                runner.stop();
                await runner.done;
            });
        }
        return result;
    };
    return {root, library, api, played, endpoint, start};
}

const hang: EndpointReply = {kind: "hang"};

describe("新建、停止、接着抽（验收 1）", () => {
    test("第 1 章提交书就出现；第 3 章草稿请求中停下：书是 2 章；接着抽到第 10 章，一代不变，阅读状态与问答记录还在", async () => {
        let holdChapter3 = true;
        const env = await setup("resume", key => (holdChapter3 && key.chapter === 3 && key.step === "draft" ? hang : undefined));
        const text = await sampleText(10);
        const first = await env.start({text});
        expect(first.plan.action).toBe("new");
        expect(first.plan.preambleChars).toBeGreaterThan(0);
        const id = first.plan.id;

        // 等到第 3 章的草稿请求挂起，书此时是 2 章。
        await waitUntil("第 3 章草稿请求", () => env.played.seen.some(key => key.chapter === 3 && key.step === "draft"), {timeoutMs: 30_000});
        const listed = await env.api.call("books.list", {});
        expect(listed.ok && listed.value.books.map(book => [book.id, book.chapters])).toEqual([[id, 2]]);
        const generation = listed.ok ? listed.value.books[0]!.generation : "";
        expect((await ingestStatus(env.library, id))?.state).toBe("running");

        first.runner!.stop();
        expect(await first.runner!.done).toEqual({kind: "stopped"});
        const stopped = await ingestStatus(env.library, id);
        expect({state: stopped?.state, reason: stopped?.stopReason, committed: stopped?.committed, total: stopped?.total}).toEqual({state: "stopped", reason: {kind: "user"}, committed: 2, total: 10});

        // 停下期间写阅读状态；接着抽之后它还在。
        const saved = await env.api.call("reading.set", {book: id, position: {chapter: 2}, view: {page: "roster"}});
        expect(saved.ok).toBe(true);

        holdChapter3 = false;
        const second = await env.start({text});
        expect(second.plan.action).toBe("resume");
        expect(await second.runner!.done).toEqual({kind: "done"});
        expect(env.played.unknown).toEqual([]);

        const info = await env.api.call("book.info", {book: id});
        expect(info.ok && {chapters: info.value.chapters, through: info.value.extractedThrough.chapter}).toEqual({chapters: 10, through: 10});
        const books = await env.api.call("books.list", {});
        expect(books.ok && books.value.books[0]!.generation).toBe(generation);
        const reading = await env.api.call("reading.get", {book: id});
        expect(reading.ok && reading.value.view).toEqual({page: "roster"});
        const arcs = await env.api.call("arcs.list", {book: id});
        expect(arcs.ok && arcs.value.arcs.length).toBeGreaterThan(0);

        const done = await ingestStatus(env.library, id);
        expect({state: done?.state, committed: done?.committed, chapters: done?.chapters.length, complete: done?.allRuns.complete}).toEqual({state: "done", committed: 10, chapters: 10, complete: false});
        expect(done?.allRuns.cost).toBeGreaterThan(0);
    }, 120_000);
});

describe("追加、改稿、第 1 章前停下（验收 2）", () => {
    test("5 章抽完后追加到 10 章：第 5 章那批整理与对象不变、不再请求；改了第 2 章：ingest_text_changed；原样再交：done", async () => {
        const env = await setup("append");
        const five = await env.start({text: await sampleText(5)});
        expect(await five.runner!.done).toEqual({kind: "done"});
        const id = five.plan.id;
        const arcsAt5 = await env.api.call("arcs.list", {book: id, at: {chapter: 5}});
        const entitiesAt5 = await env.api.call("entities.list", {book: id, at: {chapter: 5}, limit: 500});

        const ten = await env.start({text: await sampleText(10)});
        expect({action: ten.plan.action, newChapters: ten.plan.newChapters}).toEqual({action: "append", newChapters: 5});
        expect(await ten.runner!.done).toEqual({kind: "done"});
        expect(env.played.seen.filter(key => key.step === "consolidation").map(key => key.chapter)).toEqual([5, 10]);
        expect(await env.api.call("arcs.list", {book: id, at: {chapter: 5}})).toEqual(arcsAt5);
        expect(await env.api.call("entities.list", {book: id, at: {chapter: 5}, limit: 500})).toEqual(entitiesAt5);

        const sample = await sampleDataset();
        const changed = (await sampleText(10)).replace(sample.sources[1]!.paragraphs[3]!, `${sample.sources[1]!.paragraphs[3]!}（改）`);
        const refused = await env.start({text: changed}).catch((error: unknown) => error);
        expect(refused instanceof StoryError && refused.code).toBe("ingest_text_changed");
        expect(refused instanceof StoryError && refused.message).toContain("第 2 章与已保存的不一样（第 4 段起不同）");

        const requests = env.played.seen.length;
        const again = await env.start({text: await sampleText(10)});
        expect({action: again.plan.action, runner: again.runner}).toEqual({action: "done", runner: null});
        expect(env.played.seen.length).toBe(requests);
    }, 120_000);

    test("第 1 章前停下：书库里没有书、进度列出它、id 被占用、再发起是 resume、能删除", async () => {
        const env = await setup("before-first", key => (key.chapter === 1 && key.step === "beats" ? hang : undefined));
        const first = await env.start({text: await sampleText(3), title: "第一章前停下", id: "early"});
        await waitUntil("第 1 章段落块请求", () => env.played.seen.length > 0, {timeoutMs: 30_000});
        first.runner!.stop();
        await first.runner!.done;

        const listed = await env.api.call("books.list", {});
        expect(listed.ok && listed.value.books).toEqual([]);
        expect((await ingestStatuses(env.library)).map(status => [status.id, status.state, status.committed])).toEqual([["early", "stopped", 0]]);
        const imported = await env.library.importBook({file: join(env.root, "none.json"), title: "x", id: "early"}).catch((error: unknown) => error);
        expect(imported instanceof StoryError && imported.code).toBe("book_exists");

        const second = await env.start({id: "early"});
        expect(second.plan.action).toBe("resume");
        second.runner!.stop();
        await second.runner!.done;
        await env.library.removeBook("early");
        expect(await ingestStatuses(env.library)).toEqual([]);
        const third = await env.start({text: await sampleText(3), title: "第一章前停下", id: "early"});
        expect(third.plan.action).toBe("new");
    }, 120_000);
});

describe("抽取进度与查询（验收 3）", () => {
    test("提交后旧游标得到 cursor_invalid；提交前固定的会话仍读到旧数据，提交后新开始的查询读到新数据", async () => {
        let hold = true;
        const env = await setup("cursor", key => (hold && key.chapter === 3 && key.step === "beats" ? hang : undefined));
        const run = await env.start({text: await sampleText(5)});
        const id = run.plan.id;
        await waitUntil("第 3 章段落块请求", () => env.played.seen.some(key => key.chapter === 3), {timeoutMs: 30_000});
        const page = await env.api.call("entities.list", {book: id, limit: 2});
        expect(page.ok && page.value.next).not.toBeNull();
        const session = await env.api.openBook(id);
        run.runner!.stop();
        await run.runner!.done;

        hold = false;
        const resumed = await env.start({id});
        expect(await resumed.runner!.done).toEqual({kind: "done"});
        const next = await env.api.call("entities.list", {book: id, limit: 2, cursor: page.ok ? page.value.next! : ""});
        expect(!next.ok && next.error.code).toBe("cursor_invalid");
        const pinned = await session.call("book.info", {});
        expect(pinned.ok && pinned.value.chapters).toBe(2);
        const fresh = await createStoryApi({library: new Library(env.library.root)}).call("book.info", {book: id});
        expect(fresh.ok && fresh.value.chapters).toBe(5);
    }, 120_000);

    test("提交写到一半（新版本的文件写好、book.json 没换）：查询与接着抽都按上一次提交，接着抽照常完成", async () => {
        let hold = true;
        const env = await setup("half-commit", key => (hold && key.chapter === 3 && key.step === "beats" ? hang : undefined));
        const run = await env.start({text: await sampleText(5)});
        const id = run.plan.id;
        await waitUntil("第 3 章段落块请求", () => env.played.seen.some(key => key.chapter === 3), {timeoutMs: 30_000});
        run.runner!.stop();
        await run.runner!.done;
        // 造出“第 3 章提交到一半被杀”留下的样子：下一版的数据文件与抽取数据已写好，book.json 的临时文件也在，只差改名。
        const dir = env.library.bookDir(id);
        await writeFile(join(dir, "graph-3.json"), "{\"半份\":true}");
        await writeFile(join(dir, "extraction-3.json"), "{\"半份\":true}");
        await writeFile(join(dir, "book.json.leftover.tmp"), "{}");
        const info = await env.api.call("book.info", {book: id});
        expect(info.ok && info.value.chapters).toBe(2);
        expect((await ingestStatus(env.library, id))?.committed).toBe(2);

        hold = false;
        const resumed = await env.start({id});
        expect(await resumed.runner!.done).toEqual({kind: "done"});
        const after = await env.api.call("book.info", {book: id});
        expect(after.ok && after.value.chapters).toBe(5);
        expect((await readdir(dir)).filter(name => name.startsWith("graph-") || name.startsWith("extraction-")).sort()).toEqual(["extraction-5.json", "graph-5.json"]);
    }, 120_000);
});

describe("一个书 id 一个任务（验收 4）", () => {
    test("运行中再发起同一个 id：ingest_running；同时发起两次恰有一个开始", async () => {
        const env = await setup("single", key => (key.chapter === 1 ? hang : undefined));
        const text = await sampleText(2);
        const outcomes = await Promise.allSettled([env.start({text}), env.start({text})]);
        expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
        expect(rejected.reason instanceof StoryError && rejected.reason.code).toBe("ingest_running");
        const again = await env.start({text}).catch((error: unknown) => error);
        expect(again instanceof StoryError && again.code).toBe("ingest_running");
    }, 60_000);

    test("强行结束运行任务的进程：进度报“运行它的进程已退出”，可以接着抽；别的进程在抽时删除得到 ingest_running", async () => {
        const env = await setup("killed", key => (key.chapter === 2 && key.step === "beats" ? hang : undefined));
        const file = join(env.root, "book.txt");
        await writeFile(file, await sampleText(3));
        const child = Bun.spawn(["bun", join(import.meta.dir, "..", "..", "testing", "ingest-child.ts"), env.library.root, file, "子进程里抽", env.endpoint.url], {
            stdout: "pipe", stderr: "pipe", env: {...process.env, INGEST_CHILD_KEY: "k"},
        });
        cleanups.push(() => child.kill("SIGKILL"));
        await waitUntil("子进程等在第 2 章", () => env.played.seen.some(key => key.chapter === 2), {timeoutMs: 30_000});
        const id = (await ingestStatuses(env.library))[0]!.id;
        expect((await ingestStatus(env.library, id))?.runner).toBe("cli");

        const removed = await env.library.removeBook(id).catch((error: unknown) => error);
        expect(removed instanceof StoryError && removed.code).toBe("ingest_running");
        expect((await env.api.call("book.info", {book: id})).ok).toBe(true);

        child.kill("SIGKILL");
        await child.exited;
        const status = await ingestStatus(env.library, id);
        expect({state: status?.state, reason: status?.stopReason, committed: status?.committed}).toEqual({state: "stopped", reason: {kind: "exited"}, committed: 1});
    }, 60_000);
});

describe("删除正在抽取的书（验收 8）", () => {
    test("本服务里的任务先停下再删；书与抽取记录都不在了，旧任务不再写回；同 id 再发起是 new", async () => {
        const env = await setup("remove", key => (key.chapter === 2 && key.step === "draft" ? hang : undefined));
        const run = await env.start({text: await sampleText(3), id: "doomed", title: "要删的书"});
        await waitUntil("第 2 章草稿请求", () => env.played.seen.some(key => key.chapter === 2 && key.step === "draft"), {timeoutMs: 30_000});
        await env.library.removeBook("doomed");
        expect(await run.runner!.done).toEqual({kind: "stopped"});
        expect(await ingestStatuses(env.library)).toEqual([]);
        const listed = await env.api.call("books.list", {});
        expect(listed.ok && listed.value.books).toEqual([]);
        expect((await readdir(env.library.root)).filter(name => !name.startsWith("."))).toEqual(["library.json"]);
        const again = await env.start({text: await sampleText(3), id: "doomed", title: "要删的书"});
        expect(again.plan.action).toBe("new");
    }, 60_000);
});

describe("导入与抽取争同一个 id（输出 1）", () => {
    test("导入数据文件得来的书不能抽取，也不留下抽取记录", async () => {
        const env = await setup("conflict");
        const sample = await sampleDataset();
        const file = join(env.root, "graph.json");
        await writeFile(file, JSON.stringify(sample));
        await env.library.importBook({file, title: "导入的书", id: "imported"});
        const refused = await env.start({text: await sampleText(2), id: "imported"}).catch((error: unknown) => error);
        expect(refused instanceof StoryError && refused.code).toBe("book_exists");
        expect(await ingestStatuses(env.library)).toEqual([]);
    }, 60_000);
});
