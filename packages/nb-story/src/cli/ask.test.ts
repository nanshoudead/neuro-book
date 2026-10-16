/**
 * `nbstory ask` 与 `nbstory qa`（docs/specs/story/qa.md 输出 12 到 17、验收 6 与 8，F1、F2、F5）：跑真实的命令行
 * 进程，模型请求经真实的 OMP provider 发往本机的 OpenAI 兼容端点。
 *
 * 密钥都是测试里编的假值，只发往本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "../core/api";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI} from "../../testing/processes";
import {makeSampleRoot} from "../../testing/sample";

const KEY_ENV = "NBSTORY_ASK_TEST_CREDENTIAL";
const FAKE_KEY = "fake-credential-for-ask-test-0042";

let root = "";
let library = "";
const endpoints: Endpoint[] = [];

beforeAll(async () => {
    const sample = await makeSampleRoot("qa-ask");
    root = sample.root;
    library = sample.library;
    const imported = await createStoryApi({library}).call("book.import", {file: sample.file, title: "样例", id: "fox"});
    if (!imported.ok) throw new Error(imported.error.message);
});

afterAll(async () => {
    for (const endpoint of endpoints) endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function configFor(replies: EndpointReply[]): Promise<{config: string; endpoint: Endpoint}> {
    const endpoint = startEndpoint(replies);
    endpoints.push(endpoint);
    const config = join(root, `config-${endpoints.length}.json`);
    await writeFile(config, JSON.stringify({model: {baseUrl: endpoint.url, id: "test-model", apiKeyEnv: KEY_ENV}}));
    return {config, endpoint};
}

function spawnCli(args: string[], env: Record<string, string | undefined> = {[KEY_ENV]: FAKE_KEY}) {
    return Bun.spawn(["bun", CLI, ...args, "--library", library], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
}

async function run(args: string[], env?: Record<string, string | undefined>): Promise<{code: number; stdout: string; stderr: string}> {
    const child = spawnCli(args, env);
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

/** 书目录下 qa/ 里全部文件的内容拼在一起。 */
async function qaFiles(): Promise<string> {
    const dir = join(library, "fox", "qa");
    const names = await readdir(dir).catch(() => [] as string[]);
    return (await Promise.all(names.map(name => readFile(join(dir, name), "utf8")))).join("\n");
}

const READ_THEN_ANSWER: EndpointReply[] = [
    {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}]},
    {kind: "tools", calls: [{name: "answer", args: {conclusion: "读者在 37.8 知道了", conclusionType: "明说", explanation: "旁白点破", evidence: ["37.8"], coverage: "第 37 章"}}]},
];

describe("nbstory ask", () => {
    test("进度写标准错误，答案写标准输出；记录能列出、显示、删除", async () => {
        const {config, endpoint} = await configFor([...READ_THEN_ANSWER]);
        const result = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", config]);
        expect(result.code).toBe(0);
        expect(result.stderr).toContain("· 读原文 37.8—37.8");
        expect(result.stderr).toContain("· 已交卷");
        expect(result.stdout).toContain("结论（明说）：读者在 37.8 知道了");
        expect(result.stdout).toContain("读过的章：37");
        expect(endpoint.authorizations).toEqual([`Bearer ${FAKE_KEY}`, `Bearer ${FAKE_KEY}`]);
        const id = /记录 (\S+)/u.exec(result.stdout)![1]!;

        const listed = await run(["qa"]);
        expect(listed.stdout).toContain(`${id}`);
        expect(listed.stdout).toContain("已答  @38.");
        const shown = await run(["qa", id, "--json"]);
        expect(JSON.parse(shown.stdout)).toMatchObject({ok: true, data: {id, status: "answered", answer: {evidence: ["37.8"]}}});

        expect((await run(["qa", "rm", id])).code).toBe(0);
        const gone = await run(["qa", id, "--json"]);
        expect(gone.code).toBe(1);
        expect(JSON.parse(gone.stdout)).toEqual({ok: false, error: {code: "qa_record_not_found", message: expect.any(String)}});
    });

    test("--json：标准输出只有一个 JSON；密钥不出现在输出、记录与会话日志里（验收 8）", async () => {
        const {config} = await configFor([...READ_THEN_ANSWER]);
        const result = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", config, "--json"]);
        const parsed = JSON.parse(result.stdout) as {ok: boolean; data: {status: string; recordSaved: boolean; usage: {input: number}}};
        expect(parsed).toMatchObject({ok: true, data: {status: "answered", recordSaved: true, usage: {input: 200}}});
        expect(`${result.stdout}${result.stderr}${await qaFiles()}`).not.toContain(FAKE_KEY);
    });

    test("401 的错误正文回显了密钥：model_failed（auth），退出码 4，到处都没有密钥", async () => {
        const {config} = await configFor([{kind: "status", status: 401, echoKey: true}]);
        const result = await run(["ask", "问", "--config", config, "--json"]);
        expect(result.code).toBe(4);
        expect(JSON.parse(result.stdout)).toMatchObject({ok: false, error: {code: "model_failed", kind: "auth"}});
        expect(`${result.stdout}${result.stderr}${await qaFiles()}`).not.toContain(FAKE_KEY);
    });

    test("密钥环境变量没设：不发请求，model_failed（auth）", async () => {
        const {config, endpoint} = await configFor([]);
        const result = await run(["ask", "问", "--config", config, "--json"], {[KEY_ENV]: undefined});
        expect(result.code).toBe(4);
        expect(JSON.parse(result.stdout)).toMatchObject({ok: false, error: {code: "model_failed", kind: "auth"}});
        expect(endpoint.authorizations).toEqual([]);
    });

    test("配置文件不在：qa_unconfigured，退出码 4；书不存在：退出码 1", async () => {
        const missing = await run(["ask", "问", "--config", join(root, "no-such.json"), "--json"]);
        expect(missing.code).toBe(4);
        expect(JSON.parse(missing.stdout)).toMatchObject({ok: false, error: {code: "qa_unconfigured"}});
        const {config} = await configFor([]);
        const noBook = await run(["ask", "问", "--book", "nope", "--config", config, "--json"]);
        expect(noBook.code).toBe(1);
        expect(JSON.parse(noBook.stdout)).toMatchObject({ok: false, error: {code: "book_not_found"}});
    });

    test("记录写不下来（qa/ 没有写权限）：照常给出答案，标准错误说明记录没保存", async () => {
        const qaDir = join(library, "fox", "qa");
        await mkdir(qaDir, {recursive: true});
        await chmod(qaDir, 0o555);
        try {
            const {config} = await configFor([...READ_THEN_ANSWER]);
            const result = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", config, "--json"]);
            expect(result.code).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ok: true, data: {status: "answered", recordSaved: false, notSaved: {reason: "write_failed"}}});
            expect(result.stderr).toContain("记录没有保存：写盘失败");
        } finally {
            await chmod(qaDir, 0o755);
        }
    });

    test("qa 的用法错误不看书库：空书库里 qa rm 不给 id 也是退出码 2", async () => {
        const empty = join(root, "empty-library");
        const child = Bun.spawn(["bun", CLI, "qa", "rm", "--library", empty], {stdout: "pipe", stderr: "pipe"});
        expect(await child.exited).toBe(2);
    });

    test("模型请求进行中收到中断信号：以 130 退出，留下一条“中断”的记录（验收 6）", async () => {
        const {config, endpoint} = await configFor([{kind: "hang"}]);
        const child = spawnCli(["ask", "会被取消的问题", "--config", config]);
        await endpoint.firstRequest;
        child.kill("SIGINT");
        expect(await child.exited).toBe(130);
        const listed = await run(["qa", "--json"]);
        const records = (JSON.parse(listed.stdout) as {data: {records: {question: string; status: string; answer: unknown}[]}}).data.records;
        expect(records.find(record => record.question === "会被取消的问题")).toMatchObject({status: "interrupted", answer: null});
    });
});
