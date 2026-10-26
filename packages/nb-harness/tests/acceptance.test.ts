/**
 * 跨几条规则的组合场景（docs/specs/agent/harness.md 验收 1、4、5）与内置工具在真实 Agent 循环里的行为。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {defineProfile, HistorySet, optional, ProfilePrompt, System, toolRef} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import {createHarness, createToolRegistry, PLUGIN_UNAVAILABLE, registerBuiltinTools, registerPlugin} from "../src";
import {scriptedModel, toolCall} from "../src/testing";
import {qaProfile, storyRegistry, testModel, text} from "./support";

let root = "";
let counter = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "acceptance");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const log = async () => createJsonlSessionLog({root, sessionId: `a${(counter += 1)}`});

describe("验收 1：封闭的问答 Agent", () => {
    test("可选工具已登记时进工具集，<If tool> 段落随之出现", async () => {
        const {registry} = storyRegistry();
        registerPlugin(registry, {name: "timeline", version: "1", tools: [{declaration: {id: "story.timeline", name: "story_timeline", description: "时间线", parameters: {type: "object"}}, impl: {execute: async () => text("t")}}]});
        const script = scriptedModel(["好"]);
        const harness = await createHarness({profile: qaProfile(), initial: {at: 3}, registry, model: testModel(), sessionLog: await log(), streamFn: script.streamFn});
        await harness.turn("问");
        await harness.close();

        expect(script.requests[0]?.tools?.map((tool) => tool.name)).toEqual(["story_search", "story_timeline", "submit_answer"]);
        expect(script.requests[0]?.systemPrompt).toEqual(["读到第 3 章。\n可以查时间线。"]);
    });
});

describe("验收 4：撤回在途调用", () => {
    test("工具执行中插件被卸载：这次调用记中断结果，运行继续；之后的调用得到 plugin-unavailable", async () => {
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const {registry, plugin} = storyRegistry(async () => {
            started.resolve();
            await gate.promise;
            return text("迟到的结果");
        });
        const script = scriptedModel([[toolCall("c1", "story_search", {query: "a"})], [toolCall("c2", "story_search", {query: "b"})], "放弃了"]);
        const harness = await createHarness({profile: qaProfile({tools: [optional(toolRef("story.search"))]}), initial: {at: 1}, registry, model: testModel(), sessionLog: await log(), streamFn: script.streamFn});
        const running = harness.turn("问");
        await started.promise;
        plugin.unregister();
        gate.resolve();
        const result = await running;
        await harness.close();

        expect(result).toMatchObject({stopReason: "stop", text: "放弃了"});
        const results = script.requests[2]!.messages.filter((message) => message.role === "toolResult");
        expect(results.map((message) => [message.toolCallId, (message.details as {code?: string; interrupted?: boolean}).code, (message.details as {interrupted?: boolean}).interrupted])).toEqual([
            ["c1", PLUGIN_UNAVAILABLE, true],
            ["c2", PLUGIN_UNAVAILABLE, false],
        ]);
    });
});

describe("验收 5：两个会话", () => {
    test("同一 Profile 以不同 initial 开两个会话并行运行，工具拿到各自的 initial", async () => {
        const seen: unknown[] = [];
        const {registry} = storyRegistry(async (_args, context) => (seen.push(context.initial), text("ok")));
        const open = async (at: number) => {
            const script = scriptedModel([[toolCall(`c${at}`, "story_search", {})], "完"]);
            return createHarness({profile: qaProfile(), initial: {at}, registry, model: testModel(), sessionLog: await log(), streamFn: script.streamFn});
        };
        const [a, b] = await Promise.all([open(10), open(20)]);
        await Promise.all([a.turn("问"), b.turn("问")]);
        await Promise.all([a.close(), b.close()]);

        expect(seen).toContainEqual({at: 10});
        expect(seen).toContainEqual({at: 20});
        expect(seen).toHaveLength(2);
    });
});

describe("内置工具", () => {
    const fileProfile = defineProfile({
        manifest: {key: "files", version: "1", name: "改文件", description: "测试"},
        initialSchema: Type.Object({}),
        tools: [toolRef("builtin.read"), toolRef("builtin.edit")],
        context: () => ProfilePrompt({children: [System({children: ["改文件"]}), HistorySet()]}),
    });

    test("只有 Profile 声明了才看得到；edit 的调度与参数协议经声明保留", async () => {
        const registry = createToolRegistry();
        registerBuiltinTools(registry, {read: {cwd: root}, edit: {cwd: root}});
        const script = scriptedModel(["好"]);
        const harness = await createHarness({profile: fileProfile, initial: {}, registry, model: testModel(), sessionLog: await log(), streamFn: script.streamFn});
        await harness.turn("问");
        await harness.close();
        const qa = scriptedModel(["好"]);
        const other = await createHarness({profile: qaProfile(), initial: {at: 1}, registry: storyRegistry().registry, model: testModel(), sessionLog: await log(), streamFn: qa.streamFn});
        await other.turn("问");
        await other.close();

        const tools = script.requests[0]?.tools ?? [];
        expect(tools.map((tool) => tool.name)).toEqual(["read", "edit"]);
        expect(tools[1]).toMatchObject({customFormat: {syntax: "lark"}});
        expect(qa.requests[0]?.tools?.map((tool) => tool.name)).not.toContain("read");
    });
});
