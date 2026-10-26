/** 会话测试共用的 Profile、模型与登记表。 */

import type {AgentToolResult} from "@oh-my-pi/pi-agent-core";
import {defineProfile, HistorySet, If, optional, ProfilePrompt, System, toolRef, type ToolSetItem} from "@notnotype/nb-profile";
import {Type} from "typebox";
import {createToolRegistry, defineModel, defineTool, registerPlugin, type ResolvedModel, type ToolImpl} from "../src";

export const text = (value: string): AgentToolResult => ({content: [{type: "text", text: value}]});

/** 不发真实请求的模型：脚本化 streamFn 替换了输出，这里只给装配用的形状。 */
export function testModel(price = false): ResolvedModel {
    process.env.NB_HARNESS_TEST_KEY = "scripted";
    return defineModel({
        provider: "test",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:9/v1",
        id: "scripted",
        apiKeyEnv: "NB_HARNESS_TEST_KEY",
        ...(price ? {price: {input: 1, output: 2, currency: "USD"}} : {}),
    });
}

/** 问答一类的 Profile：初始输入是阅读位置，查询工具一个必需一个可选，加一个收尾工具。 */
export function qaProfile(extra: {readonly tools?: readonly ToolSetItem[]; readonly version?: string; readonly answer?: ToolImpl["execute"]} = {}) {
    const answer = defineTool({
        id: "qa.answer",
        name: "submit_answer",
        description: "交答案",
        parameters: {type: "object", properties: {conclusion: {type: "string"}}, required: ["conclusion"]},
        finish: true,
        execute: extra.answer ?? (async () => text("已记录")),
    });
    return defineProfile({
        manifest: {key: "story-qa", version: extra.version ?? "1", name: "问答", description: "测试"},
        initialSchema: Type.Object({at: Type.Integer({minimum: 1})}),
        tools: extra.tools ?? [toolRef("story.search"), optional(toolRef("story.timeline")), answer],
        context: (ctx) =>
            ProfilePrompt({
                children: [
                    System({children: [`读到第 ${ctx.initial.at} 章。`, If({tool: "story.timeline", children: ["可以查时间线。"]})]}),
                    HistorySet(),
                ],
            }),
    });
}

/** 登记一个 `story.search` 工具；`search` 可以替换它的实现。 */
export function storyRegistry(search: ToolImpl["execute"] = async (args) => text(`结果：${JSON.stringify(args)}`)) {
    const registry = createToolRegistry();
    const plugin = registerPlugin(registry, {
        name: "nb-story",
        version: "1",
        tools: [{declaration: {id: "story.search", name: "story_search", description: "搜索", parameters: {type: "object", properties: {query: {type: "string"}}}}, impl: {execute: search}}],
    });
    return {registry, plugin};
}
