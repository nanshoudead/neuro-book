/**
 * `nbstory config`（docs/specs/story/qa.md 输出 18 到 21，F1、F7）：跑真实的命令行进程；`test` 的请求经真实的 OMP
 * provider 发往本机的 OpenAI 兼容端点，用端点收到的正文核对推理档。
 *
 * 密钥都是测试里编的假值，只发往本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {PassThrough} from "node:stream";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI} from "../../testing/processes";
import {confirmOverwrite, initInteractively} from "./config-init";

const KEY_ENV = "NBSTORY_CONFIG_TEST_CREDENTIAL";
const FAKE_KEY = "fake-credential-for-config-test-0042";

let root = "";
let counter = 0;
const endpoints: Endpoint[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "config-cmd");
});

afterAll(async () => {
    for (const endpoint of endpoints) endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function freshPath(): string {
    counter += 1;
    return join(root, `case-${counter}`, "config.json");
}

async function run(args: string[], env: Record<string, string | undefined> = {[KEY_ENV]: FAKE_KEY}): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn(["bun", CLI, ...args], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

const INIT_FLAGS = ["--base-url", "http://127.0.0.1:1/v1", "--model", "m1", "--api-key-env", KEY_ENV];

async function written(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, "utf8"));
}

describe("init、show、set、unset", () => {
    test("选项给齐就直接写，目录不存在时建出来；show 说明密钥环境变量设没设置，不打印密钥", async () => {
        const path = freshPath();
        const init = await run(["config", "init", ...INIT_FLAGS, "--thinking", "xhigh", "--config", path]);
        expect(init.code).toBe(0);
        expect(await written(path)).toEqual({model: {baseUrl: "http://127.0.0.1:1/v1", id: "m1", apiKeyEnv: KEY_ENV, thinking: "xhigh"}});

        const set = await run(["config", "show", "--config", path]);
        expect(set.stdout).toContain(`密钥环境变量：${KEY_ENV}（已设置）`);
        expect(set.stdout).toContain("推理档：xhigh");
        expect(`${set.stdout}${set.stderr}`).not.toContain(FAKE_KEY);
        const unset = await run(["config", "show", "--config", path], {[KEY_ENV]: undefined});
        expect(unset.stdout).toContain("没有设置");

        const json = await run(["config", "show", "--config", path, "--json"]);
        expect(JSON.parse(json.stdout)).toEqual({ok: true, data: {path, config: await written(path), apiKeySet: true}});
    });

    test("缺必填项又不在终端：用法错误，退出码 2，不写文件，不挂起等输入", async () => {
        const path = freshPath();
        const result = await run(["config", "init", "--model", "m1", "--config", path]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("--base-url");
        expect(result.stderr).toContain("--api-key-env");
        expect(await readdir(join(path, "..")).catch(() => [])).toEqual([]);
    });

    test("已有配置：不加 --force 不动；加了只改给出的字段，其余保留", async () => {
        const path = freshPath();
        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        await run(["config", "set", "qa.maxChapters", "7", "--config", path]);
        const before = await readFile(path, "utf8");
        const refused = await run(["config", "init", ...INIT_FLAGS, "--model", "m2", "--config", path]);
        expect(refused.code).toBe(2);
        expect(refused.stderr).toContain("--force");
        expect(await readFile(path, "utf8")).toBe(before);
        const forced = await run(["config", "init", "--model", "m2", "--thinking", "high", "--force", "--config", path]);
        expect(forced.code).toBe(0);
        expect(await written(path)).toEqual({model: {baseUrl: "http://127.0.0.1:1/v1", id: "m2", apiKeyEnv: KEY_ENV, thinking: "high"}, qa: {maxChapters: 7}});
    });

    test("没有配置时 show、set、unset 报 qa_unconfigured（退出码 1）并指向 init", async () => {
        const path = freshPath();
        for (const args of [["show"], ["set", "model.id", "x"], ["unset", "model.thinking"]]) {
            const result = await run(["config", ...args, "--config", path]);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain("qa_unconfigured");
            expect(result.stderr).toContain("config init");
        }
    });

    test("set 改一个字段、unset 去掉可选字段；字段不认识、值写不对是用法错误（2），越界是配置错误（1）且文件不变", async () => {
        const path = freshPath();
        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        expect((await run(["config", "set", "model.thinking", "xhigh", "--config", path])).code).toBe(0);
        expect(await written(path)).toMatchObject({model: {thinking: "xhigh"}});
        expect((await run(["config", "unset", "model.thinking", "--config", path])).code).toBe(0);
        expect((await written(path) as {model: object}).model).not.toHaveProperty("thinking");

        const before = await readFile(path, "utf8");
        // 都不写盘，并行跑：每个都是一个命令行进程。`toString` 是普通对象从原型继承来的名字，也不是字段。
        const wrong = [["set", "model.nope", "1"], ["unset", "toString"], ["set", "qa.maxChapters", "多"], ["set", "model.thinking", "max"], ["unset", "model.id"], ["set", "model.id"], ["bogus"], []];
        const codes = await Promise.all(wrong.map(async args => (await run(["config", ...args, "--config", path])).code));
        expect(codes).toEqual(wrong.map(() => 2));
        const outOfRange = await run(["config", "set", "qa.maxChapters", "21", "--config", path, "--json"]);
        expect(outOfRange.code).toBe(1);
        expect((JSON.parse(outOfRange.stdout) as {error: {code: string}}).error.code).toBe("qa_unconfigured");
        expect(await readFile(path, "utf8")).toBe(before);
    });

    test("密钥环境变量名写成了别的（像是贴了密钥）：init 与 set 都是用法错误（2），不写盘，输出里没有原文", async () => {
        const pasted = "sk-pasted-credential-0042";
        const path = freshPath();
        const init = await run(["config", "init", "--base-url", "http://127.0.0.1:1/v1", "--model", "m1", "--api-key-env", pasted, "--config", path]);
        expect(init.code).toBe(2);
        expect(await readdir(join(path, "..")).catch(() => [])).toEqual([]);

        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        const before = await readFile(path, "utf8");
        const set = await run(["config", "set", "model.apiKeyEnv", pasted, "--config", path, "--json"]);
        expect(set.code).toBe(2);
        expect(await readFile(path, "utf8")).toBe(before);
        for (const result of [init, set]) expect(`${result.stdout}${result.stderr}`).not.toContain(pasted);
    });

    test("写不进去（目录位置是个文件、目录进不去）：qa_config_write_failed，退出码 1，--json 时照样输出 JSON", async () => {
        const blocker = join(root, "blocker");
        await writeFile(blocker, "x");
        const result = await run(["config", "init", ...INIT_FLAGS, "--config", join(blocker, "config.json")]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("qa_config_write_failed");

        // 只读且不可进入：写临时文件失败，清理它也会失败，报的仍是写失败。
        const locked = join(root, "locked");
        await mkdir(locked);
        await chmod(locked, 0o444);
        try {
            const json = await run(["config", "init", ...INIT_FLAGS, "--config", join(locked, "config.json"), "--json"]);
            expect(json.code).toBe(1);
            expect(JSON.parse(json.stdout)).toEqual({ok: false, error: expect.objectContaining({code: "qa_config_write_failed"})});
        } finally {
            await chmod(locked, 0o755);
        }
        expect(await readdir(locked)).toEqual([]);
    });
});

async function configWithEndpoint(replies: EndpointReply[], thinking?: string): Promise<{path: string; endpoint: Endpoint}> {
    const endpoint = startEndpoint(replies);
    endpoints.push(endpoint);
    const path = freshPath();
    await mkdir(join(path, ".."), {recursive: true});
    await writeFile(path, JSON.stringify({model: {baseUrl: endpoint.url, id: "test-model", apiKeyEnv: KEY_ENV, ...(thinking === undefined ? {} : {thinking})}}));
    return {path, endpoint};
}

describe("config test", () => {
    test("模型回话即通过；请求带配置里的推理档和认证；模型回话里回显了密钥，输出里也没有", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: `好，${FAKE_KEY}`}], "xhigh");
        const result = await run(["config", "test", "--config", path]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("通过：test-model");
        expect(result.stdout).toContain("推理档：xhigh");
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["xhigh"]);
        expect(endpoint.authorizations).toEqual([`Bearer ${FAKE_KEY}`]);
        expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_KEY);
    });

    test("配置里没写推理档：请求里没有，输出说由服务端的默认档决定", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: "好"}]);
        const result = await run(["config", "test", "--config", path]);
        expect(result.code).toBe(0);
        expect(endpoint.bodies[0]).not.toHaveProperty("reasoning_effort");
        expect(result.stdout).toContain("由服务端的默认档决定");
    });

    test("认证被拒：退出码 4，错误归类 auth，错误正文里回显的密钥也不出现在输出里", async () => {
        const {path} = await configWithEndpoint([{kind: "status", status: 401, echoKey: true}]);
        const result = await run(["config", "test", "--config", path, "--json"]);
        expect(result.code).toBe(4);
        expect(JSON.parse(result.stdout)).toEqual({ok: false, error: expect.objectContaining({code: "model_failed", kind: "auth"})});
        expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_KEY);
    });

    test("密钥环境变量没设置：退出码 4，不向端点发请求", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: "好"}]);
        const result = await run(["config", "test", "--config", path], {[KEY_ENV]: undefined});
        expect(result.code).toBe(4);
        expect(result.stderr).toContain(KEY_ENV);
        expect(endpoint.bodies).toEqual([]);
    });
});

describe("init 的交互", () => {
    /**
     * 把按键一段一段喂给提示：clack 一次只读一个提示的输入，等它画出来再喂。`close` 结束输入输出：断言失败时还在
     * 等输入的提示不会留到后面的用例里。
     */
    function terminal() {
        const input = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => undefined}) as unknown as PassThrough & NodeJS.ReadStream;
        const output = new PassThrough();
        let screen = "";
        output.on("data", chunk => (screen += String(chunk)));
        const type = async (keys: string, expectScreen: string): Promise<void> => {
            const deadline = Date.now() + 4000;
            while (!screen.includes(expectScreen)) {
                if (Date.now() > deadline) throw new Error(`屏幕上等不到“${expectScreen}”：${screen}`);
                await Bun.sleep(10);
            }
            input.write(keys);
        };
        const close = (): void => {
            input.destroy();
            output.destroy();
        };
        return {streams: {input, output}, type, close};
    }

    test("依次问地址、模型名、密钥环境变量名、推理档，返回新配置", async () => {
        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {}, streams: term.streams});
            await term.type("http://h/v1\r", "OpenAI 兼容服务的地址");
            await term.type("m9\r", "模型名");
            await term.type("MY_KEY\r", "存密钥的环境变量名");
            await term.type("\u001b[B\u001b[B\u001b[B\u001b[B\r", "推理档");
            expect(await result).toEqual({model: {baseUrl: "http://h/v1", id: "m9", apiKeyEnv: "MY_KEY", thinking: "xhigh"}});
        } finally {
            term.close();
        }
    });

    test("贴进来的是密钥而不是变量名：拒绝并说明，改填变量名后通过", async () => {
        const term = terminal();
        try {
            const pasted = "sk-abc-123";
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {"model.baseUrl": "http://h/v1", "model.id": "m"}, streams: term.streams});
            await term.type(`${pasted}\r`, "存密钥的环境变量名");
            await term.type(`${"\u007f".repeat(pasted.length)}MY_KEY\r`, "不是密钥本身");
            await term.type("\r", "推理档");
            expect(await result).toEqual({model: {baseUrl: "http://h/v1", id: "m", apiKeyEnv: "MY_KEY"}});
        } finally {
            term.close();
        }
    });

    test("中途取消返回 null，调用方不写盘", async () => {
        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {}, streams: term.streams});
            await term.type("\u0003", "OpenAI 兼容服务的地址");
            expect(await result).toBeNull();
        } finally {
            term.close();
        }
    });

    test("已有配置：默认不覆盖，选否即取消；选是后保留没问到的字段，推理档选“不写”会去掉原来的", async () => {
        const existing = {model: {baseUrl: "http://old/v1", id: "old", apiKeyEnv: "OLD_KEY", thinking: "high" as const}, qa: {maxChapters: 5}};
        const refused = terminal();
        try {
            const first = initInteractively({path: "/x/config.json", confirmOverwrite: true, existing, flags: {}, streams: refused.streams});
            await refused.type("\r", "覆盖");
            expect(await first).toBeNull();
        } finally {
            refused.close();
        }

        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: true, existing, flags: {}, streams: term.streams});
            await term.type("y", "覆盖");
            await term.type("\r", "OpenAI 兼容服务的地址");
            await term.type("\r", "模型名");
            await term.type("\r", "存密钥的环境变量名");
            await term.type("\u001b[A\u001b[A\u001b[A\r", "推理档");
            expect(await result).toEqual({model: {baseUrl: "http://old/v1", id: "old", apiKeyEnv: "OLD_KEY"}, qa: {maxChapters: 5}});
        } finally {
            term.close();
        }
    });

    test("字段都在选项里给了：只确认覆盖，默认不覆盖", async () => {
        for (const [keys, expected] of [["\r", false], ["y", true]] as const) {
            const term = terminal();
            try {
                const answer = confirmOverwrite("/x/config.json", term.streams);
                await term.type(keys, "覆盖");
                expect(await answer).toBe(expected);
            } finally {
                term.close();
            }
        }
    });
});
