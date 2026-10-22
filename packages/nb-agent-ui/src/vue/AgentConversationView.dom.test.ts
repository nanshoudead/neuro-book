import {describe, expect, it} from "vitest";
import {flushPromises, mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";

import type {AgentViewContribution} from "../registry";

import type {MarkdownActivation} from "../ports";
import {createAgentViewRegistry} from "../registry";
import type {AgentConversationContext, AgentConversationServices, AgentLocale} from "../types";
import AgentConversationView from "./AgentConversationView.vue";
import {builtinComposerContribution} from "./builtin-composer";
import {builtinMessageActionsContribution} from "./builtin-message-actions";
import {builtinRolesContribution} from "./builtin-roles";
import {builtinToolsContribution} from "./builtin-tools";

function context(): AgentConversationContext {
    return {
        session: {id: "s1", title: "第三章", summary: "", profileName: "写作助手", profileIcon: "i-lucide-feather", archived: false, summaryState: "idle"},
        availability: {status: "ready", message: "", actions: []},
        interaction: {canSend: true, canAnswer: true, canMutateHistory: true, canStop: true, canRegisterAttachments: false, canChangeRuntime: true, canArchive: true, canRestore: true},
        run: {status: "idle", phase: ""},
        messages: [
            {kind: "user", id: "u1", timestamp: 1, intent: "normal", blocks: [{kind: "text", text: "画张图"}], contentOmitted: false},
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "![甲](a.png) ![乙](b.png)", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ],
        history: {hasMore: false, loading: false, error: null},
        branches: {},
        editing: null,
        pendingInputs: [],
        workflows: {},
        workspaceChanges: {groups: [], selectedPath: null, loading: false, error: null},
        composer: {models: [], modelKey: null, thinkingLevels: [], thinking: null, modes: [], mode: "normal", queued: [], attachmentCount: 0, attachments: [], recall: [], draft: {text: "", version: 1}},
        usage: {contextTokens: 0, contextLimit: null, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cacheHitRate: null, cost: null, currency: "USD"},
        connection: {status: "connected", actionRequired: false},
        panels: {},
        now: 3,
        extensions: {},
    };
}

const registry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution, builtinComposerContribution]);

/** 注入的 Markdown 显示的替身：每张图一个按钮，点了发出 image 的 activate。 */
const FakeMarkdown = defineComponent({
    props: {text: {type: String, required: true}},
    emits: ["activate"],
    setup(props, {emit}) {
        return () => h("div", [...props.text.matchAll(/\]\(([^)]+)\)/gu)].map((match) => {
            const activation: MarkdownActivation = {kind: "image", address: match[1]!};
            return h("button", {"data-image": match[1], onClick: () => emit("activate", activation)});
        }));
    },
});

/** 可以手动完成的图片换算：记下每次请求、它的取消信号与归还次数。 */
function controllableResolver() {
    const requests: Array<{src: string; signal: AbortSignal; released: number; finish: () => void}> = [];
    const resolveMarkdownAsset: NonNullable<AgentConversationServices["resolveMarkdownAsset"]> = (src, signal) => new Promise((resolve) => {
        const request = {src, signal, released: 0, finish: () => resolve({url: `blob:lab/${src}`, release: () => { request.released += 1; }})};
        requests.push(request);
    });
    return {requests, resolveMarkdownAsset};
}

function mountView(locale: AgentLocale, services: Partial<AgentConversationServices> = {}, options: {ctx?: AgentConversationContext; registry?: typeof registry; plain?: boolean} = {}) {
    return mount(AgentConversationView, {
        props: {
            ctx: options.ctx ?? context(),
            registry: options.registry ?? registry,
            locale,
            renderers: options.plain === true ? {} : {markdown: FakeMarkdown},
            services: {resolveAttachmentUrl: () => null, resolveTriggerMenu: () => ({items: []}), ...services},
        },
        attachTo: document.body,
    });
}

describe("AgentConversationView", () => {
    it("视图自己的文字也跟着 locale：英文界面下顶栏按钮是英文", () => {
        const view = mountView("en-US");
        expect(view.find("[aria-label='More actions']").exists()).toBe(true);
        expect(view.find("[aria-label='更多操作']").exists()).toBe(false);
        view.unmount();
    });

    it("回复里的图片：连点两张时先点的那次被取消、晚到的地址立即归还；关掉预览归还当前这张，卸载时不再多还", async () => {
        const {requests, resolveMarkdownAsset} = controllableResolver();
        const view = mountView("zh-CN", {resolveMarkdownAsset});
        await view.get("[data-image='a.png']").trigger("click");
        await flushPromises();
        await view.get("[data-image='b.png']").trigger("click");
        await flushPromises();
        expect(requests.map((request) => [request.src, request.signal.aborted])).toEqual([["a.png", true], ["b.png", false]]);

        expect(view.emitted("action") ?? []).toEqual([]);

        requests[0]!.finish();
        await flushPromises();
        expect(requests[0]!.released).toBe(1);
        expect(document.querySelector("[role='dialog'] img")).toBeNull();

        requests[1]!.finish();
        await flushPromises();
        expect(document.querySelector("[role='dialog'] img")?.getAttribute("src")).toBe("blob:lab/b.png");
        expect(requests[1]!.released).toBe(0);

        (document.querySelector("[role='dialog'] [aria-label='关闭']") as HTMLElement).click();
        await flushPromises();
        expect(requests[1]!.released).toBe(1);
        view.unmount();
        expect(requests.map((request) => request.released)).toEqual([1, 1]);
    });

    it("换算被取消后以失败告终也不打开预览；同步抛错不从点击里逸出", async () => {
        const view = mountView("zh-CN", {
            resolveMarkdownAsset: (src) => {
                if (src === "a.png") throw new Error("坏地址");
                return Promise.reject(new DOMException("aborted", "AbortError"));
            },
        });
        await view.get("[data-image='a.png']").trigger("click");
        await view.get("[data-image='b.png']").trigger("click");
        await flushPromises();
        expect(document.querySelector("[role='dialog']")).toBeNull();
        view.unmount();
    });
});

describe("宿主组件（验收 21）", () => {
    it("宿主登记的节点组件收到 ctx、服务与界面语言，它发出的 action 到达宿主", async () => {
        const seen: Array<{session: string | undefined; hasServices: boolean; locale: string}> = [];
        const Answer = defineComponent({
            props: {call: {type: Object, required: true}, ctx: {type: Object, required: true}, services: {type: Object, required: true}, locale: {type: String, required: true}},
            emits: ["action"],
            setup(props, {emit}) {
                return () => {
                    seen.push({session: (props.ctx as AgentConversationContext).session?.title, hasServices: typeof (props.services as AgentConversationServices).resolveAttachmentUrl === "function", locale: props.locale});
                    return h("button", {"data-source": "", onClick: () => emit("action", {type: "reference.open", target: "chapter://c3"})});
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:plugin",
            tools: [{id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text", label: "作答", presentation: "node", node: Answer, summary: () => ""}],
        };
        const ctx = context();
        ctx.run = {status: "running", phase: ""};
        ctx.messages = [ctx.messages[0]!, {kind: "assistant", id: "a1", timestamp: 2, status: "streaming", text: "", thinking: "", model: "m", toolCalls: [{id: "q1", name: "answer", status: "running", args: {}}], contentOmitted: false}];
        const view = mountView("en-US", {}, {ctx, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin]), plain: true});
        await view.get("[data-source]").trigger("click");
        expect(seen.at(-1)).toEqual({session: "第三章", hasServices: true, locale: "en-US"});
        expect(view.emitted("action")?.map((args) => args[0])).toEqual([{type: "reference.open", target: "chapter://c3"}]);
        view.unmount();
    });
});

describe("渲染器出错（验收 15）", () => {
    it("插件的节点组件与摘要回调抛错：只有这一项降级为“此内容无法显示”，其余消息照常显示", async () => {
        const Boom = defineComponent({
            setup() {
                return () => {
                    throw new Error("节点坏了");
                };
            },
        });
        const plugin: AgentViewContribution = {
            source: "test:plugin",
            tools: [{
                id: "boom", toolNames: ["boom"], category: "interact", icon: "i-lucide-bomb", label: "炸", presentation: "node", node: Boom,
                summary: () => {
                    throw new Error("摘要坏了");
                },
            }],
        };
        const ctx = context();
        ctx.messages = [
            ctx.messages[0]!,
            {kind: "assistant", id: "a1", timestamp: 2, status: "done", text: "前面的回复照常显示", thinking: "", model: "m", toolCalls: [{id: "b1", name: "boom", status: "success", args: {}}], contentOmitted: false},
            {kind: "assistant", id: "a2", timestamp: 3, status: "done", text: "后面的回复也照常显示", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
        ];
        const view = mountView("zh-CN", {}, {ctx, registry: createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, plugin]), plain: true});
        // 已结束的轮次默认收起，节点在过程里：先展开整轮。
        await view.get("[data-turn-summary]").trigger("click");
        expect(view.findAll("[data-render-failed]")).toHaveLength(1);
        expect(view.text()).toContain("此内容无法显示");
        expect(view.text()).toContain("后面的回复也照常显示");
        view.unmount();
    });
});
