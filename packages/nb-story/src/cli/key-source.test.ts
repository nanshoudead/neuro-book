/**
 * 密钥只认启动环境（docs/adr/0032、docs/specs/story/qa.md 配置）：变量只在家目录的 `.env` 里时，OMP 一被导入就会把它
 * 并进 `process.env`。`config show`、`ask`、`ingest` 对同一个变量必须得到同一个结论。真实的命令行进程，HOME 指向
 * 一个只放 `.env` 的临时目录，工作目录是空目录（Bun 只自动加载当前目录的 `.env`）；模型是本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "../core/api";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI} from "../../testing/processes";
import {makeSampleRoot, sampleSourceText} from "../../testing/sample";

const KEY_ENV = "NBSTORY_KEYSRC_TEST_CREDENTIAL";
const DOTENV_KEY = "dotenv-only-credential-0042";
const EXPORTED_KEY = "exported-credential-0042";

let root = "";
let library = "";
let home = "";
let cwd = "";
const endpoints: Endpoint[] = [];

beforeAll(async () => {
    const sample = await makeSampleRoot("qa-key-source");
    root = sample.root;
    library = sample.library;
    const imported = await createStoryApi({library}).call("book.import", {file: sample.file, title: "样例", id: "fox"});
    if (!imported.ok) throw new Error(imported.error.message);
    home = join(root, "home");
    cwd = join(root, "cwd");
    await mkdir(home, {recursive: true});
    await mkdir(cwd, {recursive: true});
    await writeFile(join(home, ".env"), `${KEY_ENV}=${DOTENV_KEY}\n`);
});
afterAll(async () => {
    for (const endpoint of endpoints) endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function setup(replies: Parameters<typeof startEndpoint>[0]) {
    const endpoint = startEndpoint(replies);
    endpoints.push(endpoint);
    const config = join(root, `config-${endpoints.length}.json`);
    await writeFile(config, JSON.stringify({model: {baseUrl: endpoint.url, id: "test-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}}));
    return {endpoint, config};
}

async function run(args: string[], exported: string | undefined) {
    const env: Record<string, string | undefined> = {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config"), [KEY_ENV]: exported};
    if (exported === undefined) delete env[KEY_ENV];
    const child = Bun.spawn(["bun", CLI, ...args, "--library", library], {cwd, stdout: "pipe", stderr: "pipe", env: env as Record<string, string>});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

const ANSWER: EndpointReply[] = [{kind: "tools", calls: [{name: "answer", args: {conclusion: "知道", conclusionType: "明说", explanation: "旁白", evidence: ["37.8"], coverage: "第 37 章"}}]}];

describe("密钥只认启动环境", () => {
    test("变量只在家目录的 .env 里：config show 报没有设置，ask 与 ingest 都不发请求，错误指向这个变量", async () => {
        const env = await setup([...ANSWER]);
        const shown = await run(["config", "show", "--config", env.config, "--json"], undefined);
        const data = JSON.parse(shown.stdout).data as {providers: {keySet: boolean}[]; ingest: {apiKeySet: boolean}};
        expect({providers: data.providers.map(item => item.keySet), ingest: data.ingest.apiKeySet}).toEqual({providers: [false], ingest: false});

        const asked = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", env.config], undefined);
        expect(asked.code).not.toBe(0);
        expect(asked.stderr).toContain(KEY_ENV);

        // config test 也不能借 OMP 读进来的 .env 发请求。
        const tested = await run(["config", "test", "--config", env.config], undefined);
        expect(tested.code).not.toBe(0);

        const file = join(root, "source.txt");
        await writeFile(file, await sampleSourceText(3));
        const ingested = await run(["ingest", file, "--id", "keysrc", "--config", env.config, "--json"], undefined);
        expect(ingested.code).not.toBe(0);
        expect(ingested.stdout).toContain(KEY_ENV);
        expect(env.endpoint.authorizations).toEqual([]);
    }, 120_000);

    test("shell 导出了变量：config show 报已设置，ask 发出的认证头是导出的值（不是 .env 里的）", async () => {
        const env = await setup([...ANSWER]);
        const shown = await run(["config", "show", "--config", env.config, "--json"], EXPORTED_KEY);
        const data = JSON.parse(shown.stdout).data as {providers: {keySet: boolean}[]; ingest: {apiKeySet: boolean}};
        expect({providers: data.providers.map(item => item.keySet), ingest: data.ingest.apiKeySet}).toEqual({providers: [true], ingest: true});

        const asked = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", env.config], EXPORTED_KEY);
        expect(asked.code).toBe(0);
        expect(env.endpoint.authorizations.length).toBeGreaterThan(0);
        expect(new Set(env.endpoint.authorizations)).toEqual(new Set([`Bearer ${EXPORTED_KEY}`]));
    }, 120_000);

    test("变量的值全是空白：config show 报没有设置，ask 不发请求（与有值的判断同一个）", async () => {
        const env = await setup([...ANSWER]);
        const shown = await run(["config", "show", "--config", env.config, "--json"], "   ");
        const data = JSON.parse(shown.stdout).data as {providers: {keySet: boolean}[]; ingest: {apiKeySet: boolean}};
        expect({providers: data.providers.map(item => item.keySet), ingest: data.ingest.apiKeySet}).toEqual({providers: [false], ingest: false});
        const asked = await run(["ask", "地狱猫是谁？", "--at", "38", "--config", env.config], "   ");
        expect(asked.code).not.toBe(0);
        expect(env.endpoint.authorizations).toEqual([]);
    }, 120_000);
});
