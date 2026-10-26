/**
 * 适配器与真实 harness 对契约：用 nb-harness 的脚本化模型跑真的 `createHarness`（Agent 调度、工具、会话日志都是真的，
 * 只替换模型输出），把它发出的事件（经 `serializeAgentEvent`，与 SSE 推给浏览器的是同一份）和写进内存日志的条目交给
 * 适配器。nb-harness 只是开发依赖，核心不依赖它（`boundary.test.ts`）。
 */

import {describe, expect, it} from "bun:test";

import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createHarness, createToolRegistry, defineModel, defineTool, registerBuiltinTools, serializeAgentEvent} from "@notnotype/nb-harness";
import {scriptedModel, toolCall} from "@notnotype/nb-harness/testing";
import type {ScriptedInput} from "@notnotype/nb-harness/testing";
import {defineProfile, HistorySet, ProfilePrompt, toolRef} from "@notnotype/nb-profile";
import {createMemorySessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {createHarnessTranscript} from "./harness";
import {builtinToolRenderers} from "./builtin-tools";
import {buildTurns} from "./conversation-turns";
import {createAgentViewRegistry} from "./registry";
import {editInputChanges} from "./tool-formats";
import type {MessageView} from "./types";

const reply = (text: string) => ({content: [{type: "text" as const, text}]});

const lookup = defineTool({
    id: "lab.lookup", name: "lookup", description: "查书", finish: false,
    parameters: {type: "object", properties: {query: {type: "string"}}},
    execute: async (args) => reply(`查到：${JSON.stringify(args)}`),
});
const answer = defineTool({
    id: "lab.answer", name: "answer", description: "交答案", finish: true,
    parameters: {type: "object", properties: {conclusion: {type: "string"}}, required: ["conclusion"]},
    execute: async () => reply("已记录"),
});
const profile = defineProfile({
    manifest: {key: "transcript-contract", version: "1", name: "适配器契约", description: "只替模型输出"},
    initialSchema: Type.Object({}),
    tools: [lookup, answer],
    context: () => ProfilePrompt({children: [HistorySet()]}),
});

type RunOptions = {steps: readonly ScriptedInput[]; price?: boolean; missingKey?: boolean; abort?: boolean};

/** 跑一轮，收下事件（SSE 帧里的 JSON）与日志条目。 */
async function run(options: RunOptions): Promise<{events: unknown[]; entries: unknown[]}> {
    const keyEnv = "NB_AGENT_UI_CONTRACT_KEY";
    if (options.missingKey === true) delete process.env[keyEnv];
    else process.env[keyEnv] = "scripted";
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const controller = new AbortController();
    const steps = options.abort === true ? [{content: "不会到", gate, onRequest: () => controller.abort()}] : options.steps;
    const scripted = scriptedModel(steps);
    const log = createMemorySessionLog({sessionId: "contract"});
    const model = defineModel({
        provider: "contract", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", id: "scripted", apiKeyEnv: keyEnv,
        ...(options.price === true ? {price: {input: 0, output: 0, currency: "USD" as const}} : {}),
    });
    const harness = await createHarness({profile, initial: {}, registry: createToolRegistry(), model, sessionLog: log, streamFn: scripted.streamFn});
    const events: unknown[] = [];
    const off = harness.subscribe((event) => {
        const data = serializeAgentEvent(event).split("\n").find((line) => line.startsWith("data: "));
        if (data !== undefined) events.push(JSON.parse(data.slice("data: ".length)));
    });
    try {
        const turn = harness.turn("第三章里谁知道钟声的秘密？", {signal: controller.signal});
        release();
        await turn;
    } finally {
        off();
        await harness.close();
    }
    return {events, entries: [...await log.read()]};
}

function fromLog(entries: readonly unknown[]): {messages: readonly MessageView[]; problems: readonly unknown[]} {
    const transcript = createHarnessTranscript();
    for (const entry of entries) transcript.applyLogEntry(entry);
    return {messages: transcript.messages(), problems: transcript.problems()};
}

/** 先按事件画（运行中），再补日志：最终结果要与只读日志相同。 */
function fromEventsThenLog(events: readonly unknown[], entries: readonly unknown[]): readonly MessageView[] {
    const transcript = createHarnessTranscript();
    for (const event of events) transcript.applyEvent(event);
    for (const entry of entries) transcript.applyLogEntry(entry);
    return transcript.messages();
}

describe("harness 适配器与真实 harness", () => {
    it("普通完成：先调工具再回复；先画事件再补日志与只读日志结果相同；单价未知时费用为 null", async () => {
        const {events, entries} = await run({steps: [[toolCall("c1", "lookup", {query: "钟声"})], "林默知道。"]});
        const {messages, problems} = fromLog(entries);
        expect(problems).toEqual([]);
        expect(messages.map((message) => message.kind)).toEqual(["user", "assistant", "assistant"]);
        const [, first, second] = messages;
        expect(first?.kind === "assistant" && first.toolCalls).toEqual([expect.objectContaining({id: "c1", name: "lookup", status: "success", result: expect.objectContaining({text: "查到：{\"query\":\"钟声\"}"})})]);
        expect(second).toMatchObject({kind: "assistant", status: "done", text: "林默知道。", usage: {cost: null}});
        expect(fromEventsThenLog(events, entries)).toEqual(messages);
    });

    it("run()：真实事件里 agent_start 之后是运行中，agent_end 之后回到空闲", async () => {
        const {events} = await run({steps: ["好的。"]});
        const transcript = createHarnessTranscript();
        const types = events.map((event) => (event as {type?: string}).type);
        const start = types.indexOf("agent_start");
        const end = types.lastIndexOf("agent_end");
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(transcript.run().status).toBe("idle");
        for (const event of events.slice(0, start + 1)) transcript.applyEvent(event);
        expect(transcript.run().status).toBe("running");
        for (const event of events.slice(start + 1)) transcript.applyEvent(event);
        expect(transcript.run().status).toBe("idle");
    });

    it("运行中只喂到助手消息开始时，画出的是流式中的助手消息", async () => {
        // 脚本化模型一步给出整段，不发 message_update；真模型的逐字更新走同一条路径（单测覆盖）。
        const {events} = await run({steps: ["一段回复"]});
        const transcript = createHarnessTranscript();
        const start = events.findIndex((event) => {
            const record = event as {type?: string; message?: {role?: string}};
            return record.type === "message_start" && record.message?.role === "assistant";
        });
        expect(start).toBeGreaterThan(-1);
        for (const event of events.slice(0, start + 1)) transcript.applyEvent(event);
        expect(transcript.messages().at(-1)).toMatchObject({kind: "assistant", status: "streaming"});
    });

    it("收尾工具完成：工具调用成功，没有错误条目", async () => {
        const {entries} = await run({steps: [[toolCall("f1", "answer", {conclusion: "林默"})]]});
        const {messages, problems} = fromLog(entries);
        expect(problems).toEqual([]);
        expect(messages.some((message) => message.kind === "error")).toBe(false);
        const last = messages.at(-1);
        expect(last?.kind === "assistant" && last.toolCalls[0]).toMatchObject({id: "f1", status: "success"});
    });

    it("收尾工具交成功：分轮时它是这一轮的结果，整轮收起后仍露出，查书那次留在过程里（验收 20）", async () => {
        const {entries} = await run({steps: [[toolCall("c1", "lookup", {query: "钟声"})], [toolCall("f1", "answer", {conclusion: "林默"})]]});
        const {messages} = fromLog(entries);
        const registry = createAgentViewRegistry([
            {source: "builtin:tools", tools: builtinToolRenderers},
            {source: "test:story", tools: [{id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text", label: "作答", summary: () => "", presentation: "node", outcome: true}]},
        ]);
        const [turn] = buildTurns({messages, registry, run: {status: "idle", phase: ""}, history: {hasMore: false, loading: false, error: null}, now: 0});
        expect(turn!.status).toBe("done");
        expect(turn!.foldable).toBe(true);
        expect(turn!.blocks.slice(turn!.outcomeStart).map((block) => block.id)).toEqual(["f1"]);
        expect(turn!.outcomeCallId).toBe("f1");
        expect(turn!.metrics.steps).toBe(1);
    });

    it("运行前就失败（缺密钥）：一个事件都没有，日志里的 run_end 画成一条说明", async () => {
        const {events, entries} = await run({steps: ["不会到"], missingKey: true});
        expect(events).toEqual([]);
        const {messages} = fromLog(entries);
        expect(messages).toEqual([expect.objectContaining({kind: "error", message: "模型服务的密钥缺失或无效，请检查设置。", retryable: false})]);
    });

    it("中途停止：没有错误条目，这一轮末尾是一条已停止的回复（模型还没开口时补一条空的）", async () => {
        const {entries} = await run({steps: [], abort: true});
        const {messages, problems} = fromLog(entries);
        expect(problems).toEqual([]);
        expect(messages.some((message) => message.kind === "error")).toBe(false);
        expect(messages.at(-1)).toMatchObject({kind: "assistant", status: "stopped"});
    });

    it("nb-harness 内置的 edit（参数是一段 input）：改到的文件与 diff 从真实调用里认得出", async () => {
        const root = await createTestTmpRoot("nb-agent-ui", "harness-edit");
        try {
            await mkdir(join(root, "正文"), {recursive: true});
            await writeFile(join(root, "正文", "第三章.md"), "钟声敲到第十一下\n");
            const registry = createToolRegistry();
            registerBuiltinTools(registry, {edit: {cwd: root, mode: "apply_patch"}});
            const editProfile = defineProfile({
                manifest: {key: "transcript-edit", version: "1", name: "改文件", description: "只替模型输出"},
                initialSchema: Type.Object({}),
                tools: [toolRef("builtin.edit")],
                context: () => ProfilePrompt({children: [HistorySet()]}),
            });
            process.env.NB_AGENT_UI_CONTRACT_KEY = "scripted";
            const patch = "*** Begin Patch\n*** Update File: 正文/第三章.md\n@@\n-钟声敲到第十一下\n+钟声敲到第十二下\n*** End Patch";
            const scripted = scriptedModel([[toolCall("e1", "edit", {input: patch})], "改好了。"]);
            const log = createMemorySessionLog({sessionId: "edit"});
            const model = defineModel({provider: "contract", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", id: "scripted", apiKeyEnv: "NB_AGENT_UI_CONTRACT_KEY"});
            const harness = await createHarness({profile: editProfile, initial: {}, registry, model, sessionLog: log, streamFn: scripted.streamFn});
            await harness.turn("把钟声改成十二下");
            await harness.close();
            expect(await readFile(join(root, "正文", "第三章.md"), "utf8")).toContain("十二下");

            const {messages, problems} = fromLog([...await log.read()]);
            expect(problems).toEqual([]);
            const edit = messages.flatMap((message) => (message.kind === "assistant" ? message.toolCalls : [])).find((call) => call.id === "e1");
            expect(edit?.status).toBe("success");
            expect(editInputChanges(edit!).map((change) => change.path)).toEqual(["正文/第三章.md"]);
            expect((createAgentViewRegistry([{source: "builtin:tools", tools: builtinToolRenderers}]).resolveTool("edit").diff?.(edit!) ?? []).some((line) => line.tone === "added" && line.text.includes("十二下"))).toBe(true);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("工具执行中途停止：真实日志里工具结果与中止的助手消息都在，画出来末尾是已停止，没有错误条目", async () => {
        const controller = new AbortController();
        const slow = defineTool({
            id: "lab.slow", name: "slow", description: "慢工具", finish: false,
            parameters: {type: "object", properties: {}},
            execute: async () => {
                controller.abort();
                return reply("做完了一半");
            },
        });
        const slowProfile = defineProfile({
            manifest: {key: "transcript-abort", version: "1", name: "停止", description: "只替模型输出"},
            initialSchema: Type.Object({}),
            tools: [slow],
            context: () => ProfilePrompt({children: [HistorySet()]}),
        });
        process.env.NB_AGENT_UI_CONTRACT_KEY = "scripted";
        const scripted = scriptedModel([[toolCall("s1", "slow")], "不会到"]);
        const log = createMemorySessionLog({sessionId: "abort"});
        const model = defineModel({provider: "contract", api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", id: "scripted", apiKeyEnv: "NB_AGENT_UI_CONTRACT_KEY"});
        const harness = await createHarness({profile: slowProfile, initial: {}, registry: createToolRegistry(), model, sessionLog: log, streamFn: scripted.streamFn});
        const result = await harness.turn("跑一下", {signal: controller.signal});
        await harness.close();
        expect(result.stopReason).toBe("aborted");

        const entries = [...await log.read()];
        expect((entries.at(-1) as {kind?: string}).kind).toBe("run_end");
        const {messages, problems} = fromLog(entries);
        expect(problems).toEqual([]);
        expect(messages.some((message) => message.kind === "error")).toBe(false);
        expect(messages.at(-1)).toMatchObject({kind: "assistant", status: "stopped"});
        const slowCall = messages.flatMap((message) => (message.kind === "assistant" ? message.toolCalls : [])).find((call) => call.id === "s1");
        expect(slowCall?.status).not.toBe("running");
    });

    it("免费模型的费用是 0，不是未知", async () => {
        const {entries} = await run({steps: ["回复"], price: true});
        expect(fromLog(entries).messages.at(-1)).toMatchObject({kind: "assistant", usage: {cost: 0}});
    });
});
