/**
 * `nbstory ask` 与 `nbstory qa`（docs/specs/story/qa.md 输出 12 到 17、26，验收 6、8、13 到 15，F1、F2、F5）：跑真实的命令行
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

async function configFor(replies: EndpointReply[], model: Record<string, unknown> = {}): Promise<{config: string; endpoint: Endpoint}> {
    const endpoint = startEndpoint(replies);
    endpoints.push(endpoint);
    const config = join(root, `config-${endpoints.length}.json`);
    await writeFile(config, JSON.stringify({model: {baseUrl: endpoint.url, id: "test-model", apiKeyEnv: KEY_ENV, ...model}}));
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
        const id = /对话 (\S+) 第 1 轮；追问：nbstory ask <问题> --continue \S+/u.exec(result.stdout)![1]!;

        const listed = await run(["qa"]);
        expect(listed.stdout).toContain(`${id}`);
        expect(listed.stdout).toContain("已答  1 轮  @38.");
        const shown = await run(["qa", id, "--json"]);
        expect(JSON.parse(shown.stdout)).toMatchObject({ok: true, data: {id, turns: [{status: "answered", answer: {evidence: ["37.8"]}}]}});

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

    test("配置的 thinking 原样作为推理档发给端点；不写时请求里没有推理档，由服务端的默认档决定", async () => {
        const {config, endpoint} = await configFor([...READ_THEN_ANSWER], {thinking: "xhigh"});
        expect((await run(["ask", "地狱猫是谁？", "--at", "38", "--config", config])).code).toBe(0);
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["xhigh", "xhigh"]);

        const plain = await configFor([...READ_THEN_ANSWER]);
        expect((await run(["ask", "地狱猫是谁？", "--at", "38", "--config", plain.config])).code).toBe(0);
        expect(plain.endpoint.bodies.map(body => "reasoning_effort" in body)).toEqual([false, false]);
    });

    test("接口选 Responses：请求走 Responses 并要思考摘要，摘要作为思考写进会话日志，照常交卷", async () => {
        const replies: EndpointReply[] = READ_THEN_ANSWER.map((reply, index) => ({...reply, thinking: `先想第 ${index + 1} 步`}) as EndpointReply);
        const {config, endpoint} = await configFor(replies, {api: "responses", thinking: "xhigh"});
        const result = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", config]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("结论（明说）：读者在 37.8 知道了");
        expect(endpoint.bodies.map(body => [body.reasoning, "messages" in body, "input" in body])).toEqual([
            [{effort: "xhigh", summary: "auto"}, false, true],
            [{effort: "xhigh", summary: "auto"}, false, true],
        ]);
        const dir = join(library, "fox", "qa");
        const logs = (await readdir(dir)).filter(name => name.endsWith(".session.jsonl"));
        const lines = (await Promise.all(logs.map(name => readFile(join(dir, name), "utf8")))).join("").split("\n").filter(line => line !== "");
        const thinking = lines.flatMap(line => {
            const entry = JSON.parse(line) as {kind?: string; message?: {role?: string; content?: {type: string; thinking?: string}[]}};
            return entry.kind === "agent_message" && entry.message?.role === "assistant" ? (entry.message.content ?? []).filter(block => block.type === "thinking").map(block => block.thinking?.trim()) : [];
        });
        expect(thinking).toEqual(["先想第 1 步", "先想第 2 步"]);
    });

    test("问题里带引用：模型收到原样的引用与读引用的规则；按引用里的 id 查对象得到人物卡", async () => {
        const found = await createStoryApi({library}).call("entities.list", {book: "fox", at: {chapter: 38, paragraph: 57}, query: "地狱猫"});
        if (!found.ok) throw new Error(found.error.message);
        const {id, label} = found.value.items[0]!;
        const {config, endpoint} = await configFor([{kind: "tools", calls: [{name: "card", args: {entity: id}}]}, {kind: "text", text: "见人物卡"}]);
        const question = `[地狱猫](entity://${id}) 在 [37.8](paragraph://37.8) 做了什么？`;
        expect((await run(["ask", question, "--at", "38", "--config", config])).code).toBe(0);
        const first = JSON.stringify(endpoint.bodies[0]);
        expect(first).toContain(JSON.stringify(question).slice(1, -1));
        expect(first).toContain("是用户指定的对象");
        const toolResult = (endpoint.bodies[1]!.messages as {role: string; content: unknown}[]).find(message => message.role === "tool");
        expect(JSON.stringify(toolResult?.content)).not.toContain("查询失败");
        expect(JSON.stringify(toolResult?.content)).toContain(label);
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
        const records = (JSON.parse(listed.stdout) as {data: {records: {turns: {question: string; status: string; answer: unknown}[]}[]}}).data.records;
        expect(records.find(record => record.turns[0]!.question === "会被取消的问题")?.turns).toMatchObject([{status: "interrupted", answer: null}]);
    });
});

describe("nbstory ask 的文字回复与追问（输出 10、12、26，验收 13 到 15）", () => {
    test("文字回复写到标准输出；--continue 追问第二轮，--json 带 turn 与 reply；qa 按轮显示", async () => {
        const {config} = await configFor([{kind: "text", text: "你好！想问这本书的什么？"}, {kind: "text", text: "可以，问吧"}]);
        const first = await run(["ask", "你好", "--at", "38", "--config", config]);
        expect(first.code).toBe(0);
        expect(first.stdout).toContain("你好！想问这本书的什么？");
        const id = /对话 (\S+) 第 1 轮/u.exec(first.stdout)![1]!;

        const second = await run(["ask", "能问剧情吗", "--continue", id, "--config", config, "--json"]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.stdout)).toMatchObject({ok: true, data: {id, turn: 2, status: "answered", answer: null, reply: {text: "可以，问吧", truncated: false, unverifiedRefs: []}, at: {chapter: 38}}});

        const shown = await run(["qa", id]);
        expect(shown.stdout).toContain("2 轮");
        expect(shown.stdout).toContain("第 2 轮（已答）：能问剧情吗");
    });

    test("--continue 与 --at 或 --mode 同时写是用法错误；没有这个对话是 qa_record_not_found", async () => {
        const {config, endpoint} = await configFor([]);
        expect((await run(["ask", "问", "--continue", "20261016100000000-abcdef", "--at", "38", "--config", config])).code).toBe(2);
        expect((await run(["ask", "问", "--continue", "20261016100000000-abcdef", "--mode", "full", "--config", config])).code).toBe(2);
        const missing = await run(["ask", "问", "--continue", "20261016100000000-abcdef", "--config", config, "--json"]);
        expect(missing.code).toBe(1);
        expect(JSON.parse(missing.stdout)).toMatchObject({ok: false, error: {code: "qa_record_not_found"}});
        expect(endpoint.authorizations).toEqual([]);
    });
});
