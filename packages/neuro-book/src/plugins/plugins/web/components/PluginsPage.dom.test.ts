/**
 * 设置窗口的插件页（同名 .md）。远程合同的客户端是按合同类型写的内存替身：页面的行为只取决于合同的输入输出，
 * 服务端的实现与经内核的往返由 `../../plugins.test.ts` 与 `src/backend/plugins/plugins.test.ts` 覆盖（真实实现用
 * Bun 的 API，进不了 Vitest）。替身的写方法可以先挂起、再由用例结算，用来看进行中的界面。
 */

import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import type {InstallPreview, PluginListItem, PluginsRegistry} from "../../shared/contracts";
import PluginsPage from "./PluginsPage.vue";

const mounted: VueWrapper[] = [];

afterEach(() => {
    // 先卸载：打开着的对话框在全应用一份的模态列表里，只清 DOM 会留到下一条用例。
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Registry = PluginsRegistry;
type Outcome = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

const BUILTIN: PluginListItem = {id: "nbook.settings", version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null};
const HELLO: PluginListItem = {id: "example.hello", version: "1.0.0", source: "third-party", state: "enabled", pending: [], notLoaded: null};

interface Fake {
    readonly client: Registry;
    readonly calls: string[];
    /** 让下一次 `list` 返回这个结果（之后恢复正常）。 */
    failNextList(outcome: Outcome): void;
    /** 让下一次写操作挂起，返回结算它的函数。 */
    holdNext(): () => void;
    /** 下一次 `inspect` 或 `install` 返回这个结果。 */
    answerNext(outcome: Outcome): void;
    /** 让下一次 `list` 挂起，永不结算。 */
    hangNextList(): void;
}

function registry(initial: PluginListItem[], options: {readonly safeMode?: boolean; readonly preview?: InstallPreview} = {}): Fake {
    let plugins = [...initial];
    const calls: string[] = [];
    let nextList: Outcome | null = null;
    let hangList = false;
    let nextAnswer: Outcome | null = null;
    let hold: Promise<void> | null = null;
    const set = (item: PluginListItem): PluginListItem => {
        plugins = plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? item : plugin)) : [...plugins, item];
        return item;
    };
    const find = (id: string): PluginListItem => plugins.find((plugin) => plugin.id === id)!;
    const write = async <T>(name: string, run: () => T): Promise<T | Outcome> => {
        calls.push(name);
        if (hold !== null) {
            const waiting = hold;
            hold = null;
            await waiting;
        }
        if (nextAnswer !== null) {
            const answer = nextAnswer;
            nextAnswer = null;
            return answer;
        }
        return run();
    };
    const client = {
        list: async () => {
            calls.push("list");
            if (hangList) {
                hangList = false;
                return new Promise<never>(() => undefined);
            }
            if (nextList !== null) {
                const outcome = nextList;
                nextList = null;
                return outcome;
            }
            return {ok: true as const, value: {safeMode: options.safeMode ?? false, plugins}};
        },
        inspect: ({path}: {path: string}) => write(`inspect ${path}`, () => ({ok: true as const, value: options.preview ?? {id: "example.new", version: "1.0.0", installed: null, relation: "install" as const}})),
        install: ({path}: {path: string}) => write(`install ${path}`, () => ({ok: true as const, value: {plugin: set({id: "example.new", version: "1.0.0", source: "third-party", state: "enabled", pending: [{kind: "install"}], notLoaded: null})}})),
        enable: ({id}: {id: string}) => write(`enable ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}})),
        disable: ({id}: {id: string}) => write(`disable ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}})),
        uninstall: ({id}: {id: string}) => write(`uninstall ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}})),
    };
    return {
        client: client as unknown as Registry,
        calls,
        failNextList: (outcome) => {
            nextList = outcome;
        },
        holdNext: () => {
            const {promise, resolve} = Promise.withResolvers<void>();
            hold = promise;
            return () => resolve();
        },
        answerNext: (outcome) => {
            nextAnswer = outcome;
        },
        hangNextList: () => {
            hangList = true;
        },
    };
}

async function open(client: Registry, locale: "zh-CN" | "en-US" = "zh-CN") {
    const wrapper = mount(PluginsPage, {props: {registry: client, locale}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

/** 路径输入框：`data-plugin-path` 落在 `Input` 的根上，根可能就是 input。 */
function pathInput(wrapper: Awaited<ReturnType<typeof open>>) {
    const root = wrapper.find("[data-plugin-path]");
    return root.element.tagName === "INPUT" ? root : root.find("input");
}

function row(id: string): HTMLElement {
    return document.querySelector(`[data-plugin-row="${id}"]`) as HTMLElement;
}

function click(selector: string): void {
    (document.querySelector(selector) as HTMLElement).click();
}

function dialogButton(label: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((button) => button.textContent?.trim() === label)!;
}

function disabled(element: Element | null): boolean {
    return element?.hasAttribute("disabled") === true;
}

async function submitPath(wrapper: Awaited<ReturnType<typeof open>>, value: string): Promise<void> {
    await pathInput(wrapper).setValue(value);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
}

describe("PluginsPage", () => {
    it("第三方插件在前、内置插件标“内置”且没有操作；待生效变化与没有登记的原因显示在行上", async () => {
        const fake = registry([BUILTIN, {...HELLO, pending: [{kind: "upgrade", version: "2.0.0"}]}, {...HELLO, id: "example.old", notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}}]);
        await open(fake.client);
        const groups = [...document.querySelectorAll("[data-plugin-group]")].map((group) => group.getAttribute("data-plugin-group"));
        expect(groups).toEqual(["third-party", "builtin"]);
        expect(row("nbook.settings").textContent).toContain("内置");
        expect(row("nbook.settings").querySelector("[data-plugin-toggle]")).toBeNull();
        expect(row("nbook.settings").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-pending=upgrade]")?.textContent).toContain("重启后升级到 2.0.0");
        expect(row("example.old").querySelector("[data-plugin-not-loaded=incompatible-engine]")?.textContent).toContain("不兼容");
        expect(row("example.old").textContent).toContain("要求 NeuroBook >=2.0.0");
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")?.getAttribute("aria-label")).toBe("卸载 example.hello");
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("重启 NeuroBook 后生效");
    });

    it("安装先预览：确认框写明首次安装与完全信任；取消不安装；确认后清空输入框、列表出现“重启后安装”", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("下一次启动后生效");
        await submitPath(wrapper, "/plugins/new");
        expect(fake.calls).toContain("inspect /plugins/new");
        const dialog = document.querySelector("[role=dialog]");
        expect(dialog?.textContent).toContain("安装插件");
        expect(dialog?.textContent).toContain("example.new 1.0.0");
        expect(dialog?.textContent).toContain("可以访问全部作品、服务器与本机资源");
        dialogButton("取消").click();
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(fake.calls.some((call) => call.startsWith("install"))).toBe(false);

        await wrapper.find("form").trigger("submit");
        await flushPromises();
        click("[data-plugin-install-confirm]");
        await flushPromises();
        expect(fake.calls).toContain("install /plugins/new");
        expect(row("example.new").querySelector("[data-plugin-pending=install]")?.textContent).toContain("重启后安装");
        expect((pathInput(wrapper).element as HTMLInputElement).value).toBe("");
    });

    it("路径为空时只把焦点放进输入框，不预览", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "  ");
        expect(fake.calls.some((call) => call.startsWith("inspect"))).toBe(false);
        expect(document.activeElement).toBe(pathInput(wrapper).element);
    });

    it("安装进行中：确认按钮显示进行中，Esc 与“取消”关不掉对话框；结算后关闭", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "/plugins/new");
        const settle = fake.holdNext();
        click("[data-plugin-install-confirm]");
        await flushPromises();
        expect(document.querySelector("[data-plugin-install-confirm]")?.getAttribute("aria-busy")).toBe("true");
        expect(disabled(dialogButton("取消"))).toBe(true);
        document.querySelector("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).not.toBeNull();
        settle();
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(row("example.new")).not.toBeNull();
    });

    it("降级的确认框写出版本变化与数据提示", async () => {
        const fake = registry([BUILTIN, HELLO], {preview: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade"}});
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "/plugins/old");
        const dialog = document.querySelector("[role=dialog]");
        expect(dialog?.textContent).toContain("降级插件");
        expect(dialog?.textContent).toContain("example.hello 1.0.0 → 0.9.0");
        expect(dialog?.textContent).toContain("新版本已迁移过的数据");
    });

    it("失败按码显示：清单无效带出错字段；只说原因的码不重复详情；不认识的码给通用文字与路由层的说明", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        fake.answerNext({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误：name：必须是单个小写 id 段", problems: ["name：必须是单个小写 id 段"]}});
        await submitPath(wrapper, "/plugins/broken");
        let problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.getAttribute("data-plugin-problem")).toBe("manifest-invalid");
        expect(problem?.textContent).toContain("插件的清单无效");
        // 出错字段本身就是原因，服务端那句不再重复。
        expect([...problem!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["插件的清单无效", "name：必须是单个小写 id 段"]);
        const first = problem!.querySelector("p");

        fake.answerNext({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误：name：必须是单个小写 id 段", problems: ["name：必须是单个小写 id 段"]}});
        await submitPath(wrapper, "/plugins/broken");
        // 同一个失败再来一次：文字换成新节点，读屏会再播报一次。
        expect(document.querySelector("[data-plugin-problem] p")).not.toBe(first);
        expect(document.querySelector("[role=dialog]")).toBeNull();

        fake.answerNext({ok: false, code: "reserved-id", detail: {detail: "第三方插件的 id 不能以 nbook. 开头"}});
        await submitPath(wrapper, "/plugins/reserved");
        problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.textContent?.match(/nbook\. 开头/gu)).toHaveLength(1);

        fake.answerNext({ok: false, code: "denied", detail: "调用方没有权限"});
        await submitPath(wrapper, "/plugins/denied");
        problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.textContent).toContain("操作没有完成");
        expect(problem?.textContent).toContain("调用方没有权限");
    });

    it("结果未知：写出原因并重新读列表", async () => {
        const fake = registry([BUILTIN, HELLO]);
        const wrapper = await open(fake.client);
        const before = fake.calls.filter((call) => call === "list").length;
        fake.answerNext({ok: false, code: "unknown-outcome"});
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        await flushPromises();
        expect(document.querySelector("[data-plugin-problem]")?.textContent).toContain("已重新读取列表");
        expect(fake.calls.filter((call) => call === "list").length).toBe(before + 1);
    });

    it("进行中：正在操作的开关保持可用，别的写控件停用、不发起第二个写操作；结算后恢复", async () => {
        const fake = registry([BUILTIN, HELLO, {...HELLO, id: "example.other"}]);
        const wrapper = await open(fake.client);
        const settle = fake.holdNext();
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        await flushPromises();
        expect(disabled(row("example.hello").querySelector("[data-plugin-toggle]"))).toBe(false);
        expect(disabled(row("example.other").querySelector("[data-plugin-toggle]"))).toBe(true);
        expect(disabled(row("example.other").querySelector("[data-plugin-uninstall]"))).toBe(true);
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        expect(fake.calls.filter((call) => call.startsWith("disable") || call.startsWith("enable"))).toEqual(["disable example.hello"]);
        settle();
        await flushPromises();
        expect(row("example.hello").querySelector("[data-plugin-pending=disable]")).not.toBeNull();
        expect(disabled(row("example.other").querySelector("[data-plugin-toggle]"))).toBe(false);
    });

    it("卸载：确认框说明不能撤回，确认按钮是危险操作；之后只剩“重启后卸载”，焦点到第三方插件的小标题", async () => {
        const fake = registry([BUILTIN, HELLO]);
        await open(fake.client);
        click("[data-plugin-row=\"example.hello\"] [data-plugin-uninstall]");
        await flushPromises();
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("重启之前不能撤回");
        expect(document.querySelector("[data-plugin-uninstall-confirm]")?.className).toContain("status-danger");
        click("[data-plugin-uninstall-confirm]");
        await flushPromises();
        expect(row("example.hello").querySelector("[data-plugin-pending=uninstall]")).not.toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-toggle]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("卸载失败、重读的列表里这一行已在卸载中：焦点同样到第三方插件的小标题，不落到 body", async () => {
        const fake = registry([BUILTIN, HELLO]);
        await open(fake.client);
        const button = row("example.hello").querySelector<HTMLElement>("[data-plugin-uninstall]")!;
        button.focus();
        button.click();
        await flushPromises();
        fake.answerNext({ok: false, code: "uninstall-pending"});
        fake.failNextList({ok: true, value: {safeMode: false, plugins: [BUILTIN, {...HELLO, state: "uninstalling", pending: [{kind: "uninstall"}]}]}});
        click("[data-plugin-uninstall-confirm]");
        await flushPromises();
        expect(document.querySelector("[data-plugin-problem]")?.getAttribute("data-plugin-problem")).toBe("uninstall-pending");
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("读取列表失败：原位显示原因与重试，不画两组；重试成功后显示列表", async () => {
        const fake = registry([BUILTIN]);
        fake.failNextList({ok: false, code: "registry-failed", detail: {detail: "插件登记表不是合法 JSON"}});
        const wrapper = await open(fake.client);
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("failed");
        expect(document.querySelector("[data-plugin-group]")).toBeNull();
        expect(document.querySelector("[data-plugins-load-failure]")?.textContent).toContain("插件登记表不是合法 JSON");
        // 再失败一次：焦点到新的“重试”；成功后到第三方插件的小标题。
        fake.failNextList({ok: false, code: "registry-failed", detail: {detail: "插件登记表不是合法 JSON"}});
        click("[data-plugins-retry]");
        await flushPromises();
        expect(document.activeElement?.hasAttribute("data-plugins-retry")).toBe(true);
        click("[data-plugins-retry]");
        await flushPromises();
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("ready");
        expect(row("nbook.settings")).not.toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("读取中：根标 loading，加载区域 aria-busy，带名称的进行中指示", async () => {
        const fake = registry([BUILTIN]);
        fake.hangNextList();
        const wrapper = await open(fake.client);
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("loading");
        expect(document.querySelector("[aria-busy=true] [role=status]")?.getAttribute("aria-label")).toBe("正在读取插件…");
    });

    it("安全模式下显示安全模式横幅，第三方插件标中性的“安全模式未加载”", async () => {
        const fake = registry([BUILTIN, {...HELLO, notLoaded: {code: "safe-mode", detail: "安全模式下不加载第三方插件"}}], {safeMode: true});
        await open(fake.client);
        expect(document.querySelector("[data-plugins-safe-mode]")?.textContent).toContain("安全模式");
        expect(row("example.hello").querySelector("[data-plugin-not-loaded=safe-mode]")?.classList.contains("nb-badge--neutral")).toBe(true);
        expect(row("example.hello").textContent).not.toContain("安全模式下不加载第三方插件");
    });
});
