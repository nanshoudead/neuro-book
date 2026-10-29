/**
 * 页面标签的内容（docs/specs/workbench/editor.md 输出 33）：页面组件加载期间内容区是带 aria-busy 的“正在加载页面”，加载完换成
 * 页面组件；加载失败写出原因、不再带 aria-busy。页面经真实内核的贡献点交付：拥有者插件用产品的校验与 `EditorPageRegistry`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";
import type {Component} from "vue";

import type {Application} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {EDITOR_PAGES_POINT, validateEditorPageContribution} from "../shared/contracts";
import {editorText} from "../shared/text";
import {EditorPageRegistry} from "./pages";
import type {EditorPageImplementation} from "./pages";
import {editorCatalogs} from "./text";

import {createApplication} from "nbook/application";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

const PAGE_ID = "test.pages.sample";

/** 编辑组注入的窗口端口；断言里的界面文字经它从目录取。 */
const port = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

/** 由测试决定何时完成的页面加载。 */
function deferred(): {readonly load: () => Promise<Component>; resolve(component: Component): void; reject(error: Error): void} {
    const settle: {resolve: (component: Component) => void; reject: (error: Error) => void} = {resolve: () => undefined, reject: () => undefined};
    const promise = new Promise<Component>((resolve, reject) => Object.assign(settle, {resolve, reject}));
    return {load: () => promise, resolve: (component) => settle.resolve(component), reject: (error) => settle.reject(error)};
}

async function start(load: () => Promise<Component>): Promise<EditorPageRegistry> {
    const holder: {registry: EditorPageRegistry | null} = {registry: null};
    const owner: PluginDefinition = {
        id: "test.owner",
        contributionPoints: [{id: EDITOR_PAGES_POINT, implementation: "required", validate: validateEditorPageContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [EDITOR_PAGES_POINT],
            activate: (context) => {
                holder.registry = new EditorPageRegistry(context.declarations);
                return {receivers: {[EDITOR_PAGES_POINT]: holder.registry.receiver()}};
            },
        }],
    };
    const provider: PluginDefinition = {
        id: "test.pages",
        entries: [{
            id: "main",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: EDITOR_PAGES_POINT, id: PAGE_ID, declaration: {title: {"zh-CN": "样例", "en-US": "Sample"}, icon: "i-lucide-file"}}],
            activate: () => {
                const implementation: EditorPageImplementation = {load};
                return {contributions: {[EDITOR_PAGES_POINT]: {[PAGE_ID]: implementation}}};
            },
        }],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "editor-pages"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, provider], requiredPlugins: ["test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    if (holder.registry === null) throw new Error("拥有者没有激活");
    return holder.registry;
}

const Page = defineComponent({
    name: "TestPage",
    props: {context: {type: Object, required: true}},
    setup: () => () => h("div", {"data-test-page": ""}),
});

/** 像编辑组那样渲染页面标签的内容：组件收到 `context`；加载失败经应用的错误处理报上来。 */
function mountPage(registry: EditorPageRegistry) {
    const errors: unknown[] = [];
    const source = registry.source({recent: []});
    const component = source.component(PAGE_ID);
    if (component === null) throw new Error("页面没有交付");
    const wrapper = mount(defineComponent({setup: () => () => h(component, {context: source.context})}), {
        global: {config: {errorHandler: (error) => errors.push(error)}, provide: provideText(port)},
    });
    return {wrapper, errors};
}

describe("页面标签的内容", () => {
    it("加载期间是带 aria-busy 的“正在加载页面”，context 不落成 DOM 属性；加载完换成页面组件，aria-busy 撤掉", async () => {
        const page = deferred();
        const {wrapper} = mountPage(await start(page.load));
        await flushPromises();
        const loading = wrapper.get("[aria-busy=\"true\"]");
        expect(loading.attributes("role")).toBe("status");
        expect(loading.text()).toBe(port.t(editorText("page.loading")));
        expect(loading.attributes("context")).toBeUndefined();

        page.resolve(Page);
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.find("[data-test-page]").exists()).toBe(true);
    });

    it("加载失败：写出原因（role=alert），不再带 aria-busy；错误交给应用的错误处理", async () => {
        const page = deferred();
        const {wrapper, errors} = mountPage(await start(page.load));
        await flushPromises();
        page.reject(new Error("chunk 404"));
        await flushPromises();
        expect(wrapper.find("[aria-busy]").exists()).toBe(false);
        expect(wrapper.get("[role=\"alert\"]").text()).toBe(port.t(editorText("page.failed", {reason: "chunk 404"})));
        expect(errors).toEqual([new Error("chunk 404")]);
    });
});
