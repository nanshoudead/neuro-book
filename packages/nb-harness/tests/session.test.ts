/**
 * 会话与一次运行（docs/specs/agent/harness.md 输出 1 到 16、状态与转换、F1 到 F7）。
 * 模型输出用脚本化 streamFn 替换，Agent 调度、工具参数校验、会话日志（真实 JSONL）都走真的。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {Flag} from "@oh-my-pi/pi-ai/error/flags";
import {createJsonlSessionLog, type SessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createHarness, HarnessError, type ErrorKind, type Harness, type HarnessOptions} from "../src";
import {scriptedModel, toolCall, type ScriptedInput, type ScriptedStep} from "../src/testing";
import {qaProfile, storyRegistry, testModel, text} from "./support";

let root = "";
let counter = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "session");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function newLog(): Promise<SessionLog> {
    counter += 1;
    return createJsonlSessionLog({root, sessionId: `s${counter}`});
}

async function open(steps: readonly ScriptedInput[], overrides: Partial<HarnessOptions> = {}) {
    const script = scriptedModel(steps);
    const log = overrides.sessionLog ?? (await newLog());
    const harness = await createHarness({
        profile: qaProfile(),
        initial: {at: 38},
        registry: storyRegistry().registry,
        model: testModel(),
        sessionLog: log,
        streamFn: script.streamFn,
        ...overrides,
    });
    return {harness, log, script};
}

function codeOf(error: unknown): string {
    return error instanceof HarnessError ? error.code : `other: ${String(error)}`;
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "resolved";
    } catch (error) {
        return codeOf(error);
    }
}

const userTexts = (messages: readonly {role: string; content?: unknown}[]) => messages.filter((message) => message.role === "user").map((message) => message.content);

describe("新会话与上下文（输出 1 到 3、7 到 9）", () => {
    test("模型只看到生效工具集；系统提示词按初始输入与工具集渲染；每次请求恰好一条本轮输入", async () => {
        const {harness, log, script} = await open(["第一次回答", "第二次回答"]);
        try {
            expect(harness.tools).toEqual(["story.search", "qa.answer"]);
            const first = await harness.turn("问题一");
            const second = await harness.turn("问题二");

            expect(first).toMatchObject({stopReason: "stop", text: "第一次回答", error: null, finish: null});
            expect(second.text).toBe("第二次回答");
            const [request1, request2] = script.requests;
            expect(request1?.tools?.map((tool) => tool.name)).toEqual(["story_search", "submit_answer"]);
            expect(request1?.systemPrompt).toEqual(["读到第 38 章。"]);
            expect(userTexts(request1!.messages)).toEqual(["问题一"]);
            expect(userTexts(request2!.messages)).toEqual(["问题一", "问题二"]);
            // 前缀稳定：第二次请求的前几条与第一次请求逐字段相同（输出 9）。
            expect(request2!.messages.slice(0, request1!.messages.length)).toEqual(request1!.messages);

            const entries = await log.read();
            expect(entries[0]).toMatchObject({kind: "session_snapshot", profile: {key: "story-qa", version: "1"}, initial: {at: 38}});
            expect(entries.map((entry) => entry.kind)).toEqual(["session_snapshot", "agent_message", "agent_message", "usage", "agent_message", "agent_message", "usage"]);
            expect(second.entries.map((entry) => entry.kind)).toEqual(["agent_message", "agent_message", "usage"]);
        } finally {
            await harness.close();
        }
    });

    test("新会话缺 initial 或不合 schema 报 invalid_initial，必需工具没登记报 tool_unavailable；都不写日志", async () => {
        const log = await newLog();
        const base = {profile: qaProfile(), registry: storyRegistry().registry, model: testModel(), sessionLog: log};

        expect(await rejectionCode(createHarness(base))).toBe("invalid_initial");
        expect(await rejectionCode(createHarness({...base, initial: {at: 0}}))).toBe("invalid_initial");
        const {registry} = storyRegistry();
        expect(await rejectionCode(createHarness({...base, initial: {at: 1}, profile: qaProfile({tools: [{kind: "tool-ref", id: "story.ledger"}]}), registry}))).toBe("tool_unavailable");
        expect(await log.read()).toEqual([]);
    });
});

describe("恢复会话（输出 4、8）", () => {
    test("关闭再恢复：恢复后第一次请求收到的历史与关闭前逐字段相同；登记表后来的变化不影响快照", async () => {
        const first = await open([[toolCall("c1", "story_search", {query: "狐狸"})], "查到了"]);
        await first.harness.turn("谁是狐狸");
        await first.harness.close();
        const before = first.script.requests.at(-1)!;

        const resumed = await open(["恢复后的回答"], {sessionLog: first.log, initial: undefined});
        try {
            await resumed.harness.turn("接着问");
            const after = resumed.script.requests[0]!;
            const history = after.messages.slice(0, -1);
            expect(history).toEqual([...before.messages, expect.objectContaining({role: "assistant"})]);
            expect(history.at(-1)).toMatchObject({content: [{type: "text", text: "查到了"}]});
            expect(userTexts(after.messages)).toEqual(["谁是狐狸", "接着问"]);
        } finally {
            await resumed.harness.close();
        }
    });

    test("Profile 版本或工具声明变了、恢复时又给 initial、日志没有快照：都拒绝", async () => {
        const first = await open(["好"]);
        await first.harness.turn("一");
        await first.harness.close();
        const resume = (overrides: Partial<HarnessOptions>) =>
            createHarness({profile: qaProfile(), registry: storyRegistry().registry, model: testModel(), sessionLog: first.log, ...overrides});

        expect(await rejectionCode(resume({profile: qaProfile({version: "2"})}))).toBe("session_incompatible");
        expect(await rejectionCode(resume({initial: {at: 2}}))).toBe("invalid_initial");
        const changed = storyRegistry();
        changed.plugin.unregister();
        expect(await rejectionCode(resume({registry: changed.registry}))).toBe("session_incompatible");

        const legacy = await newLog();
        await legacy.append([{kind: "message", role: "user", text: "旧格式"}]);
        expect(await rejectionCode(resume({sessionLog: legacy}))).toBe("session_incompatible");
    });
});

describe("收尾工具（输出 13 到 16）", () => {
    test("单独调用且成功：finished，参数就是结果，之后不再请求模型；结果写进了日志", async () => {
        const {harness, log, script} = await open([[toolCall("a1", "submit_answer", {conclusion: "是同一人"})]]);
        try {
            const result = await harness.turn("问");
            expect(result).toMatchObject({stopReason: "finished", finish: {tool: "qa.answer", args: {conclusion: "是同一人"}}, error: null});
            expect(script.requests).toHaveLength(1);
            const last = (await log.read()).at(-1);
            expect(last).toMatchObject({kind: "agent_message", message: {role: "toolResult", toolCallId: "a1", isError: false}});
        } finally {
            await harness.close();
        }
    });

    test("校验失败就退回，模型改了再交", async () => {
        let attempts = 0;
        const profile = qaProfile({
            answer: async (args) => {
                attempts += 1;
                return args.conclusion === "坏" ? {content: [{type: "text", text: "依据晚于阅读位置"}], isError: true} : text("已记录");
            },
        });
        const {harness, script} = await open([[toolCall("a1", "submit_answer", {conclusion: "坏"})], [toolCall("a2", "submit_answer", {conclusion: "好"})]], {profile});
        try {
            const result = await harness.turn("问");
            expect(result).toMatchObject({stopReason: "finished", finish: {args: {conclusion: "好"}}});
            expect(attempts).toBe(2);
            expect(script.requests).toHaveLength(2);
            expect(script.requests[1]!.messages.at(-1)).toMatchObject({role: "toolResult", toolCallId: "a1", isError: true});
        } finally {
            await harness.close();
        }
    });

    test("和别的工具混在一批、或一批两个收尾：收尾都不执行并退回，别的工具照常执行", async () => {
        let answered = 0;
        const profile = qaProfile({answer: async () => ((answered += 1), text("已记录"))});
        const {harness, script} = await open(
            [
                [toolCall("a1", "submit_answer", {conclusion: "早"}), toolCall("s1", "story_search", {query: "x"})],
                [toolCall("a2", "submit_answer", {conclusion: "一"}), toolCall("a3", "submit_answer", {conclusion: "二"})],
                [toolCall("a4", "submit_answer", {conclusion: "单独"})],
            ],
            {profile},
        );
        try {
            const result = await harness.turn("问");
            expect(result).toMatchObject({stopReason: "finished", finish: {args: {conclusion: "单独"}}});
            expect(answered).toBe(1);
            const results = script.requests[1]!.messages.filter((message) => message.role === "toolResult");
            expect(results.map((message) => [message.toolCallId, message.isError])).toEqual([
                ["a1", true],
                ["s1", false],
            ]);
            const batch2 = script.requests[2]!.messages.filter((message) => message.role === "toolResult").slice(-2);
            expect(batch2.map((message) => [message.toolCallId, message.isError])).toEqual([
                ["a2", true],
                ["a3", true],
            ]);
        } finally {
            await harness.close();
        }
    });
});

describe("出错、取消与用量（输出 10 到 12）", () => {
    test("provider 错误按状态码与标记归类：429 为 rate_limit，带用尽标记为 quota，网关状态或无状态的瞬时故障为 network，证据不够为 provider", async () => {
        const cases: [ScriptedStep["error"], ErrorKind][] = [
            [{message: "too many", status: 429}, "rate_limit"],
            [{message: "quota", status: 429, errorId: Flag.UsageLimit}, "quota"],
            [{message: "denied", status: 401}, "auth"],
            [{message: "reset", errorId: Flag.Transient}, "network"],
            [{message: "gateway", status: 524}, "network"],
            [{message: "无状态也无标记"}, "provider"],
            [{message: "拦截", errorId: Flag.ContentBlocked}, "provider"],
            [{message: "bad", status: 400}, "provider"],
            [{message: "long", status: 400, errorId: Flag.ContextOverflow}, "context_overflow"],
        ];
        for (const [error, kind] of cases) {
            const {harness, log} = await open([{content: [], error}]);
            const result = await harness.turn("问");
            await harness.close();
            expect(result.stopReason).toBe("error");
            expect(result.error?.kind).toBe(kind);
            expect((await log.read()).at(-1)).toMatchObject({kind: "run_end", stopReason: "error"});
        }
    });

    test("密钥变量缺失：发请求之前以 auth 结束", async () => {
        const {harness, script} = await open(["不应请求"]);
        delete process.env.NB_HARNESS_TEST_KEY;
        try {
            const result = await harness.turn("问");
            expect(result.error?.kind).toBe("auth");
            expect(script.requests).toHaveLength(0);
        } finally {
            await harness.close();
        }
    });

    test("输出被截断为 length；单价未知时 cost 为 null，已知时照算", async () => {
        const unknown = await open([{content: "半截", stopReason: "length", usage: {input: 10, output: 5, cost: 0.5}}]);
        const known = await open([{content: "完整", usage: {input: 10, output: 5, cost: 0.5}}], {model: testModel(true)});
        const a = await unknown.harness.turn("问");
        const b = await known.harness.turn("问");
        await unknown.harness.close();
        await known.harness.close();

        expect(a).toMatchObject({stopReason: "length", text: "半截", usage: {input: 10, output: 5, cost: null, complete: true}});
        expect(b.usage).toMatchObject({cost: 0.5, complete: true});
    });

    test("调用方取消：aborted，用量标为不完整，日志记一条运行结束", async () => {
        const gate = Promise.withResolvers<void>();
        const requested = Promise.withResolvers<void>();
        const {harness, log} = await open([{content: "迟到", gate: gate.promise, onRequest: requested.resolve}]);
        const controller = new AbortController();
        try {
            const running = harness.turn("问", {signal: controller.signal});
            await requested.promise;
            controller.abort();
            gate.resolve();
            const result = await running;
            expect(result.stopReason).toBe("aborted");
            expect(result.usage.complete).toBe(false);
            expect((await log.read()).at(-1)).toMatchObject({kind: "run_end", stopReason: "aborted"});
        } finally {
            await harness.close();
        }
    });
});

describe("状态与转换", () => {
    test("运行中再调 turn 报 session_busy，日志里没有第二次的输入", async () => {
        const gate = Promise.withResolvers<void>();
        const {harness, log} = await open([{content: "一", gate: gate.promise}]);
        try {
            const first = harness.turn("第一次");
            expect(await rejectionCode(harness.turn("第二次"))).toBe("session_busy");
            gate.resolve();
            await first;
            const inputs = (await log.read()).flatMap((entry) => (entry.kind === "agent_message" && (entry.message as {role: string}).role === "user" ? [(entry.message as {content: string}).content] : []));
            expect(inputs).toEqual(["第一次"]);
        } finally {
            await harness.close();
        }
    });

    test("关闭在途运行：运行以 aborted 结束，日志里没有未配对的工具调用；关闭后 turn 与 subscribe 报 session_closed，重复 close 幂等", async () => {
        const gate = Promise.withResolvers<void>();
        const toolDone = Promise.withResolvers<void>();
        const {harness, log} = await open([[toolCall("c1", "story_search", {query: "x"})], {content: "不会到这里", gate: gate.promise}]);
        harness.subscribe((event) => {
            if (event.type === "tool_execution_end") toolDone.resolve();
        });
        const running = harness.turn("问");
        await toolDone.promise;

        const closing = harness.close();
        expect(harness.close()).toBe(closing);
        gate.resolve();
        await closing;
        const result = await running;

        expect(result.stopReason).toBe("aborted");
        const messages = (await log.read()).flatMap((entry) => (entry.kind === "agent_message" ? [entry.message as {role: string; content?: unknown; toolCallId?: string}] : []));
        const calls = messages.flatMap((message) => (message.role === "assistant" ? (message.content as {type: string; id?: string}[]).filter((block) => block.type === "toolCall").map((block) => block.id) : []));
        const answered = messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId);
        expect(calls.every((id) => answered.includes(id))).toBe(true);
        expect(await rejectionCode(harness.turn("再问"))).toBe("session_closed");
        expect(() => harness.subscribe(() => undefined)).toThrow(HarnessError);
    });

    test("准备阶段关闭：不发出任何模型请求", async () => {
        const {harness, script}: {harness: Harness; script: {requests: readonly unknown[]}} = await open(["不应请求"]);
        const running = harness.turn("问");
        await harness.close();
        const result = await running;
        expect(result.stopReason).toBe("aborted");
        expect(script.requests).toHaveLength(0);
    });

    test("会话日志写失败：error（local），不谎报成模型出错", async () => {
        const log = await newLog();
        const broken: SessionLog = {...log, append: async (inputs) => (inputs.some((input) => input.kind === "agent_message") ? Promise.reject(new Error("磁盘满")) : log.append(inputs))};
        const {harness, script} = await open(["不应请求"], {sessionLog: broken});
        try {
            const result = await harness.turn("问");
            expect(result.error?.kind).toBe("local");
            expect(script.requests).toHaveLength(0);
        } finally {
            await harness.close();
        }
    });
});

