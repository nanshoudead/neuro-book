/**
 * 工作台的两个内置页面（docs/specs/ui/workbench-shell.md 输出 36–37、41）：`/` 在没有项目且有首页贡献时渲染贡献的组件，
 * 其余情形渲染外壳；加载失败退回外壳并记诊断；提供者换了之后迟到的结果不用；`/workbench` 从不用首页贡献。页面浮层在首页
 * 与工作台页都挂着。文档根的设置与主体都挂上之后页面根才带 `data-page-rendered`（src/web/PageOutlet.md）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";
import type {Component} from "vue";

import {createWorkbenchPages} from "./home-page";
import type {HomeProvider} from "./home-slot";

const Shell = defineComponent({name: "ShellMarker", render: () => h("div", {"data-test-shell": ""})});
const Home = defineComponent({name: "HomeMarker", render: () => h("div", {"data-test-home": ""})});
const OtherHome = defineComponent({name: "OtherHomeMarker", render: () => h("div", {"data-test-other-home": ""})});

const Document = defineComponent({name: "DocumentMarker", render: () => h("span", {"data-test-document": ""})});

/** 由测试决定何时完成的加载：看加载完成之前与之后的页面。 */
function deferred(): {readonly load: () => Promise<Component>; resolve(component: Component): void; reject(error: Error): void} {
    const settle: {resolve: (component: Component) => void; reject: (error: Error) => void} = {resolve: () => undefined, reject: () => undefined};
    const promise = new Promise<Component>((resolve, reject) => Object.assign(settle, {resolve, reject}));
    return {load: () => promise, resolve: (component) => settle.resolve(component), reject: (error) => settle.reject(error)};
}

function world(projectName: string | null = null, loaders: {document?: () => Promise<Component>; shell?: () => Promise<Component>} = {}) {
    const current = shallowRef<HomeProvider | null>(null);
    const reports: string[] = [];
    const partReports: string[] = [];
    const pages = createWorkbenchPages({
        document: {load: loaders.document ?? (async () => Document), props: () => ({})},
        shell: {load: loaders.shell ?? (async () => Shell), props: () => ({})},
        renderCommandHost: () => h("span", {"data-test-commands": ""}),
        renderNotifications: () => h("span", {"data-test-notifications": ""}),
        renderOverlays: () => h("span", {"data-test-overlays": ""}),
        projectName,
        home: {current},
        reportHome: (message) => reports.push(message),
        reportPart: (message) => partReports.push(message),
    });
    return {current, reports, partReports, pages};
}

const immediate = (id: string, component: Component): HomeProvider => ({id, load: async () => component});

describe("工作台页面与首页贡献", () => {
    it("没有首页贡献时渲染外壳；文档根、命令宿主与通知视口都在", async () => {
        const {pages} = world();
        const wrapper = mount(pages.home);
        await flushPromises();
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.find("[data-test-document]").exists()).toBe(true);
        expect(wrapper.find("[data-test-commands]").exists()).toBe(true);
        expect(wrapper.find("[data-test-notifications]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBeUndefined();
    });

    it("页面浮层在首页（书架）、空工作台与 /workbench 都挂着", async () => {
        const {current, pages} = world();
        const empty = mount(pages.home);
        expect(empty.find("[data-test-overlays]").exists()).toBe(true);
        current.value = immediate("test.shelf.home", Home);
        await flushPromises();
        expect(empty.find("[data-test-home]").exists()).toBe(true);
        expect(empty.find("[data-test-overlays]").exists()).toBe(true);
        expect(mount(pages.workbench).find("[data-test-overlays]").exists()).toBe(true);
    });

    it("有首页贡献时加载期间不画外壳，加载完渲染贡献的组件；撤回后回到外壳", async () => {
        const {current, pages} = world();
        current.value = immediate("test.shelf.home", Home);
        const wrapper = mount(pages.home);
        expect(wrapper.find("[data-test-shell]").exists()).toBe(false);
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBe("test.shelf.home");
        current.value = null;
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(false);
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
    });

    it("加载失败时退回外壳并记诊断", async () => {
        const {current, reports, pages} = world();
        current.value = {id: "test.broken.home", load: async () => {
            throw new Error("组件没找到");
        }};
        const wrapper = mount(pages.home);
        await flushPromises();
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.attributes("data-workbench-home")).toBeUndefined();
        expect(reports).toEqual(["首页 test.broken.home 加载失败，退回空工作台：组件没找到"]);
    });

    it("提供者换了之后，旧提供者迟到的结果不用", async () => {
        const {current, pages} = world();
        const first: {resolve: ((component: Component) => void) | null} = {resolve: null};
        current.value = {id: "test.first.home", load: () => new Promise<Component>((resolve) => {
            first.resolve = resolve;
        })};
        const wrapper = mount(pages.home);
        await flushPromises();
        current.value = immediate("test.second.home", OtherHome);
        await flushPromises();
        expect(wrapper.find("[data-test-other-home]").exists()).toBe(true);
        first.resolve?.(Home);
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(false);
        expect(wrapper.find("[data-test-other-home]").exists()).toBe(true);
    });

    it("/workbench 不用首页贡献；绑定了项目的窗口也不用", async () => {
        const {current, pages} = world();
        current.value = immediate("test.shelf.home", Home);
        const workbench = mount(pages.workbench);
        await flushPromises();
        expect(workbench.find("[data-test-shell]").exists()).toBe(true);
        expect(workbench.find("[data-test-home]").exists()).toBe(false);

        const bound = world("novel");
        bound.current.value = immediate("test.shelf.home", Home);
        const page = mount(bound.pages.home);
        await flushPromises();
        expect(page.find("[data-test-shell]").exists()).toBe(true);
        expect(page.attributes("data-workbench-project")).toBe("novel");
    });
});

describe("页面画出的标记 data-page-rendered", () => {
    it("文档根的设置与外壳都挂上之后才带标记；只挂上一块时不带", async () => {
        const document = deferred();
        const shell = deferred();
        const {pages} = world("novel", {document: document.load, shell: shell.load});
        const wrapper = mount(pages.workbench);
        await flushPromises();
        expect(wrapper.attributes("data-page-rendered")).toBeUndefined();
        shell.resolve(Shell);
        await flushPromises();
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.attributes("data-page-rendered")).toBeUndefined();
        document.resolve(Document);
        await flushPromises();
        expect(wrapper.attributes("data-page-rendered")).toBe("");
    });

    it("首页贡献挂上后带标记；撤回后等外壳挂上再带，中间不带", async () => {
        const shell = deferred();
        const {current, pages} = world(null, {shell: shell.load});
        current.value = immediate("test.shelf.home", Home);
        const wrapper = mount(pages.home);
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(true);
        expect(wrapper.attributes("data-page-rendered")).toBe("");
        current.value = null;
        await flushPromises();
        expect(wrapper.find("[data-test-home]").exists()).toBe(false);
        expect(wrapper.attributes("data-page-rendered")).toBeUndefined();
        shell.resolve(Shell);
        await flushPromises();
        expect(wrapper.find("[data-test-shell]").exists()).toBe(true);
        expect(wrapper.attributes("data-page-rendered")).toBe("");
    });

    it("外壳加载失败时记诊断、不带标记；再挂载页面时重新加载", async () => {
        let attempts = 0;
        const {pages, partReports} = world("novel", {shell: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("模块取不到");
            return Shell;
        }});
        const first = mount(pages.workbench);
        await flushPromises();
        expect(first.find("[data-test-shell]").exists()).toBe(false);
        expect(first.attributes("data-page-rendered")).toBeUndefined();
        expect(partReports).toEqual(["工作台外壳加载失败：模块取不到"]);
        first.unmount();
        const second = mount(pages.workbench);
        await flushPromises();
        expect(second.find("[data-test-shell]").exists()).toBe(true);
        expect(second.attributes("data-page-rendered")).toBe("");
    });
});
