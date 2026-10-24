/**
 * 问答引擎测试用的工具：样例书的临时书库、只替换模型输出的脚本化模型，以及从模型收到的请求里取工具结果。
 */

import {scriptedModel, type ScriptedInput, type ScriptedModel} from "@notnotype/nb-harness/testing";

import type {QaConfig} from "../src/qa/config";
import {askQuestion, prepareQuestion, type AskInput, type PreparedQuestion, type QaOutcome, type QaProgress} from "../src/qa/engine";
import type {TestBook} from "./api";

/** 脚本化模型不发请求，但 harness 每次请求前都要取到密钥：用一个只在测试进程里存在的假值。 */
export const TEST_KEY_ENV = "NBSTORY_QA_TEST_CREDENTIAL";

/** 测试用的配置。作答方式缺省写成结构化：大多数用例测的是 answer 交卷；测 Markdown 的用例另给 `answer`。 */
export function testConfig(qa: QaConfig["qa"] = {}): QaConfig {
    return {providers: {test: {api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: TEST_KEY_ENV, models: [{id: "scripted"}]}}, models: ["test/scripted"], model: {use: "test/scripted"}, qa: {answer: "structured", ...qa}};
}

export interface ScriptedAsk {
    outcome: QaOutcome;
    model: ScriptedModel;
    progress: QaProgress[];
}

/** 用脚本化模型问一问。 */
export async function askScripted(book: TestBook, steps: readonly ScriptedInput[], input: Partial<Omit<AskInput, "api" | "streamFn">> = {}): Promise<ScriptedAsk> {
    process.env[TEST_KEY_ENV] ??= "scripted-model-placeholder";
    const model = scriptedModel(steps);
    const progress: QaProgress[] = [];
    const outcome = await askQuestion({
        api: book.api,
        mode: "graph",
        question: "测试问题",
        config: testConfig(),
        ...input,
        onProgress: event => progress.push(event),
        streamFn: model.streamFn,
    });
    return {outcome, model, progress};
}

/** 只准备一轮（网页问答的第一步），用脚本化模型。 */
export async function prepareScripted(book: TestBook, steps: readonly ScriptedInput[], input: Partial<Omit<AskInput, "api" | "streamFn">> = {}): Promise<{prepared: PreparedQuestion; model: ScriptedModel}> {
    process.env[TEST_KEY_ENV] ??= "scripted-model-placeholder";
    const model = scriptedModel(steps);
    const prepared = await prepareQuestion({api: book.api, mode: "graph", question: "测试问题", config: testConfig(), ...input, streamFn: model.streamFn});
    return {prepared, model};
}

/** 第 `request` 次请求（从 0 数）里，模型收到的上一批工具结果的文字，按上一条助手消息里的调用先后排（结果按完成先后到达）。 */
export function toolResults(model: ScriptedModel, request: number): {text: string; isError: boolean}[] {
    const messages = model.requests[request]!.messages;
    const results = new Map<string, {text: string; isError: boolean}>();
    let index = messages.length - 1;
    for (; index >= 0 && messages[index]!.role === "toolResult"; index -= 1) {
        const message = messages[index] as {toolCallId: string; content: {type: string; text?: string}[]; isError?: boolean};
        results.set(message.toolCallId, {text: message.content.map(block => block.text ?? "").join(""), isError: message.isError === true});
    }
    const calls = (messages[index] as {content: {type: string; id?: string}[]}).content.filter(block => block.type === "toolCall");
    return calls.map(call => results.get(call.id!)!);
}
