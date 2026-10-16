/**
 * 失败路径、所有权与寿命（docs/specs/agent/harness.md 输出 3 到 6、8、10 到 16、18，状态与转换）：
 * 实现审查（w00002 t21 evidences/impl-review.txt）指出的缺口，每条都从公开入口观察。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {defineProfile, HistorySet, ProfilePrompt, System, toolRef} from "@notnotype/nb-profile";
import {createJsonlSessionLog, type SessionEntryInput, type SessionLog} from "@notnotype/nb-session";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import {createHarness, createToolRegistry, defineModel, registerPlugin, type HarnessOptions, type ToolImpl} from "../src";
import {scriptedModel, toolCall, type ScriptedInput} from "../src/testing";
import {qaProfile, storyRegistry, testModel, text} from "./support";

let root = "";
let counter = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "robustness");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const newLog = async (): Promise<SessionLog> => createJsonlSessionLog({root, sessionId: `r${(counter += 1)}`});

/** 包一层会话日志：`hold` 为真的那一批写入先挂在屏障上，`fail` 为真的那一批写入失败。 */
function gatedLog(log: SessionLog, rules: {hold?: (inputs: readonly SessionEntryInput[]) => boolean; fail?: (inputs: readonly SessionEntryInput[]) => boolean}) {
    const gate = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const wrapped: SessionLog = {
        ...log,
        append: async (inputs) => {
            if (rules.fail?.(inputs)) throw new Error("磁盘满");
            if (rules.hold?.(inputs)) {
                held.resolve();
                await gate.promise;
            }
            return log.append(inputs);
        },
    };
    return {log: wrapped, held: held.promise, release: () => gate.resolve()};
}

const isToolResult = (inputs: readonly SessionEntryInput[]) => inputs.some((input) => input.kind === "agent_message" && (input.message as {role?: string}).role === "toolResult");
const isAssistant = (inputs: readonly SessionEntryInput[]) => inputs.some((input) => input.kind === "agent_message" && (input.message as {role?: string}).role === "assistant");

async function open(steps: readonly ScriptedInput[], overrides: Partial<HarnessOptions> = {}) {
    const script = scriptedModel(steps);
    const harness = await createHarness({
        profile: qaProfile(),
        initial: {at: 1},
        registry: storyRegistry().registry,
        model: testModel(),
        sessionLog: overrides.sessionLog ?? (await newLog()),
        streamFn: script.streamFn,
        ...overrides,
    });
    return {harness, script};
}

describe("收尾工具的结束时刻（输出 16）", () => {
    test("结果写进日志之前取消：aborted；之后取消：仍是 finished", async () => {
        for (const cancelBeforeWrite of [true, false]) {
            const gated = gatedLog(await newLog(), {hold: isToolResult});
            const {harness} = await open([[toolCall("a1", "submit_answer", {conclusion: "好"})]], {sessionLog: gated.log});
            const controller = new AbortController();
            try {
                const running = harness.turn("问", {signal: controller.signal});
                await gated.held;
                if (cancelBeforeWrite) controller.abort();
                gated.release();
                const result = await running;
                if (!cancelBeforeWrite) controller.abort();
                expect(result.stopReason).toBe(cancelBeforeWrite ? "aborted" : "finished");
            } finally {
                gated.release();
                await harness.close();
            }
        }
    });

    test("收尾结果写日志失败：error（local），不是 finished", async () => {
        const gated = gatedLog(await newLog(), {fail: isToolResult});
        const {harness} = await open([[toolCall("a1", "submit_answer", {conclusion: "好"})]], {sessionLog: gated.log});
        try {
            const result = await harness.turn("问");
            expect(result).toMatchObject({stopReason: "error", error: {kind: "local"}, finish: null});
        } finally {
            await harness.close();
        }
    });

    test("收尾工具的参数不合 schema：工具不执行、退回给模型，改对后再结束", async () => {
        let executed = 0;
        const profile = qaProfile({answer: async () => ((executed += 1), text("已记录"))});
        const {harness, script} = await open([[toolCall("a1", "submit_answer", {})], [toolCall("a2", "submit_answer", {conclusion: "好"})]], {profile});
        try {
            const result = await harness.turn("问");
            expect(result.stopReason).toBe("finished");
            expect(executed).toBe(1);
            expect(script.requests[1]!.messages.at(-1)).toMatchObject({role: "toolResult", toolCallId: "a1", isError: true});
        } finally {
            await harness.close();
        }
    });

    test("工具结果不能写进日志（details 有循环引用）：error（local），不再请求模型", async () => {
        const details: Record<string, unknown> = {};
        details.self = details;
        const profile = qaProfile({answer: async () => ({content: [{type: "text", text: "已记录"}], details})});
        const {harness, script} = await open([[toolCall("a1", "submit_answer", {conclusion: "好"})], "不应请求"], {profile});
        try {
            const result = await harness.turn("问");
            expect(result).toMatchObject({stopReason: "error", error: {kind: "local"}});
            expect(script.requests).toHaveLength(1);
        } finally {
            await harness.close();
        }
    });
});

describe("结算阶段（输出 10、12）", () => {
    test("模型已经答完、最后一批写入还挂着时取消：aborted，用量不完整，记运行结束", async () => {
        const gated = gatedLog(await newLog(), {hold: isAssistant});
        const {harness} = await open(["答完了"], {sessionLog: gated.log});
        const controller = new AbortController();
        try {
            const running = harness.turn("问", {signal: controller.signal});
            await gated.held;
            controller.abort();
            gated.release();
            const result = await running;
            expect(result).toMatchObject({stopReason: "aborted", usage: {complete: false}});
            expect(result.entries.at(-1)).toMatchObject({kind: "run_end", stopReason: "aborted"});
        } finally {
            gated.release();
            await harness.close();
        }
    });

    test("运行结束标记写失败：改报 local，原来的错误写在说明里", async () => {
        const gated = gatedLog(await newLog(), {fail: (inputs) => inputs.some((input) => input.kind === "run_end")});
        const {harness} = await open([{content: [], error: {message: "denied", status: 401}}], {sessionLog: gated.log});
        try {
            const result = await harness.turn("问");
            expect(result.error?.kind).toBe("local");
            expect(result.error?.message).toContain("auth");
        } finally {
            await harness.close();
        }
    });
});

describe("密钥在每次请求时都受控（输出 18）", () => {
    test("第二次请求前密钥变量被删：auth，不是 network", async () => {
        const {harness, script} = await open([[toolCall("c1", "story_search", {query: "x"})], "不应请求"], {
            registry: storyRegistry(async () => {
                delete process.env.NB_HARNESS_TEST_KEY;
                return text("ok");
            }).registry,
        });
        try {
            const result = await harness.turn("问");
            expect(result.error?.kind).toBe("auth");
            expect(script.requests).toHaveLength(1);
        } finally {
            await harness.close();
        }
    });
});

describe("快照约束会话（输出 3、4）", () => {
    test("创建后改宿主手里的 initial 对象：会话仍按快照里的值运行", async () => {
        const initial = {at: 5};
        const {harness, script} = await open(["好"], {initial});
        initial.at = 99;
        try {
            await harness.turn("问");
            expect(script.requests[0]?.systemPrompt).toEqual(["读到第 5 章。"]);
        } finally {
            await harness.close();
        }
    });

    test("登记后改插件手里的 schema 对象：模型收到的仍是登记时的", async () => {
        const parameters = {type: "object", properties: {query: {type: "string"}}};
        const registry = createToolRegistry();
        registerPlugin(registry, {name: "nb-story", version: "1", tools: [{declaration: {id: "story.search", name: "story_search", description: "搜", parameters}, impl: {execute: async () => text("ok")}}]});
        (parameters.properties.query as {type: string}).type = "number";
        const {harness, script} = await open(["好"], {registry});
        try {
            await harness.turn("问");
            expect(script.requests[0]?.tools?.[0]?.parameters).toMatchObject({properties: {query: {type: "string"}}});
        } finally {
            await harness.close();
        }
    });

    test("schema 只是属性先后不同：照常恢复", async () => {
        const log = await newLog();
        const first = await open(["好"], {sessionLog: log});
        await first.harness.turn("问");
        await first.harness.close();
        const registry = createToolRegistry();
        registerPlugin(registry, {
            name: "nb-story",
            version: "1",
            tools: [{declaration: {parameters: {properties: {query: {type: "string"}}, type: "object"}, description: "搜索", name: "story_search", id: "story.search"}, impl: {execute: async () => text("ok")}}],
        });
        const resumed = await createHarness({profile: qaProfile(), registry, model: testModel(), sessionLog: log});
        expect(resumed.tools).toEqual(["story.search", "qa.answer"]);
        await resumed.close();
    });
});

describe("登记表的代次与原子性", () => {
    const declaration = {id: "p.t", name: "t", description: "", parameters: {type: "object"}};
    const impl: ToolImpl = {execute: async () => text("ok")};

    test("旧插件的 unregister 不撤回同 id 后来的登记；unregister 幂等", () => {
        const registry = createToolRegistry();
        const v1 = registerPlugin(registry, {name: "p", version: "1", tools: [{declaration, impl}]});
        v1.unregister();
        registerPlugin(registry, {name: "p", version: "2", tools: [{declaration, impl}]});
        v1.unregister();
        expect(registry.get("p.t")?.declaration.version).toBe("2");
    });

    test("插件里有一个工具登记不上：整个插件都不登记", () => {
        const registry = createToolRegistry();
        registerPlugin(registry, {name: "q", version: "1", tools: [{declaration: {...declaration, id: "p.exists"}, impl}]});
        expect(() => registerPlugin(registry, {name: "p", version: "1", tools: [{declaration: {...declaration, id: "p.new"}, impl}, {declaration: {...declaration, id: "p.exists", name: "e"}, impl}]})).toThrow();
        expect(registry.has("p.new")).toBe(false);
    });
});

describe("工具的会话资源", () => {
    function trackedRegistry() {
        const released: string[] = [];
        const registry = createToolRegistry();
        const plugin = registerPlugin(registry, {
            name: "nb-story",
            version: "1",
            tools: [
                {declaration: {id: "story.search", name: "story_search", description: "", parameters: {type: "object"}}, impl: {execute: async () => text("ok"), releaseSession: (id) => released.push(`search:${id}`)}},
                {
                    declaration: {id: "story.card", name: "story_card", description: "", parameters: {type: "object"}},
                    impl: {
                        execute: async () => text("ok"),
                        releaseSession: () => {
                            throw new Error("释放失败");
                        },
                    },
                },
            ],
        });
        return {registry, plugin, released};
    }
    const profile = qaProfile({tools: [toolRef("story.search"), toolRef("story.card")]});

    test("用过的工具后来被撤回：关闭会话时照样释放它的会话资源", async () => {
        const {registry, plugin, released} = trackedRegistry();
        const {harness} = await open([[toolCall("c1", "story_search", {})], "好"], {registry, profile});
        await harness.turn("问");
        plugin.unregister();
        await harness.close();
        expect(released).toEqual([`search:${harness.sessionId}`]);
    });

    test("一个工具释放时抛错：其余照样释放，会话仍关上，close 报出错误", async () => {
        const {registry, released} = trackedRegistry();
        const {harness} = await open([[toolCall("c1", "story_card", {}), toolCall("c2", "story_search", {})], "好"], {registry, profile});
        await harness.turn("问");
        let error: unknown = null;
        await harness.close().catch((caught: unknown) => (error = caught));
        expect(error).toBeInstanceOf(AggregateError);
        expect(released).toEqual([`search:${harness.sessionId}`]);
        expect(await harness.turn("再问").catch((caught: {code?: string}) => caught.code)).toBe("session_closed");
    });

    test("实现同步抛错：调用照常以工具错误结束，之后撤回不再中止这次调用的 signal", async () => {
        let captured: AbortSignal | null = null;
        const registry = createToolRegistry();
        const plugin = registerPlugin(registry, {
            name: "nb-story",
            version: "1",
            tools: [
                {
                    declaration: {id: "story.search", name: "story_search", description: "", parameters: {type: "object"}},
                    impl: {
                        execute: (_args, context) => {
                            captured = context.signal;
                            throw new Error("同步失败");
                        },
                    },
                },
            ],
        });
        const {harness, script} = await open([[toolCall("c1", "story_search", {})], "好"], {registry});
        await harness.turn("问");
        plugin.unregister();
        await harness.close();
        expect(script.requests[1]!.messages.at(-1)).toMatchObject({role: "toolResult", isError: true});
        expect(captured!.aborted).toBe(false);
    });
});

describe("调度保真", () => {
    test("声明为 exclusive 的工具在同一批里不重叠执行", async () => {
        const order: string[] = [];
        const registry = createToolRegistry();
        registerPlugin(registry, {
            name: "files",
            version: "1",
            tools: [
                {
                    declaration: {id: "f.write", name: "write", description: "", parameters: {type: "object", properties: {n: {type: "string"}}}, concurrency: "exclusive"},
                    impl: {
                        execute: async (args) => {
                            order.push(`start ${String(args.n)}`);
                            await Promise.resolve();
                            await Promise.resolve();
                            order.push(`end ${String(args.n)}`);
                            return text("ok");
                        },
                    },
                },
            ],
        });
        const profile = defineProfile({manifest: {key: "w", version: "1", name: "w", description: "w"}, initialSchema: Type.Object({}), tools: [toolRef("f.write")], context: () => ProfilePrompt({children: [System({children: ["w"]}), HistorySet()]})});
        const {harness} = await open([[toolCall("w1", "write", {n: "1"}), toolCall("w2", "write", {n: "2"})], "好"], {registry, profile, initial: {}});
        await harness.turn("写");
        await harness.close();
        expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    });

    test("同一批并行工具的结果，下一次请求里一条不少（输出 8）", async () => {
        // OMP 的循环把事件推进流里就往下走，订阅者异步收到；最后一条工具结果的 message_end 可能晚于下一次请求前的
        // 钩子。多跑几次，让完成先后与投递时机都变一变。
        const registry = createToolRegistry();
        registerPlugin(registry, {
            name: "q",
            version: "1",
            tools: [
                {
                    declaration: {id: "q.look", name: "look", description: "", parameters: {type: "object", properties: {n: {type: "integer"}}}},
                    impl: {
                        execute: async (args) => {
                            for (let tick = 0; tick < Number(args.n); tick += 1) await Promise.resolve();
                            return text(`看了 ${String(args.n)}`);
                        },
                    },
                },
            ],
        });
        const profile = defineProfile({manifest: {key: "q", version: "1", name: "q", description: "q"}, initialSchema: Type.Object({}), tools: [toolRef("q.look")], context: () => ProfilePrompt({children: [System({children: ["q"]}), HistorySet()]})});
        for (let round = 0; round < 8; round += 1) {
            const calls = [3, 0, 2, 5].map((n, index) => toolCall(`l${index}`, "look", {n: (n + round) % 6}));
            const {harness, script} = await open([calls, "好"], {registry, profile, initial: {}});
            await harness.turn("看");
            await harness.close();
            const results = script.requests[1]!.messages.filter((message) => message.role === "toolResult").map((message) => (message as {toolCallId: string}).toolCallId);
            expect([...results].sort()).toEqual(["l0", "l1", "l2", "l3"]);
        }
    });

    test("thinking 与签名在关闭再恢复后原样交回模型", async () => {
        const thinking = {type: "thinking" as const, thinking: "先想一下", thinkingSignature: "sig-abc"};
        const first = await open([[thinking, {type: "text", text: "答"}]]);
        await first.harness.turn("问");
        await first.harness.close();
        const log = await createJsonlSessionLog({root, sessionId: first.harness.sessionId});
        const resumed = await open(["再答"], {sessionLog: log, initial: undefined});
        try {
            await resumed.harness.turn("再问");
            const assistant = resumed.script.requests[0]!.messages.find((message) => message.role === "assistant");
            expect(assistant?.content).toContainEqual(thinking);
        } finally {
            await resumed.harness.close();
        }
    });
});

describe("defineModel（输出 18）", () => {
    test("宿主显式给的单价与上限不被目录修正覆盖（即使 provider 与 id 和目录里的模型同名）", () => {
        process.env.NB_HARNESS_TEST_KEY = "k";
        const {model, priceKnown} = defineModel({
            provider: "deepseek",
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:9/v1",
            id: "deepseek-flash",
            apiKeyEnv: "NB_HARNESS_TEST_KEY",
            contextWindow: 10000,
            maxTokens: 100,
            price: {input: 7, output: 11, currency: "USD"},
        });
        expect(priceKnown).toBe(true);
        expect(model).toMatchObject({contextWindow: 10000, maxTokens: 100, cost: {input: 7, output: 11, cacheRead: 0, cacheWrite: 0}});
        expect(model.cost).not.toHaveProperty("timeBased");
    });
});
