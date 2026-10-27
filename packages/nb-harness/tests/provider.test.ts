/**
 * provider 层的行为（docs/specs/agent/harness.md 输出 11、17、18，验收 6、7）：用本机起的 OpenAI 兼容端点
 * （真实 HTTP、真实 OMP provider），不替换模型输出。
 *
 * 这里设置的密钥都是假的，只发往本机端点；设置 OPENAI_API_KEY 是为了证明 harness 不会退回去用它
 * （governance 的 llm-credential 规则会对这些行报警告，它们不读取真实凭据，也不调用模型）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {AIMessage, defineProfile, Message, ProfilePrompt, System, toolRef} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import {complete, createHarness, defineModel, HarnessError, REDACTED_KEY, serializeAgentEvent, type DefineModelOptions} from "../src";
import {qaProfile, storyRegistry} from "./support";

interface Seen {
    readonly path: string;
    readonly authorization: string | null;
}

/** 请求正文里的消息（按角色与文字），供断言“模型实际收到什么”。 */
const bodies: {role: string; content: unknown}[][] = [];

/** 按顺序给出响应的本机端点；每个响应是状态码加正文（200 的正文按 SSE 发）。 */
function endpoint() {
    const seen: Seen[] = [];
    let replies: {status: number; text?: string; echoKey?: boolean; noFinishReason?: boolean}[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            seen.push({path: new URL(request.url).pathname, authorization: request.headers.get("authorization")});
            const body = JSON.parse(await request.text()) as {messages?: {role: string; content: unknown}[]};
            bodies.push(body.messages ?? []);
            const reply = replies.shift() ?? {status: 200, text: "默认回答"};
            if (reply.status !== 200) {
                // 有的服务在错误正文里原样带上收到的认证头（输出 18 要遮盖它）。
                const message = reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : "unavailable";
                return new Response(JSON.stringify({error: {message}}), {status: reply.status, headers: {"content-type": "application/json", "retry-after": "0"}});
            }
            const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
            const sse =
                chunk({choices: [{index: 0, delta: {role: "assistant", content: reply.text ?? ""}, finish_reason: null}]}) +
                // 有的网关耗尽预算后直接送 [DONE]，不送 finish_reason。
                (reply.noFinishReason ? "" : chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})) +
                chunk({choices: [], usage: {prompt_tokens: 12, completion_tokens: 3, total_tokens: 15}}) +
                "data: [DONE]\n\n";
            return new Response(sse, {headers: {"content-type": "text/event-stream"}});
        },
    });
    return {
        seen,
        url: `http://127.0.0.1:${server.port}/v1`,
        reply(...next: {status: number; text?: string; echoKey?: boolean; noFinishReason?: boolean}[]) {
            replies = next;
        },
        stop: () => server.stop(true),
    };
}

/** 不带工具的 Profile；静态消息是会话用的，单次请求不应把它们发出去（输出 17）。 */
const noToolsProfile = defineProfile({
    manifest: {key: "summary", version: "1", name: "摘要", description: "测试"},
    initialSchema: Type.Object({}),
    tools: [],
    context: () => ProfilePrompt({children: [System({children: ["只回答一个词。"]}), Message({children: ["静态的问题"]}), AIMessage({children: ["静态的回答"]})]}),
});

let root = "";
let server: ReturnType<typeof endpoint>;
let counter = 0;
const savedOpenAiKey = process.env.OPENAI_API_KEY;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "provider");
    server = endpoint();
});

afterAll(async () => {
    server.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

afterEach(() => {
    server.seen.length = 0;
    bodies.length = 0;
    delete process.env.NB_PROVIDER_TEST_KEY;
    if (savedOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAiKey;
});

function model(extra: Partial<DefineModelOptions> = {}) {
    const base: DefineModelOptions = {provider: "openai", api: "openai-completions", baseUrl: server.url, id: "test-model", apiKeyEnv: "NB_PROVIDER_TEST_KEY"};
    return defineModel({...base, ...extra} as DefineModelOptions);
}

async function session(resolved = model()) {
    counter += 1;
    return createHarness({
        profile: qaProfile(),
        initial: {at: 1},
        registry: storyRegistry().registry,
        model: resolved,
        sessionLog: await createJsonlSessionLog({root, sessionId: `p${counter}`}),
    });
}

describe("模型与密钥（输出 18）", () => {
    test("请求发往模型配置的地址，带的是指定变量里的密钥", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "the-key";
        server.reply({status: 200, text: "你好"});
        const harness = await session();
        const result = await harness.turn("问");
        await harness.close();

        expect(result).toMatchObject({stopReason: "stop", text: "你好"});
        expect(server.seen).toEqual([{path: "/v1/chat/completions", authorization: "Bearer the-key"}]);
    });

    test("指定变量缺失或为空：auth 结束，不发出请求，也不改用 OPENAI_API_KEY", async () => {
        process.env.OPENAI_API_KEY = "someone-elses-key";
        for (const value of [undefined, ""]) {
            if (value === undefined) delete process.env.NB_PROVIDER_TEST_KEY;
            else process.env.NB_PROVIDER_TEST_KEY = value;
            const harness = await session();
            const result = await harness.turn("问");
            await harness.close();
            expect(result.error?.kind).toBe("auth");
        }
        expect(server.seen).toEqual([]);
    });

    test.each(["secret-key-echoed-123", "sk-abcd"])("401 的错误正文回显了密钥（%s）：结果、会话日志与交给订阅者的事件里都遮盖掉，归类仍是 auth（验收 7）", async (key) => {
        process.env.NB_PROVIDER_TEST_KEY = key;
        server.reply({status: 401, echoKey: true});
        const harness = await session();
        // 订阅者收到的每个事件（序列化后推给网页的样子）也不含密钥：错误快照会出现在 message_start、turn_end、agent_end 里。
        const events: string[] = [];
        harness.subscribe((event) => events.push(serializeAgentEvent(event)));
        const result = await harness.turn("问");
        await harness.close();
        const logged = await readFile(join(root, `p${counter}.jsonl`), "utf8");

        expect(events.length).toBeGreaterThan(3);
        expect(events.filter((event) => event.includes(key))).toEqual([]);
        expect(result.error).toMatchObject({kind: "auth", status: 401});
        expect(result.error?.message).toContain(REDACTED_KEY);
        expect(result.error?.message).not.toContain(key);
        expect(logged).toContain(REDACTED_KEY);
        expect(logged).not.toContain(key);

        server.reply({status: 401, echoKey: true});
        const single = await complete({profile: noToolsProfile, initial: {}, input: "x", model: model()});
        expect(single.error).toMatchObject({kind: "auth", status: 401});
        expect(single.error?.message).not.toContain(key);
    });

    test("apiKey: none 的端点不带认证头", async () => {
        process.env.OPENAI_API_KEY = "someone-elses-key";
        server.reply({status: 200, text: "无认证"});
        const harness = await session(model({apiKeyEnv: undefined, apiKey: "none"}));
        await harness.turn("问");
        await harness.close();

        expect(server.seen).toEqual([{path: "/v1/chat/completions", authorization: null}]);
    });
});

describe("用量（输出 11，验收 6）", () => {
    test("provider 层重试过（503 后成功）：只计可见消息的用量，complete 为 false", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "k";
        server.reply({status: 503}, {status: 200, text: "重试后"});
        const harness = await session(model({price: {input: 1, output: 1, currency: "USD"}}));
        const result = await harness.turn("问");
        await harness.close();

        expect(server.seen).toHaveLength(2);
        expect(result).toMatchObject({stopReason: "stop", text: "重试后"});
        expect(result.usage).toMatchObject({input: 12, output: 3, complete: false});
        expect(result.usage.cost).toBeGreaterThan(0);
    });

    test("没有重试：complete 为 true", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "k";
        server.reply({status: 200, text: "一次成功"});
        const harness = await session();
        const result = await harness.turn("问");
        await harness.close();

        expect(result.usage).toMatchObject({input: 12, output: 3, cost: null, complete: true});
    });
});

describe("流结束没有结束原因（#258）", () => {
    test("网关送了 [DONE] 却没送 finish_reason：会话与单次请求都记 length（被截断），不当正常结束", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "the-key";
        server.reply({status: 200, text: "写到一半", noFinishReason: true});
        const harness = await session();
        const cut = await harness.turn("问");
        await harness.close();
        expect(cut).toMatchObject({stopReason: "length", text: "写到一半"});

        server.reply({status: 200, text: "写到一半", noFinishReason: true}, {status: 200, text: "写完了"});
        expect(await complete({profile: noToolsProfile, initial: {}, input: "x", model: model()})).toMatchObject({stopReason: "length", text: "写到一半"});
        // 带了 finish_reason 的正常结束不变。
        expect(await complete({profile: noToolsProfile, initial: {}, input: "x", model: model()})).toMatchObject({stopReason: "stop", text: "写完了"});
    });
});

describe("单次请求（输出 17）", () => {
    const noTools = noToolsProfile;

    test("不带工具的 Profile：请求一次，input 是唯一一条用户消息", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "k";
        server.reply({status: 200, text: "好"});
        const result = await complete({profile: noTools, initial: {}, input: "打个招呼", model: model()});

        expect(result).toMatchObject({stopReason: "stop", text: "好", error: null, usage: {input: 12, complete: true}});
        expect(server.seen).toHaveLength(1);
        expect(bodies[0]!.filter((message) => message.role !== "system" && message.role !== "developer")).toEqual([{role: "user", content: "打个招呼"}]);
    });

    test("provider 在建流时抛错：返回 error（provider），不直接抛出", async () => {
        process.env.NB_PROVIDER_TEST_KEY = "k";
        const result = await complete({
            profile: noTools,
            initial: {},
            input: "x",
            model: model(),
            streamFn: () => {
                throw new Error("provider 不可用");
            },
        });
        expect(result).toMatchObject({stopReason: "error", error: {kind: "provider"}, usage: {complete: false}});
    });

    test("声明了工具的 Profile 报 profile_has_tools", async () => {
        const withTools = defineProfile({...noTools, manifest: noTools.manifest, initialSchema: noTools.initialSchema, tools: [toolRef("story.search")], context: noTools.context});
        let code = "";
        try {
            await complete({profile: withTools, initial: {}, input: "x", model: model()});
        } catch (error) {
            code = error instanceof HarnessError ? error.code : String(error);
        }
        expect(code).toBe("profile_has_tools");
    });
});
