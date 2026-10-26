/**
 * 真实模型 Smoke（docs/specs/agent/harness.md “验收与 Smoke”）：只在显式设置 NBOOK_LLM_TESTS=1 且有凭据时运行
 * （`bun run test:llm`），默认测试不调用模型。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {defineProfile, HistorySet, ProfilePrompt, System, toolRef} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";
import {llmTestConfig, type LlmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import {createHarness, createToolRegistry, defineModel, defineTool, registerBuiltinTools, resolveModel, type ResolvedModel} from "../src";

const llm = llmTestConfig();
let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-llm", "harness-real-model");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 用目录里的模型参数组一个自定义端点的模型：地址取 `DEEPSEEK_API_BASE`（没有时用目录地址），密钥绑定在实例上。 */
function customModel(config: LlmTestConfig): ResolvedModel {
    const base = resolveModel(config.model).model;
    return defineModel({
        provider: base.provider,
        api: base.api,
        baseUrl: config.baseUrl ?? base.baseUrl,
        id: base.id,
        apiKeyEnv: config.apiKeyEnv,
        reasoning: base.reasoning,
        input: base.input,
        contextWindow: base.contextWindow,
        maxTokens: base.maxTokens,
        price: {input: base.cost.input, output: base.cost.output, cacheRead: base.cost.cacheRead, cacheWrite: base.cost.cacheWrite, currency: "USD"},
    });
}

describe.skipIf(llm === null)("真实模型", () => {
    test(
        "自定义端点的模型：经 builtin.read 读文件并回答",
        async () => {
            await writeFile(join(root, "note.txt"), "秘密内容：青鸟计划\n", "utf-8");
            const registry = createToolRegistry();
            registerBuiltinTools(registry, {read: {cwd: root}});
            const profile = defineProfile({
                manifest: {key: "reader", version: "1", name: "读文件", description: "真实模型测试"},
                initialSchema: Type.Object({}),
                tools: [toolRef("builtin.read")],
                context: () => ProfilePrompt({children: [System({children: ["你是严谨的助手，必须调用工具获取事实。"]}), HistorySet()]}),
            });
            const log = await createJsonlSessionLog({root, sessionId: "real-read"});
            const harness = await createHarness({profile, initial: {}, registry, model: customModel(llm!), sessionLog: log});
            try {
                const result = await harness.turn("读取 note.txt（用 read 工具）并原样回答文件里的内容。");
                expect(result.stopReason).toBe("stop");
                expect(result.text).toContain("青鸟计划");
                expect(result.usage.input).toBeGreaterThan(0);
                const calls = (await log.read()).filter((entry) => entry.kind === "agent_message" && (entry.message as {role: string}).role === "toolResult");
                expect(calls.length).toBeGreaterThan(0);
            } finally {
                await harness.close();
            }
        },
        180_000,
    );

    test(
        "带收尾工具的 Profile：模型交答案后以 finished 结束",
        async () => {
            const answer = defineTool({
                id: "test.answer",
                name: "submit_answer",
                description: "提交最终答案。答完必须调用它，不要直接回复文字。",
                parameters: {type: "object", properties: {answer: {type: "string"}}, required: ["answer"]},
                finish: true,
                execute: async () => ({content: [{type: "text", text: "已记录"}]}),
            });
            const profile = defineProfile({
                manifest: {key: "answerer", version: "1", name: "答题", description: "真实模型测试"},
                initialSchema: Type.Object({}),
                tools: [answer],
                context: () => ProfilePrompt({children: [System({children: ["回答用户的问题，并用 submit_answer 工具提交答案。"]}), HistorySet()]}),
            });
            const log = await createJsonlSessionLog({root, sessionId: "real-finish"});
            const harness = await createHarness({profile, initial: {}, registry: createToolRegistry(), model: customModel(llm!), sessionLog: log});
            try {
                const result = await harness.turn("1 加 1 等于几？");
                expect(result.stopReason).toBe("finished");
                expect(JSON.stringify(result.finish?.args)).toContain("2");
            } finally {
                await harness.close();
            }
        },
        180_000,
    );
});
