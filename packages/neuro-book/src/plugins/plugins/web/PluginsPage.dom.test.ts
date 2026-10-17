/**
 * 设置窗口的插件页（同名 .md）。远程合同的客户端是按合同类型写的内存替身：页面的行为只取决于合同的输入输出，
 * 服务端的实现与经内核的往返由 `../plugins.test.ts` 与 `src/backend/plugins/plugins.test.ts` 覆盖（真实实现用
 * Bun 的 API，进不了 Vitest）。看列表的标记、安装要先确认完全信任、启停与卸载换成返回的新状态、失败按码显示。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {PluginListItem, pluginsRegistryContract} from "../shared/contracts";
import PluginsPage from "./PluginsPage.vue";

afterEach(() => {
    document.body.innerHTML = "";
});

type Registry = RemoteClient<typeof pluginsRegistryContract>;

const BUILTIN: PluginListItem = {id: "nbook.settings", version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null};
const HELLO: PluginListItem = {id: "example.hello", version: "1.0.0", source: "third-party", state: "enabled", pending: [], notLoaded: null};

/** 内存里的插件表；`installs` 记下安装请求的路径。 */
function registry(initial: PluginListItem[], options: {readonly safeMode?: boolean} = {}) {
    let plugins = [...initial];
    const installs: string[] = [];
    const set = (item: PluginListItem): PluginListItem => {
        plugins = plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? item : plugin)) : [...plugins, item];
        return item;
    };
    const find = (id: string): PluginListItem => plugins.find((plugin) => plugin.id === id)!;
    const client = {
        list: async () => ({ok: true as const, value: {safeMode: options.safeMode ?? false, plugins}}),
        install: async ({path}: {path: string}) => {
            installs.push(path);
            if (path.endsWith("broken")) return {ok: false as const, code: "manifest-invalid" as const, detail: {detail: "清单不符合 runtime.plugin-manifest", problems: ["name：必须是单个小写 id 段"]}};
            return {ok: true as const, value: {plugin: set({id: "example.new", version: "1.0.0", source: "third-party", state: "enabled", pending: [{kind: "install"}], notLoaded: null})}};
        },
        enable: async ({id}: {id: string}) => ({ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}}),
        disable: async ({id}: {id: string}) => ({ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}}),
        uninstall: async ({id}: {id: string}) => ({ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}}),
    };
    return {client: client as unknown as Registry, installs};
}

async function open(client: Registry) {
    const wrapper = mount(PluginsPage, {props: {registry: client, locale: "zh-CN"}, attachTo: document.body});
    await flushPromises();
    return wrapper;
}

/** 路径输入框：`data-plugin-path` 落在 `FormInput` 的根上，根可能就是 input。 */
function pathInput(wrapper: Awaited<ReturnType<typeof open>>) {
    const root = wrapper.find("[data-plugin-path]");
    return root.element.tagName === "INPUT" ? root : root.find("input");
}

function row(id: string): HTMLElement {
    return document.querySelector(`[data-plugin-row="${id}"]`) as HTMLElement;
}

async function confirmDialog(): Promise<void> {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")];
    buttons.find((button) => button.textContent?.trim() === "安装" || button.textContent?.trim() === "卸载")!.click();
    await flushPromises();
}

describe("PluginsPage", () => {
    it("内置插件标“内置”、没有操作；第三方插件有开关与卸载；待生效变化与没有登记的原因显示在行上", async () => {
        const {client} = registry([BUILTIN, {...HELLO, pending: [{kind: "upgrade", version: "2.0.0"}]}, {...HELLO, id: "example.old", notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}}]);
        await open(client);
        expect(row("nbook.settings").textContent).toContain("内置");
        expect(row("nbook.settings").querySelector("[data-plugin-toggle]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-pending=upgrade]")?.textContent).toContain("重启后升级到 2.0.0");
        expect(row("example.old").querySelector("[data-plugin-not-loaded=incompatible-engine]")?.textContent).toContain("不兼容");
        expect(row("example.old").textContent).toContain("要求 NeuroBook >=2.0.0");
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("重启 NeuroBook 后生效");
    });

    it("安装先确认完全信任；成功后清空输入框、列表出现“重启后安装”；失败按码显示原因与出错字段", async () => {
        const {client, installs} = registry([BUILTIN]);
        const wrapper = await open(client);
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("下一次启动后生效");
        await pathInput(wrapper).setValue("/plugins/new");
        await wrapper.find("[data-plugin-install]").trigger("click");
        await flushPromises();
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("可以访问全部作品、服务器与本机资源");
        expect(installs).toEqual([]);
        await confirmDialog();
        expect(installs).toEqual(["/plugins/new"]);
        expect(row("example.new").querySelector("[data-plugin-pending=install]")?.textContent).toContain("重启后安装");
        expect((pathInput(wrapper).element as HTMLInputElement).value).toBe("");

        await pathInput(wrapper).setValue("/plugins/broken");
        await wrapper.find("[data-plugin-install]").trigger("click");
        await flushPromises();
        await confirmDialog();
        const problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.getAttribute("data-plugin-problem")).toBe("manifest-invalid");
        expect(problem?.textContent).toContain("插件的清单无效");
        expect(problem?.textContent).toContain("name：必须是单个小写 id 段");
    });

    it("禁用换成“重启后禁用”；卸载确认后开关与卸载都停用", async () => {
        const {client} = registry([BUILTIN, HELLO]);
        const wrapper = await open(client);
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        await flushPromises();
        expect(row("example.hello").querySelector("[data-plugin-pending=disable]")).not.toBeNull();

        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-uninstall]").trigger("click");
        await flushPromises();
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("卸载 example.hello？");
        await confirmDialog();
        expect(row("example.hello").querySelector("[data-plugin-pending=uninstall]")).not.toBeNull();
        expect(row("example.hello").querySelector<HTMLButtonElement>("[data-plugin-uninstall]")?.disabled).toBe(true);
        expect(row("example.hello").querySelector("[data-plugin-toggle]")?.hasAttribute("disabled") || row("example.hello").querySelector("[data-plugin-toggle]")?.getAttribute("data-disabled") !== null).toBe(true);
    });

    it("安全模式下显示安全模式横幅", async () => {
        const {client} = registry([BUILTIN, {...HELLO, notLoaded: {code: "safe-mode", detail: "安全模式下不加载第三方插件"}}], {safeMode: true});
        await open(client);
        expect(document.querySelector("[data-plugins-safe-mode]")?.textContent).toContain("安全模式");
        expect(row("example.hello").querySelector("[data-plugin-not-loaded=safe-mode]")).not.toBeNull();
    });
});
