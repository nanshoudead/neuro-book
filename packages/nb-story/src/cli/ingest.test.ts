/**
 * `nbstory ingest` 与抽取模型的配置（docs/specs/story/ingest.md 输出 2、11、13 到 16，验收 1、2、4、9；qa.md
 * 输出 23）：跑真实的命令行进程，模型是本机端点回放 w00005 t34 录下的回复（testing/ingest-replay.ts）。要让任务停在
 * 某一步时，端点对那一步不回应（`hang`），直到请求被取消。
 *
 * 密钥是测试里编的假值，只发往本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {loadReplay, replay, type Replay, type ReplayKey} from "../../testing/ingest-replay";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI} from "../../testing/processes";
import {sampleDataset, sampleSourceText} from "../../testing/sample";

const KEY_ENV = "NBSTORY_INGEST_CLI_TEST_CREDENTIAL";
const FAKE_KEY = "fake-ingest-cli-credential-0042";

let root = "";
let counter = 0;
const cleanups: (() => Promise<unknown> | unknown)[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "ingest-cli");
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const hang: EndpointReply = {kind: "hang"};

/** 一个用例的书库、配置与回放端点。配置里只有问答的 `model`（带推理档与价格），抽取应当用它、不用它的推理档。 */
async function setup(override?: (key: ReplayKey, nth: number) => EndpointReply | undefined) {
    counter += 1;
    const dir = join(root, `case-${counter}`);
    await mkdir(dir, {recursive: true});
    const played: Replay = replay(await loadReplay(), override);
    const endpoint: Endpoint = startEndpoint(played.responder);
    cleanups.push(() => endpoint.stop());
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV, thinking: "high", price: {input: 1, output: 4, currency: "USD"}}}));
    const library = join(dir, "library");
    const common = ["--library", library, "--config", config];
    return {dir, library, config, played, endpoint, common};
}

interface Child {
    exited: Promise<number>;
    output: Promise<{stdout: string; stderr: string}>;
    kill(signal: NodeJS.Signals): void;
}

function spawnCli(args: string[]): Child {
    const child = Bun.spawn(["bun", CLI, ...args], {stdout: "pipe", stderr: "pipe", env: {...process.env, [KEY_ENV]: FAKE_KEY}});
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([stdout, stderr]) => ({stdout, stderr}));
    cleanups.push(async () => {
        child.kill("SIGKILL");
        await child.exited;
    });
    return {exited: child.exited, output, kill: signal => child.kill(signal)};
}

async function run(args: string[]): Promise<{code: number; stdout: string; stderr: string}> {
    const child = spawnCli(args);
    const [code, output] = await Promise.all([child.exited, child.output]);
    return {code, ...output};
}

const json = (text: string) => JSON.parse(text) as {ok: boolean; data?: Record<string, unknown>; error?: {code: string; kind?: string; message: string}};

/** 目录下全部文件的内容（递归）。 */
async function allFileText(dir: string): Promise<string> {
    const names = await readdir(dir, {recursive: true, withFileTypes: true});
    const files = names.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    return (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n");
}

describe("新建、Ctrl-C、接着抽（验收 1、9）", () => {
    test("第 3 章草稿请求中 Ctrl-C：退出码 130，书是 2 章、进度为用户停止；再跑同一条命令接着抽完；密钥只发给端点", async () => {
        let hold = true;
        const env = await setup(key => (hold && key.chapter === 3 && key.step === "draft" ? hang : undefined));
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(10));
        const outputs: string[] = [];

        const first = spawnCli(["ingest", file, ...env.common]);
        await waitUntil("第 3 章草稿请求", () => env.played.seen.some(key => key.chapter === 3 && key.step === "draft"), {timeoutMs: 60_000});
        const books = await run(["books", "--library", env.library, "--json"]);
        expect((json(books.stdout).data!.books as {id: string; chapters: number}[]).map(book => [book.id, book.chapters])).toEqual([["sample", 2]]);
        first.kill("SIGINT");
        expect(await first.exited).toBe(130);
        const stopped = await first.output;
        outputs.push(stopped.stdout, stopped.stderr);
        expect(stopped.stderr).toContain("第 2/10 章已提交");
        expect(stopped.stderr).toContain("收到中断信号");

        const status = await run(["ingest", "--status", "--book", "sample", "--library", env.library, "--json"]);
        outputs.push(status.stdout, status.stderr);
        expect(status.code).toBe(0);
        const data = json(status.stdout).data!;
        expect({state: data.state, reason: data.stopReason, committed: data.committed, total: data.total}).toEqual({state: "stopped", reason: {kind: "user"}, committed: 2, total: 10});

        hold = false;
        const second = await run(["ingest", file, ...env.common, "--json"]);
        outputs.push(second.stdout, second.stderr);
        expect(second.code).toBe(0);
        // --json 时标准输出只有一个 JSON。
        const summary = json(second.stdout);
        expect({ok: summary.ok, action: summary.data!.action, outcome: summary.data!.outcome, committed: summary.data!.committed}).toEqual({ok: true, action: "resume", outcome: "done", committed: 10});
        expect(env.played.unknown).toEqual([]);

        // 抽取用问答的模型，但不用它的推理档：推理档按步骤固定为 minimal 与 medium。
        expect(new Set(env.endpoint.bodies.map(body => body.model))).toEqual(new Set(["qa-model"]));
        expect(new Set(env.endpoint.bodies.map(body => body.reasoning_effort))).toEqual(new Set(["minimal", "medium"]));
        expect(new Set(env.endpoint.authorizations)).toEqual(new Set([`Bearer ${FAKE_KEY}`]));
        expect(outputs.join("\n")).not.toContain(FAKE_KEY);
        expect(await allFileText(env.library)).not.toContain(FAKE_KEY);
    }, 180_000);
});

describe("预览、改稿与已抽完（输出 2，验收 2）", () => {
    test("预览不调用模型、不写书库；抽完 5 章后改了第 2 章：退出码 1；--book 接着抽已抽完的书：不调用模型", async () => {
        const env = await setup();
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(5));

        const preview = await run(["ingest", file, "--preview", ...env.common, "--json"]);
        expect(preview.code).toBe(0);
        const plan = json(preview.stdout).data!;
        expect({id: plan.id, action: plan.action, chapters: (plan.chapters as unknown[]).length}).toEqual({id: "sample", action: "new", chapters: 5});
        expect(plan.preambleChars).toBeGreaterThan(0);
        expect(env.endpoint.bodies).toEqual([]);
        expect(await readdir(env.library).catch(() => [])).toEqual([]);

        const text = await run(["ingest", file, "--preview", ...env.common]);
        expect(text.stdout).toContain("书 sample（sample）：新建，共 5 章");

        expect((await run(["ingest", file, ...env.common])).code).toBe(0);

        const sample = await sampleDataset();
        await writeFile(file, (await sampleSourceText(5)).replace(sample.sources[1]!.paragraphs[3]!, `${sample.sources[1]!.paragraphs[3]!}（改）`));
        const changed = await run(["ingest", file, ...env.common, "--json"]);
        expect(changed.code).toBe(1);
        expect(json(changed.stdout).error!.code).toBe("ingest_text_changed");

        const requests = env.endpoint.bodies.length;
        const again = await run(["ingest", "--book", "sample", ...env.common]);
        expect(again.code).toBe(0);
        expect(again.stdout).toContain("已经全部抽完");
        expect(env.endpoint.bodies.length).toBe(requests);
    }, 180_000);

    test("用法错误：退出码 2", async () => {
        const env = await setup();
        for (const args of [["ingest"], ["ingest", "a.txt", "--book", "x"], ["ingest", "--status", "--preview"], ["ingest", "--book", "x", "--preview"]]) {
            const result = await run([...args, ...env.common]);
            expect(result.code).toBe(2);
        }
        // --json 时用法错误也只输出一个失败对象（退出码仍是 2）。
        for (const args of [["ingest"], ["ingest", "a.txt", "--book", "x"]]) {
            const result = await run([...args, ...env.common, "--json"]);
            expect({code: result.code, error: json(result.stdout).error!.code}).toEqual({code: 2, error: "invalid_params"});
        }
        // 文件不存在、是目录：invalid_params，--json 时是一个失败对象，不是堆栈。
        for (const path of [join(env.dir, "nope.txt"), env.dir]) {
            const result = await run(["ingest", path, "--preview", ...env.common, "--json"]);
            expect({code: result.code, error: json(result.stdout).error!.code}).toEqual({code: 1, error: "invalid_params"});
        }
    }, 60_000);
});

describe("别的进程在抽（验收 4）", () => {
    test("删除与再发起都得到 ingest_running，进度显示由命令行运行；强行结束后报“运行它的进程已退出”，可以删除", async () => {
        const env = await setup(key => (key.chapter === 2 ? hang : undefined));
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(5));
        const child = spawnCli(["ingest", file, ...env.common]);
        await waitUntil("第 2 章的请求", () => env.played.seen.some(key => key.chapter === 2), {timeoutMs: 60_000});

        const removed = await run(["remove", "sample", "--library", env.library, "--json"]);
        expect({code: removed.code, error: json(removed.stdout).error?.code}).toEqual({code: 1, error: "ingest_running"});
        const again = await run(["ingest", "--book", "sample", ...env.common, "--json"]);
        expect({code: again.code, error: json(again.stdout).error?.code}).toEqual({code: 1, error: "ingest_running"});
        const running = json((await run(["ingest", "--status", "--library", env.library, "--json"])).stdout).data!.books as {id: string; state: string; runner: string}[];
        expect(running.map(book => [book.id, book.state, book.runner])).toEqual([["sample", "running", "cli"]]);

        child.kill("SIGKILL");
        await child.exited;
        const status = json((await run(["ingest", "--status", "--book", "sample", "--library", env.library, "--json"])).stdout).data!;
        expect({state: status.state, reason: status.stopReason, committed: status.committed}).toEqual({state: "stopped", reason: {kind: "exited"}, committed: 1});
        expect((await run(["remove", "sample", "--library", env.library])).code).toBe(0);
        expect(json((await run(["ingest", "--status", "--library", env.library, "--json"])).stdout).data!.books).toEqual([]);
    }, 120_000);
});

describe("抽取模型的配置（验收 9，qa 输出 23）", () => {
    test("只有 model 时用它；config set ingest.model 后用新的，可以逐项改；unset 后回到 model", async () => {
        const env = await setup(() => hang);
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(2));
        const config = ["--config", env.config];
        /** 发起一次（第一个请求就挂住），记下请求用的模型，再 Ctrl-C。 */
        const modelOfNextRun = async (args: string[]) => {
            const before = env.endpoint.bodies.length;
            const child = spawnCli([...args, ...env.common]);
            await waitUntil("下一个请求", () => env.endpoint.bodies.length > before, {timeoutMs: 60_000});
            child.kill("SIGINT");
            expect(await child.exited).toBe(130);
            return env.endpoint.bodies[before]!.model;
        };

        expect(await modelOfNextRun(["ingest", file])).toBe("qa-model");

        const section = JSON.stringify({baseUrl: env.endpoint.url, id: "ingest-model", apiKeyEnv: KEY_ENV});
        expect((await run(["config", "set", "ingest.model", section, ...config])).code).toBe(0);
        const show = await run(["config", "show", ...config]);
        expect(show.stdout).toContain("抽取模型：ingest-model");
        expect(show.stdout).toContain(`抽取的密钥环境变量：${KEY_ENV}（已设置）`);
        expect(await modelOfNextRun(["ingest", "--book", "sample"])).toBe("ingest-model");

        expect((await run(["config", "set", "ingest.model.id", "ingest-model-2", ...config])).code).toBe(0);
        expect(await modelOfNextRun(["ingest", "--book", "sample"])).toBe("ingest-model-2");

        // 这一节不收推理档；写了就是配置不对，文件不变。
        const before = await readFile(env.config, "utf8");
        const thinking = await run(["config", "set", "ingest.model", JSON.stringify({baseUrl: env.endpoint.url, id: "x", apiKeyEnv: KEY_ENV, thinking: "low"}), ...config, "--json"]);
        expect({code: thinking.code, error: json(thinking.stdout).error?.code}).toEqual({code: 1, error: "qa_unconfigured"});
        expect(await readFile(env.config, "utf8")).toBe(before);

        expect((await run(["config", "unset", "ingest.model", ...config])).code).toBe(0);
        expect(JSON.parse(await readFile(env.config, "utf8")).ingest).toBeUndefined();
        expect(await modelOfNextRun(["ingest", "--book", "sample"])).toBe("qa-model");
        expect((await run(["config", "show", ...config])).stdout).toContain("抽取模型：没有单独配置");
    }, 180_000);

    test("挑相关说法默认关；set ingest.recall.enabled true 后每章先用抽取模型挑（minimal）；整节写 ingest.recall.model 后用它；都去掉后整节消失", async () => {
        const env = await setup(key => (key.chapter === 2 ? hang : undefined));
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(3));
        const config = ["--config", env.config];
        /** 发起一次，等第 2 章的第一个请求（挂住）后 Ctrl-C，返回那个请求的模型、推理档与系统提示词的开头。 */
        const chapterTwoFirst = async (args: string[]) => {
            const child = spawnCli([...args, ...env.common]);
            await waitUntil("第 2 章的请求", () => env.played.seen.filter(key => key.chapter === 2).length > asked, {timeoutMs: 60_000});
            const index = env.endpoint.bodies.length - 1;
            asked = env.played.seen.filter(key => key.chapter === 2).length;
            child.kill("SIGINT");
            expect(await child.exited).toBe(130);
            const body = env.endpoint.bodies[index]!;
            return {step: env.played.seen.at(-1)!.step, model: body.model, effort: body.reasoning_effort};
        };
        let asked = 0;

        expect(await chapterTwoFirst(["ingest", file])).toEqual({step: "beats", model: "qa-model", effort: "minimal"});
        expect((await run(["config", "show", ...config])).stdout).toContain("挑相关说法：关");

        expect((await run(["config", "set", "ingest.recall.enabled", "true", ...config])).code).toBe(0);
        expect((await run(["config", "show", ...config])).stdout).toContain("挑相关说法：开，用抽取模型");
        expect(await chapterTwoFirst(["ingest", "--book", "sample"])).toEqual({step: "recall", model: "qa-model", effort: "minimal"});

        expect((await run(["config", "set", "ingest.recall.model.id", "x", ...config])).stderr).toContain("先用 nbstory config set ingest.recall.model");
        expect((await run(["config", "set", "ingest.recall.model", JSON.stringify({baseUrl: env.endpoint.url, id: "recall-model", apiKeyEnv: KEY_ENV}), ...config])).code).toBe(0);
        expect((await run(["config", "show", ...config])).stdout).toContain("挑相关说法：开，模型 recall-model");
        expect(await chapterTwoFirst(["ingest", "--book", "sample"])).toEqual({step: "recall", model: "recall-model", effort: "minimal"});

        expect((await run(["config", "set", "ingest.recall.enabled", "yes", ...config])).code).toBe(2);
        expect((await run(["config", "unset", "ingest.recall.model", ...config])).code).toBe(0);
        expect((await run(["config", "unset", "ingest.recall.enabled", ...config])).code).toBe(0);
        expect(JSON.parse(await readFile(env.config, "utf8")).ingest).toBeUndefined();
        expect(await chapterTwoFirst(["ingest", "--book", "sample"])).toEqual({step: "beats", model: "qa-model", effort: "minimal"});
    }, 180_000);

    test("没有 ingest.model 时不能逐项改；整节里的密钥环境变量名写成密钥本身：用法错误，不回显", async () => {
        const env = await setup();
        const config = ["--config", env.config];
        const field = await run(["config", "set", "ingest.model.id", "x", ...config]);
        expect(field.code).toBe(2);
        expect(field.stderr).toContain("先用 nbstory config set ingest.model");
        const pasted = "sk-proj-ThisLooksLikeAKey0042";
        const key = await run(["config", "set", "ingest.model", JSON.stringify({baseUrl: "http://127.0.0.1:1/v1", id: "x", apiKeyEnv: pasted}), ...config]);
        expect(key.code).toBe(2);
        expect(`${key.stdout}${key.stderr}`).not.toContain(pasted);
        // JSON 写坏了（末尾多一个逗号）：说明不带原文。
        const malformed = await run(["config", "set", "ingest.model", `{"baseUrl":"http://127.0.0.1:1/v1","id":"x","apiKeyEnv":"${pasted}",}`, ...config]);
        expect(malformed.code).toBe(2);
        expect(`${malformed.stdout}${malformed.stderr}`).not.toContain(pasted);
        // 合法 JSON 里先贴了密钥、后面同名键又写对了：写进去的是对的那个，成功提示不回显原文。
        const duplicate = await run(["config", "set", "ingest.model", `{"baseUrl":"http://127.0.0.1:1/v1","id":"x","apiKeyEnv":"${pasted}","apiKeyEnv":"${KEY_ENV}"}`, ...config]);
        expect(duplicate.code).toBe(0);
        expect(`${duplicate.stdout}${duplicate.stderr}`).not.toContain(pasted);
        expect(await readFile(env.config, "utf8")).not.toContain(pasted);
    }, 60_000);
});

describe("config test --ingest（qa 输出 23）", () => {
    test("两档都通过：退出码 0，端点收到 minimal 与 medium 各一个请求", async () => {
        const endpoint = startEndpoint(() => ({kind: "text", text: '{"ok":true}'}));
        cleanups.push(() => endpoint.stop());
        const env = await setup();
        await writeFile(env.config, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV, thinking: "high"}}));
        const result = await run(["config", "test", "--ingest", "--config", env.config, "--json"]);
        expect(result.code).toBe(0);
        expect((json(result.stdout).data!.efforts as {effort: string; ok: boolean}[]).map(item => [item.effort, item.ok])).toEqual([["minimal", true], ["medium", true]]);
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["minimal", "medium"]);
    }, 60_000);

    test("模型拒绝 minimal：退出码 4，model_failed（provider），不重发、不降档；另一档照样试并报告", async () => {
        const endpoint = startEndpoint(body => (body.reasoning_effort === "minimal" ? {kind: "status", status: 400} : {kind: "text", text: '{"ok":true}'}));
        cleanups.push(() => endpoint.stop());
        const env = await setup();
        await writeFile(env.config, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}}));
        const result = await run(["config", "test", "--ingest", "--config", env.config]);
        expect(result.code).toBe(4);
        expect(result.stderr).toContain("失败：minimal 档（provider）");
        expect(result.stderr).toContain("通过：medium 档");
        expect(result.stderr).toContain("错误（model_failed，provider）");
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["minimal", "medium"]);
        // --json 时失败对象里也有两档各自的结果。
        const asJson = await run(["config", "test", "--ingest", "--config", env.config, "--json"]);
        const parsed = JSON.parse(asJson.stdout) as {ok: boolean; error: {code: string; kind: string}; data: {efforts: {effort: string; ok: boolean}[]}};
        expect({code: asJson.code, ok: parsed.ok, error: [parsed.error.code, parsed.error.kind], efforts: parsed.data.efforts.map(item => [item.effort, item.ok])}).toEqual({code: 4, ok: false, error: ["model_failed", "provider"], efforts: [["minimal", false], ["medium", true]]});
    }, 60_000);

    test("挑相关说法开着：再用挑选的模型试一次 minimal，分开报告", async () => {
        const endpoint = startEndpoint(() => ({kind: "text", text: '{"ok":true}'}));
        cleanups.push(() => endpoint.stop());
        const env = await setup();
        await writeFile(env.config, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, ingest: {recall: {enabled: true, model: {baseUrl: endpoint.url, id: "recall-model", apiKeyEnv: KEY_ENV}}}}));
        const result = await run(["config", "test", "--ingest", "--config", env.config, "--json"]);
        expect(result.code).toBe(0);
        expect(endpoint.bodies.map(body => [body.model, body.reasoning_effort])).toEqual([["qa-model", "minimal"], ["qa-model", "medium"], ["recall-model", "minimal"]]);
        const data = json(result.stdout).data as {efforts: unknown[]; recall: {model: string; efforts: {effort: string; ok: boolean}[]}};
        expect({main: data.efforts.length, recall: data.recall.model, recallEfforts: data.recall.efforts.map(item => [item.effort, item.ok])}).toEqual({main: 2, recall: "recall-model", recallEfforts: [["minimal", true]]});
    }, 60_000);

    test("--ingest 只用于 test", async () => {
        const env = await setup();
        expect((await run(["config", "show", "--ingest", "--config", env.config])).code).toBe(2);
    }, 30_000);
});
