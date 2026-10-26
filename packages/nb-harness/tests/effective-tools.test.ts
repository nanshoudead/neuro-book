import {describe, expect, test} from "bun:test";
import type {AgentToolResult} from "@oh-my-pi/pi-agent-core";
import {defineProfile, optional, ProfilePrompt, toolRef, type ToolSetItem} from "@notnotype/nb-profile";
import {Type} from "typebox";
import {HarnessError} from "../src/errors";
import {bridgeTools, PLUGIN_UNAVAILABLE} from "../src/tools/bridge";
import {declarationJson, defineTool, resolveEffectiveTools, restoreEffectiveTools} from "../src/tools/effective";
import {createToolRegistry, registerPlugin, type ToolImpl} from "../src/tools/registry";

const text = (value: string): AgentToolResult => ({content: [{type: "text", text: value}]});
const echo: ToolImpl = {execute: async (args) => text(JSON.stringify(args))};

function profile(tools: readonly ToolSetItem[], version = "1") {
    return defineProfile({
        manifest: {key: "story-qa", version, name: "问答", description: "测试"},
        initialSchema: Type.Object({}),
        tools,
        context: () => ProfilePrompt({}),
    });
}

function storyRegistry(extra: Partial<Record<"search" | "card" | "timeline", object>> = {}) {
    const registry = createToolRegistry();
    const plugin = registerPlugin(registry, {
        name: "nb-story",
        version: "1",
        tools: [
            {declaration: {id: "story.search", name: "story_search", description: "搜", parameters: {type: "object", ...extra.search}, finish: false}, impl: echo},
            {declaration: {id: "story.card", name: "story_card", description: "卡", parameters: {type: "object"}, finish: false}, impl: echo},
        ],
    });
    return {registry, plugin};
}

function codeOf(run: () => unknown): {code: string; details: Record<string, unknown>} | null {
    try {
        run();
        return null;
    } catch (error) {
        if (error instanceof HarnessError) return {code: error.code, details: {...error.details}};
        throw error;
    }
}

const answer = defineTool({id: "qa.answer", name: "submit_answer", description: "交答案", parameters: {type: "object"}, finish: true, execute: echo.execute});

describe("生效工具集（输出 1、2）", () => {
    test("必需与已登记的可选进集合，未登记的可选略过，自带工具的提供方是 profile:<key>", () => {
        const {registry} = storyRegistry();
        const tools = resolveEffectiveTools(profile([toolRef("story.search"), optional(toolRef("story.card")), optional(toolRef("story.timeline")), answer]), registry);

        expect(tools.map((tool) => tool.declaration.id)).toEqual(["story.search", "story.card", "qa.answer"]);
        expect(tools[2]?.declaration).toMatchObject({provider: "profile:story-qa", version: "1", finish: true});
    });

    test("必需工具没登记或被禁用报 tool_unavailable，写明原因与提供方", () => {
        const {registry} = storyRegistry();

        expect(codeOf(() => resolveEffectiveTools(profile([toolRef("story.timeline")]), registry))).toEqual({
            code: "tool_unavailable",
            details: {profile: "story-qa", tool: "story.timeline", reason: "unregistered", provider: null},
        });
        expect(codeOf(() => resolveEffectiveTools(profile([toolRef("story.search")]), registry, {disabledByProfile: {"story-qa": ["story.search"]}}))).toEqual({
            code: "tool_unavailable",
            details: {profile: "story-qa", tool: "story.search", reason: "disabled", provider: "nb-story"},
        });
    });

    test("可选工具被全局禁用时略过，不报错", () => {
        const {registry} = storyRegistry();
        const tools = resolveEffectiveTools(profile([toolRef("story.search"), optional(toolRef("story.card"))]), registry, {disabled: ["story.card"]});

        expect(tools.map((tool) => tool.declaration.id)).toEqual(["story.search"]);
    });

    test("两个工具给模型看的名字相同报 tool_name_conflict", () => {
        const {registry} = storyRegistry();
        const clash = defineTool({id: "qa.search", name: "story_search", description: "撞名", parameters: {type: "object"}, execute: echo.execute});

        expect(codeOf(() => resolveEffectiveTools(profile([toolRef("story.search"), clash]), registry))?.code).toBe("tool_name_conflict");
    });
});

describe("恢复会话（输出 4）", () => {
    test("声明不变时按快照重建", () => {
        const {registry} = storyRegistry();
        const definition = profile([toolRef("story.search"), answer]);
        const snapshot = resolveEffectiveTools(definition, registry).map((tool) => declarationJson(tool.declaration));

        expect(restoreEffectiveTools(snapshot, definition, registry).map((tool) => tool.declaration.id)).toEqual(["story.search", "qa.answer"]);
    });

    test("工具的 schema 变了报 session_incompatible", () => {
        const before = storyRegistry();
        const definition = profile([toolRef("story.search")]);
        const snapshot = resolveEffectiveTools(definition, before.registry).map((tool) => declarationJson(tool.declaration));
        const after = storyRegistry({search: {required: ["query"]}});

        expect(codeOf(() => restoreEffectiveTools(snapshot, definition, after.registry))?.code).toBe("session_incompatible");
    });

    test("必需工具没了报 session_incompatible；可选工具没了保留声明、调用时得到 plugin-unavailable", async () => {
        const {registry, plugin} = storyRegistry();
        const definition = profile([toolRef("story.search"), optional(toolRef("story.card"))]);
        const snapshot = resolveEffectiveTools(definition, registry).map((tool) => declarationJson(tool.declaration));
        plugin.unregister();

        expect(codeOf(() => restoreEffectiveTools(snapshot, definition, registry))?.code).toBe("session_incompatible");

        const onlyOptional = profile([optional(toolRef("story.card"))]);
        const restored = restoreEffectiveTools([snapshot[1]!], onlyOptional, registry);
        const [card] = bridgeTools(restored, {sessionId: "s", initial: {}}, registry).agentTools;
        const result = await card!.execute("c1", {} as never);
        expect(result).toMatchObject({isError: true, details: {code: PLUGIN_UNAVAILABLE, interrupted: false}});
    });
});

describe("工具桥（输出 5、6）", () => {
    test("工具拿到本会话的 sessionId 与 initial，两个会话互不串", async () => {
        const registry = createToolRegistry();
        const seen: unknown[] = [];
        registerPlugin(registry, {
            name: "p",
            version: "1",
            tools: [{declaration: {id: "p.who", name: "who", description: "", parameters: {type: "object"}, finish: false}, impl: {execute: async (_args, context) => (seen.push([context.sessionId, context.initial]), text("ok"))}}],
        });
        const tools = resolveEffectiveTools(profile([toolRef("p.who")]), registry);

        await Promise.all([
            bridgeTools(tools, {sessionId: "a", initial: {book: "A"}}, registry).agentTools[0]!.execute("1", {} as never),
            bridgeTools(tools, {sessionId: "b", initial: {book: "B"}}, registry).agentTools[0]!.execute("2", {} as never),
        ]);
        expect(seen).toEqual([
            ["a", {book: "A"}],
            ["b", {book: "B"}],
        ]);
    });

    test("执行中撤回：这次调用以中断结算，实现收到中止，迟到的结果丢弃；之后的调用得到 plugin-unavailable", async () => {
        const registry = createToolRegistry();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let started!: () => void;
        const running = new Promise<void>((resolve) => (started = resolve));
        let implSignal: AbortSignal | null = null;
        const plugin = registerPlugin(registry, {
            name: "p",
            version: "1",
            tools: [
                {
                    declaration: {id: "p.slow", name: "slow", description: "", parameters: {type: "object"}, finish: false},
                    impl: {
                        execute: async (_args, context) => {
                            implSignal = context.signal;
                            started();
                            await gate;
                            return text("迟到的结果");
                        },
                    },
                },
            ],
        });
        const bridged = bridgeTools(resolveEffectiveTools(profile([toolRef("p.slow")]), registry), {sessionId: "s", initial: {}}, registry);
        const call = bridged.agentTools[0]!.execute("c1", {} as never);
        await running;

        plugin.unregister();
        const result = await call;
        release();

        expect(result).toMatchObject({isError: true, details: {code: PLUGIN_UNAVAILABLE, interrupted: true}});
        expect(implSignal!.aborted).toBe(true);
        expect(await bridged.agentTools[0]!.execute("c2", {} as never)).toMatchObject({details: {code: PLUGIN_UNAVAILABLE, interrupted: false}});
        bridged.dispose();
    });
});
