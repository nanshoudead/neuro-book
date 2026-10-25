/**
 * 抽取任务与书库（docs/specs/story/ingest.md 输出 1 到 3、6、7、11、13、16、17，验收 1 到 4、8；queries 的“抽取进度”）。
 *
 * 真实的抽取线程（Worker）、真实的书库与查询接口；模型是本机端点回放 w00005 t34 录下的回复。要让任务停在某一步时，
 * 端点对那一步不回应（`hang`），直到请求被取消。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {mkdirSync, watch, writeFileSync} from "node:fs";
import {mkdir, readdir, readFile, rm, rmdir, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {loadReplay, replay, type ReplayKey, type Replay} from "../../testing/ingest-replay";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {sampleDataset, sampleSourceText} from "../../testing/sample";
import {createStoryApi} from "../core/api";
import {StoryError} from "../core/errors";
import {Library} from "../core/library";
import {readCommitted} from "./job";
import {ingestCoordinator, runnerTable} from "./coordinator";
import {startIngest, type Runner} from "./runner";
import {BAD_REPLY_KEEP, IngestStore} from "./store";
import {ingestStatus, ingestStatuses} from "./status";

const KEY_ENV = "NBSTORY_INGEST_TEST_KEY";
process.env[KEY_ENV] = "ingest-test-credential";

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(name: string, override?: (key: ReplayKey, nth: number) => EndpointReply | undefined) {
    const root = await createTestTmpRoot("nb-story", `ingest-${name}`);
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    const runners = new Map<string, Runner>();
    let library!: Library;
    library = new Library(join(root, "library"), {coordinator: ingestCoordinator(() => library, runnerTable(runners))});
    const played: Replay = replay(await loadReplay(), override);
    /** 每次请求的用户消息，与 `played.seen` 一一对应。 */
    const users: string[] = [];
    const endpoint: Endpoint = startEndpoint((body, index, headers) => {
        users.push((body.messages as {content: string}[])[1]!.content);
        return played.responder(body, index, headers);
    });
    cleanups.push(() => endpoint.stop());
    const api = createStoryApi({library});
    /** `recall` 给了就开挑相关说法：用同一个端点、另一个模型名与币种，记账看得出是哪一步。 */
    const start = async (input: {text?: string; title?: string; id?: string; currency?: string; recall?: boolean}) => {
        const {currency, recall, ...rest} = input;
        const result = await startIngest({
            library, ...rest, title: input.title ?? "转生反派萝莉，找茬魔法少女",
            endpoint: {baseUrl: endpoint.url, model: "gpt-6-luna", apiKeyEnv: KEY_ENV, maxTokens: 32_000},
            price: {input: 1, output: 4, cacheRead: 0.02, currency: currency ?? "CNY"},
            recall: recall ? {endpoint: {baseUrl: endpoint.url, model: "recall-model", apiKeyEnv: KEY_ENV, maxTokens: 4_000}, price: {input: 0.5, output: 1, currency: "USD"}} : null,
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
    return {root, library, api, played, users, endpoint, start};
}

const hang: EndpointReply = {kind: "hang"};

describe("新建、停止、接着抽（验收 1）", () => {
    test("第 1 章提交书就出现；第 3 章草稿请求中停下：书是 2 章；接着抽到第 10 章，一代不变，阅读状态与问答记录还在", async () => {
        let holdChapter3 = true;
        const env = await setup("resume", key => (holdChapter3 && key.chapter === 3 && key.step === "draft" ? hang : undefined));
        const text = await sampleSourceText(10);
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
        expect(done?.allRuns.costs.map(cost => cost.currency)).toEqual(["CNY"]);
        expect(done?.allRuns.costs[0]!.amount).toBeGreaterThan(0);
    }, 120_000);
});

describe("挑相关说法开着（输出 4、13）", () => {
    test("每章先挑选；结果随章保存；挑选的用量按它自己的模型与单价记；第 3 章草稿请求中停下，接着抽时这一章重新挑选", async () => {
        let holdChapter3 = true;
        const env = await setup("recall", key => {
            if (key.step === "recall") return {kind: "text", text: JSON.stringify({ids: []})};
            return holdChapter3 && key.chapter === 3 && key.step === "draft" ? hang : undefined;
        });
        // 5 章：末章要整理，录下的整理在第 5 章。
        const text = await sampleSourceText(5);
        const first = await env.start({text, recall: true});
        await waitUntil("第 3 章草稿请求", () => env.played.seen.some(key => key.chapter === 3 && key.step === "draft"), {timeoutMs: 30_000});
        first.runner!.stop();
        expect(await first.runner!.done).toEqual({kind: "stopped"});
        holdChapter3 = false;
        const second = await env.start({text, recall: true});
        expect(await second.runner!.done).toEqual({kind: "done"});
        expect(env.played.unknown).toEqual([]);

        // 第 1 章没有已提交的记录可挑，不发挑选请求；第 3 章两次尝试各挑一次。
        expect(env.played.seen.filter(key => key.step === "recall").map(key => key.chapter)).toEqual([2, 3, 3, 4, 5]);
        const {data} = await readCommitted(env.library, first.plan.id);
        expect(data.chapters.map(chapter => chapter.recall)).toEqual([{source: "none", ids: []}, ...Array(4).fill({source: "model", ids: []})]);
        const status = await ingestStatus(env.library, first.plan.id);
        expect(status?.allRuns.costs.map(cost => cost.currency).sort()).toEqual(["CNY", "USD"]);
    }, 120_000);
});

describe("追加、改稿、第 1 章前停下（验收 2）", () => {
    test("5 章抽完后追加到 10 章：第 5 章那批整理与对象不变、不再请求；改了第 2 章：ingest_text_changed；原样再交：done", async () => {
        const env = await setup("append");
        const five = await env.start({text: await sampleSourceText(5)});
        expect(await five.runner!.done).toEqual({kind: "done"});
        const id = five.plan.id;
        const arcsAt5 = await env.api.call("arcs.list", {book: id, at: {chapter: 5}});
        const entitiesAt5 = await env.api.call("entities.list", {book: id, at: {chapter: 5}, limit: 500});

        const ten = await env.start({text: await sampleSourceText(10)});
        expect({action: ten.plan.action, newChapters: ten.plan.newChapters}).toEqual({action: "append", newChapters: 5});
        expect(await ten.runner!.done).toEqual({kind: "done"});
        expect(env.played.seen.filter(key => key.step === "consolidation").map(key => key.chapter)).toEqual([5, 10]);
        expect(await env.api.call("arcs.list", {book: id, at: {chapter: 5}})).toEqual(arcsAt5);
        expect(await env.api.call("entities.list", {book: id, at: {chapter: 5}, limit: 500})).toEqual(entitiesAt5);

        const sample = await sampleDataset();
        const changed = (await sampleSourceText(10)).replace(sample.sources[1]!.paragraphs[3]!, `${sample.sources[1]!.paragraphs[3]!}（改）`);
        const refused = await env.start({text: changed}).catch((error: unknown) => error);
        expect(refused instanceof StoryError && refused.code).toBe("ingest_text_changed");
        expect(refused instanceof StoryError && refused.message).toContain("第 2 章与已保存的不一样（第 4 段起不同）");

        const requests = env.played.seen.length;
        const again = await env.start({text: await sampleSourceText(10)});
        expect({action: again.plan.action, runner: again.runner}).toEqual({action: "done", runner: null});
        expect(env.played.seen.length).toBe(requests);
    }, 120_000);

    test("末章不是 5 的倍数、中间有整理被跳过：短书照旧全量整理，跳过不影响下一次，追加后新末章另整理一次（输出 4、7）", async () => {
        // 第 5 章的整理两次都不成形，跳过；7 章的末章整理归一条主线；追加到 10 章后第 10 章用录下的回复。
        const seventh = {through: 7, arcs: [{id: "a7-1", title: "苏天晴用陷阱制住风信子", summary: "苏天晴布下定身陷阱，制住风信子并录下视频。", episodes: ["p6-1", "p7-1", "p7-2"], status: "ongoing"}]};
        const env = await setup("append-odd", key => (key.step !== "consolidation" ? undefined : key.chapter === 5 ? {kind: "text", text: "整理不了。"} : key.chapter === 7 ? {kind: "text", text: JSON.stringify(seventh)} : undefined));
        const seven = await env.start({text: await sampleSourceText(7)});
        expect(await seven.runner!.done).toEqual({kind: "done"});
        const ten = await env.start({text: await sampleSourceText(10)});
        expect(await ten.runner!.done).toEqual({kind: "done"});

        // 全量材料远在上限内：三次都是全量的写法，存下的是整批稿（没有 base）。
        const consolidationUsers = env.played.seen.flatMap((key, index) => (key.step === "consolidation" ? [env.users[index]!] : []));
        expect(consolidationUsers.length).toBe(4);
        expect(consolidationUsers.every(user => user.includes("【各情节的概括】"))).toBe(true);
        const {data} = await readCommitted(env.library, seven.plan.id);
        expect(data.consolidations.map(item => [(item as {through: number}).through, (item as {base?: number}).base])).toEqual([[7, undefined], [10, undefined]]);
        expect(data.chapters.find(item => item.chapter === 5)!.problems.join("")).toContain("整理跳过");
        const arcsAt = async (chapter: number) => {
            const arcs = await env.api.call("arcs.list", {book: seven.plan.id, at: {chapter}});
            return arcs.ok ? [arcs.value.through, arcs.value.arcs.map(item => item.id)] : null;
        };
        expect(await arcsAt(7)).toEqual([7, ["a7-1"]]);
        expect((await arcsAt(10))?.[0]).toBe(10);
    }, 120_000);

    test("第 1 章前停下：书库里没有书、进度列出它、id 被占用、再发起是 resume、能删除", async () => {
        const env = await setup("before-first", key => (key.chapter === 1 && key.step === "beats" ? hang : undefined));
        const first = await env.start({text: await sampleSourceText(3), title: "第一章前停下", id: "early"});
        await waitUntil("第 1 章段落块请求", () => env.played.seen.length > 0, {timeoutMs: 30_000});
        first.runner!.stop();
        await first.runner!.done;

        const listed = await env.api.call("books.list", {});
        expect(listed.ok && listed.value.books).toEqual([]);
        expect((await ingestStatuses(env.library)).map(status => [status.id, status.state, status.committed])).toEqual([["early", "stopped", 0]]);
        const file = join(env.root, "graph.json");
        await writeFile(file, JSON.stringify(await sampleDataset()));
        const imported = await env.library.importBook({file, title: "x", id: "early"}).catch((error: unknown) => error);
        expect(imported instanceof StoryError && imported.code).toBe("book_exists");

        const second = await env.start({id: "early"});
        expect(second.plan.action).toBe("resume");
        second.runner!.stop();
        await second.runner!.done;
        await env.library.removeBook("early");
        expect(await ingestStatuses(env.library)).toEqual([]);
        const third = await env.start({text: await sampleSourceText(3), title: "第一章前停下", id: "early"});
        expect(third.plan.action).toBe("new");
    }, 120_000);
});

describe("抽取进度与查询（验收 3）", () => {
    test("提交后旧游标得到 cursor_invalid；提交前固定的会话仍读到旧数据，提交后新开始的查询读到新数据", async () => {
        let hold = true;
        const env = await setup("cursor", key => (hold && key.chapter === 3 && key.step === "beats" ? hang : undefined));
        const run = await env.start({text: await sampleSourceText(5)});
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
        const run = await env.start({text: await sampleSourceText(5)});
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
        const text = await sampleSourceText(2);
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
        await writeFile(file, await sampleSourceText(3));
        const child = Bun.spawn(["bun", join(import.meta.dir, "..", "..", "testing", "ingest-child.ts"), env.library.root, file, "子进程里抽", env.endpoint.url], {
            stdout: "pipe", stderr: "pipe", env: {...process.env, INGEST_CHILD_KEY: "k"},
        });
        cleanups.push(async () => {
            child.kill("SIGKILL");
            await child.exited;
        });
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
        // 第 2 章那个请求发出过、用量不知道：合计标为不完整，而不是当它没发生（输出 13）。
        expect({thisRun: status?.thisRun.complete, allRuns: status?.allRuns.complete}).toEqual({thisRun: false, allRuns: false});
        expect(status?.thisRun.input).toBeGreaterThan(0);
    }, 60_000);
});

describe("删除正在抽取的书（验收 8）", () => {
    test("本服务里的任务先停下再删；书与抽取记录都不在了，旧任务不再写回；同 id 再发起是 new", async () => {
        const env = await setup("remove", key => (key.chapter === 2 && key.step === "draft" ? hang : undefined));
        const run = await env.start({text: await sampleSourceText(3), id: "doomed", title: "要删的书"});
        await waitUntil("第 2 章草稿请求", () => env.played.seen.some(key => key.chapter === 2 && key.step === "draft"), {timeoutMs: 30_000});
        await env.library.removeBook("doomed");
        expect(await run.runner!.done).toEqual({kind: "stopped"});
        expect(await ingestStatuses(env.library)).toEqual([]);
        const listed = await env.api.call("books.list", {});
        expect(listed.ok && listed.value.books).toEqual([]);
        expect((await readdir(env.library.root)).filter(name => !name.startsWith("."))).toEqual(["library.json"]);
        const again = await env.start({text: await sampleSourceText(3), id: "doomed", title: "要删的书"});
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
        const refused = await env.start({text: await sampleSourceText(2), id: "imported"}).catch((error: unknown) => error);
        expect(refused instanceof StoryError && refused.code).toBe("book_exists");
        expect(await ingestStatuses(env.library)).toEqual([]);
    }, 60_000);
});

describe("发起前的检查（输出 1、F1）", () => {
    test("书库格式不认识：unsupported_format，不写任何文件、不发请求", async () => {
        const env = await setup("unknown-format");
        await mkdir(env.library.root, {recursive: true});
        await writeFile(join(env.library.root, "library.json"), JSON.stringify({format: 99}));
        for (const input of [{text: await sampleSourceText(2)}, {id: "some-book"}]) {
            const refused = await env.start(input).catch((error: unknown) => error);
            expect(refused instanceof StoryError && refused.code).toBe("unsupported_format");
        }
        expect(await readdir(env.library.root)).toEqual(["library.json"]);
        expect(env.played.seen).toEqual([]);
    }, 60_000);

    test("书 id 不合法（带路径）：invalid_params，书库内外都不留文件", async () => {
        const env = await setup("bad-id");
        for (const input of [{text: await sampleSourceText(2), id: "../../escaped"}, {id: "../../escaped"}, {id: "Upper"}]) {
            const refused = await env.start(input).catch((error: unknown) => error);
            expect(refused instanceof StoryError && refused.code).toBe("invalid_params");
        }
        const files = await readdir(env.root, {recursive: true});
        expect(files.filter(name => name.includes("escaped") || name.endsWith(".lock"))).toEqual([]);
        expect(env.played.seen).toEqual([]);
    }, 60_000);
});

describe("导入与抽取同时争同一个 id（输出 1）", () => {
    test("恰有一方成功；抽取赢时，导入的书一刻也没有出现在书库里", async () => {
        const env = await setup("id-race", () => hang);
        const sample = await sampleDataset();
        const file = join(env.root, "graph.json");
        await writeFile(file, JSON.stringify(sample));
        const text = await sampleSourceText(2);
        for (let round = 0; round < 6; round++) {
            const id = `race-${round}`;
            let settled = false;
            const titles = new Set<string>();
            // 争抢期间不停地读这个 id 的书：导入输掉时，它的书名不该被任何一次读到。
            const probe = (async () => {
                while (!settled) {
                    const meta = await env.library.readMeta(id).catch(() => null);
                    if (meta) titles.add(meta.title);
                }
            })();
            const [ingest, imported] = await Promise.allSettled([env.start({text, id, title: "抽取的书"}), env.library.importBook({file, title: "导入的书", id})]);
            settled = true;
            await probe;
            expect([ingest.status, imported.status].filter(status => status === "fulfilled")).toHaveLength(1);
            if (ingest.status === "fulfilled") {
                const reason = (imported as PromiseRejectedResult).reason;
                expect(reason instanceof StoryError && reason.code).toBe("book_exists");
                expect([...titles]).toEqual([]);
                ingest.value.runner!.stop();
                await ingest.value.runner!.done;
            } else {
                expect(ingest.reason instanceof StoryError && ingest.reason.code).toBe("book_exists");
                expect(await env.library.hasIngest(id)).toBe(false);
            }
        }
        expect((await readdir(env.library.root)).filter(name => name.startsWith(".importing-"))).toEqual([]);
    }, 120_000);
});

describe("删除撞上第 1 章的提交（验收 8）", () => {
    test("第 1 章正在发布时删除：删除完成后书与抽取记录都不在，任务停下", async () => {
        for (let round = 0; round < 3; round++) {
            const env = await setup(`remove-first-${round}`, key => (key.chapter === 2 ? hang : undefined));
            await mkdir(env.library.root, {recursive: true});
            let removal: Promise<unknown> | null = null;
            // 看到第 1 章的发布目录就删除：这时任务已过了提交前的停止检查，删除要等它发布完再删掉整本书。
            const watcher = watch(env.library.root, (_event, name) => {
                if (removal === null && name?.startsWith(".importing-")) removal = env.library.removeBook("first").catch((error: unknown) => error);
            });
            cleanups.push(() => watcher.close());
            const run = await env.start({text: await sampleSourceText(5), id: "first", title: "删掉"});
            await waitUntil("删除发起", () => removal !== null, {timeoutMs: 30_000});
            expect(await removal).toBeUndefined();
            expect(await run.runner!.done).toEqual({kind: "stopped"});
            const listed = await env.api.call("books.list", {});
            expect(listed.ok && listed.value.books).toEqual([]);
            expect(await ingestStatuses(env.library)).toEqual([]);
            expect((await readdir(env.library.root)).filter(name => !name.startsWith("."))).toEqual(["library.json"]);
        }
    }, 120_000);
});

describe("提交的先后（输出 6）", () => {
    test("新版本的数据写不进去：book.json 不换，查询与进度仍是上一章；去掉障碍后接着抽完", async () => {
        let blocker: string | null = null;
        let env!: Awaited<ReturnType<typeof setup>>;
        env = await setup("commit-order", key => {
            // 第 3 章一开始就在书目录里放一个与第 3 版抽取数据同名的目录：提交写到这个文件时失败。
            if (blocker === null && key.chapter === 3) {
                blocker = join(env.library.bookDir("order"), "extraction-3.json");
                mkdirSync(blocker);
            }
            return undefined;
        });
        const run = await env.start({text: await sampleSourceText(5), id: "order", title: "提交顺序"});
        const outcome = await run.runner!.done;
        expect(outcome.kind === "failed" && outcome.errorKind).toBe("local");
        const info = await env.api.call("book.info", {book: "order"});
        expect(info.ok && {chapters: info.value.chapters, through: info.value.extractedThrough.chapter}).toEqual({chapters: 2, through: 2});
        expect((await ingestStatus(env.library, "order"))?.committed).toBe(2);

        await rmdir(blocker!);
        const resumed = await env.start({id: "order"});
        expect(await resumed.runner!.done).toEqual({kind: "done"});
        const after = await env.api.call("book.info", {book: "order"});
        expect(after.ok && after.value.chapters).toBe(5);
        expect((await readdir(env.library.bookDir("order"))).filter(name => name.startsWith("graph-") || name.startsWith("extraction-")).sort()).toEqual(["extraction-5.json", "graph-5.json"]);
    }, 120_000);

    test("一边连续提交一边读抽取数据：每次都读到某一次完整的提交，不撞上被回收的旧文件", async () => {
        const env = await setup("read-race");
        const sample = await sampleDataset();
        const extraction = (through: number) => JSON.stringify({through, drafts: [], consolidations: [], chapters: []});
        const first = await env.library.commitExtraction({id: "race", title: "读写", generation: undefined, dataset: sample, through: 1, extraction: extraction(1)});
        let writing = true;
        const failures: unknown[] = [];
        let reads = 0;
        const reader = (async () => {
            while (writing) {
                await readCommitted(env.library, "race").then(read => {
                    reads += 1;
                    if (typeof read.data.through !== "number") failures.push(read);
                }, (error: unknown) => failures.push(error));
            }
        })();
        for (let through = 2; through <= 150; through++) {
            await env.library.commitExtraction({id: "race", title: "读写", generation: first.generation, dataset: sample, through, extraction: extraction(through)});
        }
        writing = false;
        await reader;
        expect(failures).toEqual([]);
        expect(reads).toBeGreaterThan(0);
        expect((await readCommitted(env.library, "race")).data.through).toBe(150);
    }, 120_000);
});

const TEN_MINUTES = 600_000;

describe("坏回复留存（输出 10）", () => {
    const BAD = "不是 JSON 的回复，里面有小说片段：星月狐";
    const badDir = (env: Awaited<ReturnType<typeof setup>>, id: string) => join(env.root, "library", ".ingest", id, "bad-replies");

    test("写其余记录两次不成形：任务以 ingest_bad_reply 停下，两次回复的原文留在书库里，错误信息写路径，状态与输出里没有原文", async () => {
        const env = await setup("bad-draft", key => (key.chapter === 2 && key.step === "draft" ? {kind: "text", text: BAD} : undefined));
        const run = await env.start({text: await sampleSourceText(3), id: "bad-draft"});
        const outcome = await run.runner!.done;
        expect(outcome.kind === "failed" && outcome.code).toBe("ingest_bad_reply");
        expect(outcome.kind === "failed" && outcome.message).toContain(".ingest/bad-draft/bad-replies/2-draft.json");

        const saved = JSON.parse(await readFile(join(badDir(env, "bad-draft"), "2-draft.json"), "utf8"));
        expect(saved).toMatchObject({chapter: 2, step: "draft", why: "回复不是 JSON"});
        expect(saved.replies.map((reply: {round: number; text: string}) => [reply.round, reply.text])).toEqual([[1, BAD], [2, BAD]]);
        expect(JSON.stringify(await ingestStatus(env.library, "bad-draft"))).not.toContain("星月狐");
    }, 120_000);

    test("整理两次不成形（容错：这一章照常提交）：原文照样留下，提交之后也还在", async () => {
        const env = await setup("bad-consolidation", key => (key.chapter === 5 && key.step === "consolidation" ? {kind: "text", text: BAD} : undefined));
        const run = await env.start({text: await sampleSourceText(5), id: "bad-consolidation"});
        expect(await run.runner!.done).toEqual({kind: "done"});
        const saved = JSON.parse(await readFile(join(badDir(env, "bad-consolidation"), "5-consolidation.json"), "utf8"));
        expect(saved.replies).toHaveLength(2);
        const {data} = await readCommitted(env.library, "bad-consolidation");
        expect(data.chapters.find(item => item.chapter === 5)!.problems.join("")).toContain("bad-replies/5-consolidation.json");
    }, 120_000);

    test("留不下来（目录被同名文件占着）：抽取照样以 ingest_bad_reply 停下，错误信息里没有路径", async () => {
        // 第一次请求到达时抽取记录目录已经建好：在里面放一个同名文件，`bad-replies/` 就建不出来。
        let blocked = false;
        const env = await setup("bad-unwritable", key => {
            if (key.chapter !== 1 || key.step !== "beats") return undefined;
            if (!blocked) {
                blocked = true;
                writeFileSync(join(badDir(env, "bad-unwritable")), "占位");
            }
            return {kind: "text", text: BAD};
        });
        const run = await env.start({text: await sampleSourceText(3), id: "bad-unwritable"});
        const outcome = await run.runner!.done;
        expect(outcome.kind === "failed" && outcome.code).toBe("ingest_bad_reply");
        expect(outcome.kind === "failed" && outcome.message).not.toContain("bad-replies");
    }, 120_000);

    test(`只留最近 ${BAD_REPLY_KEEP} 个，同章同步骤再失败覆盖旧的`, async () => {
        const env = await setup("bad-keep");
        const store = new IngestStore(env.library, "keep");
        const dir = badDir(env, "keep");
        for (let chapter = 1; chapter <= BAD_REPLY_KEEP + 2; chapter++) {
            await store.writeBadReply({chapter, step: "draft", why: "回复不是 JSON", replies: [{round: 1, finishReason: "stop", text: `第 ${chapter} 章`}]});
            // 文件系统的时间戳精度不够分出先后，按章号手工排好。
            await utimes(join(dir, `${chapter}-draft.json`), chapter, chapter);
        }
        const names = (await readdir(dir)).sort();
        expect(names).toHaveLength(BAD_REPLY_KEEP);
        expect(names).not.toContain("1-draft.json");
        expect(names).not.toContain("2-draft.json");
        await store.writeBadReply({chapter: 22, step: "draft", why: "回复被截断", replies: [{round: 1, finishReason: "length", text: "新的"}]});
        expect(JSON.parse(await readFile(join(dir, "22-draft.json"), "utf8")).why).toBe("回复被截断");
        expect(await readdir(dir)).toHaveLength(BAD_REPLY_KEEP);
    });
});

describe("用量与用时（输出 13）", () => {
    test("停下后换了币种接着抽：费用按币种分开；用时含作废的尝试，历次用时不少于各章之和", async () => {
        let hold = true;
        const env = await setup("costs", key => (hold && key.chapter === 1 && key.step === "draft" ? hang : undefined));
        const first = await env.start({text: await sampleSourceText(5), id: "costs", title: "费用", currency: "USD"});
        await waitUntil("第 1 章草稿请求", () => env.played.seen.some(key => key.step === "draft"), {timeoutMs: 30_000});
        first.runner!.stop();
        await first.runner!.done;
        // 把第一次任务与它那次第 1 章尝试的开始记录往前挪 10 分钟（相当于那次尝试跑了 10 分钟才停下），用时才分得清
        // 这次作废的尝试有没有算进去。记录本身是真实运行写下的。
        const activityFile = join(env.library.root, ".ingest", "costs", "activity.jsonl");
        const shifted = (await readFile(activityFile, "utf8")).trim().split("\n").map(raw => {
            const line = JSON.parse(raw) as {kind: string; at: string};
            return line.kind === "run-start" || line.kind === "chapter-start" ? {...line, at: new Date(Date.parse(line.at) - TEN_MINUTES).toISOString()} : line;
        });
        await writeFile(activityFile, `${shifted.map(line => JSON.stringify(line)).join("\n")}\n`);

        hold = false;
        const second = await env.start({id: "costs", currency: "CNY"});
        expect(await second.runner!.done).toEqual({kind: "done"});

        const status = (await ingestStatus(env.library, "costs"))!;
        const currencies = (costs: {currency: string; amount: number}[]) => costs.map(cost => cost.currency).sort();
        expect(currencies(status.allRuns.costs)).toEqual(["CNY", "USD"]);
        expect(status.allRuns.costs.every(cost => cost.amount > 0)).toBe(true);
        expect(currencies(status.thisRun.costs)).toEqual(["CNY"]);
        expect(currencies(status.chapters[0]!.usage.costs)).toEqual(["CNY", "USD"]);
        expect(currencies(status.average!.costs)).toEqual(["CNY", "USD"]);

        expect(status.chapters[0]!.ms).toBeGreaterThanOrEqual(TEN_MINUTES);
        expect(status.thisRun.ms).toBeLessThan(TEN_MINUTES);
        expect(status.allRuns.ms).toBeGreaterThanOrEqual(TEN_MINUTES + status.thisRun.ms);
        const chapterSum = status.chapters.reduce((sum, chapter) => sum + chapter.ms, 0);
        expect(status.allRuns.ms).toBeGreaterThanOrEqual(chapterSum);
        expect(status.average!.ms).toBeCloseTo(chapterSum / 5, 6);
    }, 120_000);
});
