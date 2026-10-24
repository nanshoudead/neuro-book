/**
 * 浏览器入口代码的装载器（docs/specs/runtime/plugin-code-loading.md 输出 2、4 与“失败与恢复”的浏览器装载失败）。
 *
 * Bun 里没有 DOM：页面是按 `PluginDocument` 写的结构化假文档，脚本的“执行”按浏览器的先后发生在插入之后的下一轮事件循环：
 * 执行时经全局登记对象交出工厂（与构建产物的登记外壳一样读 `globalThis`），执行出错派发带文件名的全局 error 事件，执行完
 * 触发 load；文件取不到触发 error。真实浏览器里的同一条路径由 e2e `plugin-code.e2e.ts` 走。
 */

import {describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PluginCodeError} from "nbook/plugin-platform/shared/plugin-code-error";
import {PLUGIN_REGISTRY_GLOBAL} from "nbook/plugin-platform/shared/plugin-modules";

import {createPluginCodeHost} from "./plugin-code";
import type {PluginCodeHostOptions, PluginDocument, PluginLink, PluginScript} from "./plugin-code";

type Factory = (module: {exports: Record<string, unknown>}, exports: Record<string, unknown>, require: (id: string) => unknown) => void;

/** 文件在“服务端”上的样子：取到后执行时做什么。 */
type Served =
    | {readonly kind: "registers"; readonly factory: Factory}
    | {readonly kind: "throws"; readonly message: string}
    | {readonly kind: "silent"}
    | {readonly kind: "missing"}
    /** 请求一直挂着：不执行、不触发 load 与 error。 */
    | {readonly kind: "hangs"};

/** `connected`：元素还在文档里（插入后、`remove()` 前）。 */
interface FakeScript extends PluginScript {
    connected: boolean;
}

type ErrorListener = (event: {readonly filename: string; readonly message: string}) => void;

let pageSequence = 0;

/** 产物脚本看到的全局登记对象（装载器建立它）；与构建预设的登记外壳一样只读这个全局，不写它。 */
function globalRegistry(): {register(url: string, factory: unknown): void} {
    const registry = (globalThis as unknown as Record<string, {register(url: string, factory: unknown): void} | undefined>)[PLUGIN_REGISTRY_GLOBAL];
    if (registry === undefined) throw new Error("页面上还没有登记对象：装载器没有建立");
    return registry;
}

/** 一个页面：每个页面有自己的基址，各用例的文件 URL 互不相同（全局登记对象在整个测试进程里只有一个）。 */
function fakePage() {
    pageSequence += 1;
    const baseURI = `http://plugin.test/page-${String(pageSequence)}/`;
    const served = new Map<string, Served>();
    const scripts: FakeScript[] = [];
    const errorListeners = new Set<ErrorListener>();

    const execute = (script: FakeScript): void => {
        const file = served.get(script.src) ?? {kind: "missing"};
        switch (file.kind) {
            case "hangs":
                return;
            case "missing":
                script.onerror?.();
                return;
            case "registers":
                globalRegistry().register(script.src, file.factory);
                break;
            case "throws":
                for (const listener of [...errorListeners]) listener({filename: script.src, message: file.message});
                break;
            case "silent":
                break;
        }
        script.onload?.();
    };

    function createElement(tag: "script"): PluginScript;
    function createElement(tag: "link"): PluginLink;
    function createElement(tag: "script" | "link"): PluginScript | PluginLink {
        if (tag === "link") throw new Error("装载器不插样式表");
        const script: FakeScript = {
            src: "",
            async: false,
            onload: null,
            onerror: null,
            connected: false,
            remove() {
                script.connected = false;
            },
        };
        return script;
    }

    const document: PluginDocument = {
        baseURI,
        head: {
            append(node) {
                if (!("async" in node)) return;
                const script = node as FakeScript;
                script.connected = true;
                scripts.push(script);
                // 浏览器取回与执行都在插入之后的任务里；移除元素不撤回已经开始的取回，所以这里不看 `connected`。
                setTimeout(() => execute(script), 0);
            },
        },
        defaultView: {
            addEventListener: (_type, listener) => errorListeners.add(listener),
            removeEventListener: (_type, listener) => errorListeners.delete(listener),
        },
        createElement,
    };

    return {
        document,
        baseURI,
        served,
        /** 插入过的、指向这个文件的脚本元素，按插入先后。 */
        scriptsFor: (path: string) => scripts.filter((script) => script.src === new URL(path, baseURI).href),
        /** 页面上还挂着的全局 error 监听数。 */
        errorListenerCount: () => errorListeners.size,
        serve(path: string, file: Served) {
            served.set(new URL(path, baseURI).href, file);
        },
    };
}

const hostTable: Readonly<Record<string, unknown>> = Object.freeze({vue: Object.freeze({marker: "宿主的 vue"})});

function loader(page: ReturnType<typeof fakePage>, options: Partial<PluginCodeHostOptions> = {}) {
    return createPluginCodeHost({document: page.document, modules: async () => hostTable, ...options});
}

/** 模块顶层有一个计数器：每份模块实例从 0 开始；`activate` 返回加一后的值与取到的 vue。 */
const counterModule: Factory = (_module, exports, require) => {
    let count = 0;
    const vue = require("vue");
    exports.activate = () => {
        count += 1;
        return {count, vue};
    };
};

function run(activate: unknown): unknown {
    if (typeof activate !== "function") throw new Error("不是 activate");
    return Reflect.apply(activate, undefined, []);
}

async function failureOf(promise: Promise<unknown>): Promise<PluginCodeError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof PluginCodeError) return error;
        throw error;
    }
    throw new Error("期望装载失败");
}

const live = (): AbortSignal => new AbortController().signal;

describe("浏览器入口代码的装载", () => {
    it("每次激活执行一份新的模块实例：模块顶层状态从初始值开始，require 取到宿主模块表里的那一份；脚本只插一次（输出 2）", async () => {
        const page = fakePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        const host = loader(page);
        const input = {plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()};

        const first = await host.activateOf(input);
        expect(run(first)).toEqual({count: 1, vue: hostTable.vue});
        expect(run(first)).toEqual({count: 2, vue: hostTable.vue});
        const second = await host.activateOf(input);
        expect(second).not.toBe(first);
        expect(run(second)).toEqual({count: 1, vue: hostTable.vue});
        expect(page.scriptsFor("counter.js")).toHaveLength(1);
    });

    it("同一文件的并发激活只插入一个脚本，两次激活都成功、各得一份模块实例", async () => {
        const page = fakePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        const host = loader(page);
        const [a, b] = await Promise.all([
            host.activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()}),
            host.activateOf({plugin: "acme.counter", entry: "other", url: "counter.js", signal: live()}),
        ]);
        expect(page.scriptsFor("counter.js")).toHaveLength(1);
        expect(a).not.toBe(b);
        expect([run(a), run(b)]).toEqual([{count: 1, vue: hostTable.vue}, {count: 1, vue: hostTable.vue}]);
    });

    it("期限内没有登记：code-load-failed，脚本与全局 error 监听撤下；重试重新插入脚本，这次登记了就成功", async () => {
        const page = fakePage();
        page.serve("slow.js", {kind: "hangs"});
        const host = loader(page, {timeoutMs: 5});
        const input = {plugin: "acme.slow", entry: "browser", url: "slow.js", signal: live()};

        const failure = await failureOf(host.activateOf(input));
        expect(failure).toMatchObject({code: "code-load-failed", plugin: "acme.slow", entry: "browser", url: "slow.js"});
        expect(page.scriptsFor("slow.js").map((script) => script.connected)).toEqual([false]);
        expect(page.errorListenerCount()).toBe(0);

        page.serve("slow.js", {kind: "registers", factory: counterModule});
        expect(run(await host.activateOf(input))).toEqual({count: 1, vue: hostTable.vue});
        expect(page.scriptsFor("slow.js")).toHaveLength(2);
    });

    it("文件取不到：code-load-failed；之后能取到时重试成功（失败不缓存）", async () => {
        const page = fakePage();
        const host = loader(page);
        const input = {plugin: "acme.missing", entry: "browser", url: "missing.js", signal: live()};
        expect(await failureOf(host.activateOf(input))).toMatchObject({code: "code-load-failed"});
        page.serve("missing.js", {kind: "registers", factory: counterModule});
        expect(run(await host.activateOf(input))).toEqual({count: 1, vue: hostTable.vue});
    });

    it("全局 error 事件按文件名归属：本文件的执行出错报 code-threw，别的文件的出错不影响本文件", async () => {
        const page = fakePage();
        page.serve("broken.js", {kind: "throws", message: "SyntaxError: Unexpected token"});
        page.serve("fine.js", {kind: "registers", factory: counterModule});
        const host = loader(page);
        const [broken, fine] = await Promise.allSettled([
            host.activateOf({plugin: "acme.broken", entry: "browser", url: "broken.js", signal: live()}),
            host.activateOf({plugin: "acme.fine", entry: "browser", url: "fine.js", signal: live()}),
        ]);
        expect(broken.status === "rejected" && broken.reason).toMatchObject({code: "code-threw", plugin: "acme.broken", message: expect.stringContaining("Unexpected token")});
        expect(fine.status === "fulfilled" && run(fine.value)).toEqual({count: 1, vue: hostTable.vue});
    });

    it("脚本执行了但没有登记：code-shape；模块没有导出 activate：同样是 code-shape", async () => {
        const page = fakePage();
        page.serve("plain.js", {kind: "silent"});
        page.serve("no-activate.js", {kind: "registers", factory: (_module, exports) => {
            exports.other = 1;
        }});
        const host = loader(page);
        expect(await failureOf(host.activateOf({plugin: "acme.plain", entry: "browser", url: "plain.js", signal: live()}))).toMatchObject({code: "code-shape"});
        expect(await failureOf(host.activateOf({plugin: "acme.plain", entry: "browser", url: "no-activate.js", signal: live()}))).toMatchObject({code: "code-shape"});
    });

    it("require 宿主模块表之外的 id：module-not-shared，原因写出模块 id；模块顶层抛出：code-threw（输出 4）", async () => {
        const page = fakePage();
        page.serve("unshared.js", {kind: "registers", factory: (_module, _exports, require) => {
            require("@vue/shared");
        }});
        page.serve("top-throws.js", {kind: "registers", factory: () => {
            throw new Error("顶层出错");
        }});
        const host = loader(page);
        const unshared = await failureOf(host.activateOf({plugin: "acme.unshared", entry: "browser", url: "unshared.js", signal: live()}));
        expect(unshared).toMatchObject({code: "module-not-shared", message: expect.stringContaining("@vue/shared")});
        const threw = await failureOf(host.activateOf({plugin: "acme.unshared", entry: "browser", url: "top-throws.js", signal: live()}));
        expect(threw).toMatchObject({code: "code-threw", message: expect.stringContaining("顶层出错")});
    });

    it("停止信号先于期限：立刻以停止的原因失败，脚本与监听撤下，迟到的登记不理会；之后再激活重新插入脚本", async () => {
        const page = fakePage();
        page.serve("hang.js", {kind: "hangs"});
        const host = loader(page, {timeoutMs: 60_000});
        const controller = new AbortController();
        const pending = host.activateOf({plugin: "acme.hang", entry: "browser", url: "hang.js", signal: controller.signal});
        await waitUntil("脚本已插入", () => page.scriptsFor("hang.js").length === 1);
        const reason = new Error("入口停止");
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(page.scriptsFor("hang.js").map((script) => script.connected)).toEqual([false]);
        expect(page.errorListenerCount()).toBe(0);

        // 撤下后脚本才执行完、交出工厂：没有人在等，不理会；下一次激活自己取回。
        globalRegistry().register(new URL("hang.js", page.baseURI).href, counterModule);
        page.serve("hang.js", {kind: "registers", factory: counterModule});
        expect(run(await host.activateOf({plugin: "acme.hang", entry: "browser", url: "hang.js", signal: live()}))).toEqual({count: 1, vue: hostTable.vue});
        expect(page.scriptsFor("hang.js")).toHaveLength(2);
    });

    it("同一文件的两次激活中停止一个：只有它离开，脚本留着，另一个照常拿到工厂", async () => {
        const page = fakePage();
        page.serve("shared.js", {kind: "hangs"});
        const host = loader(page, {timeoutMs: 60_000});
        const stopping = new AbortController();
        const stopped = host.activateOf({plugin: "acme.shared", entry: "a", url: "shared.js", signal: stopping.signal});
        const kept = host.activateOf({plugin: "acme.shared", entry: "b", url: "shared.js", signal: live()});
        await waitUntil("脚本已插入", () => page.scriptsFor("shared.js").length === 1);
        stopping.abort(new Error("入口 a 停止"));
        await expect(stopped).rejects.toThrow("入口 a 停止");
        expect(page.scriptsFor("shared.js").map((script) => script.connected)).toEqual([true]);

        globalRegistry().register(new URL("shared.js", page.baseURI).href, counterModule);
        expect(run(await kept)).toEqual({count: 1, vue: hostTable.vue});
    });

    it("宿主模块表没取到：code-load-failed，带插件与入口，保留原始错误；不缓存失败，下次激活重新取并成功", async () => {
        const page = fakePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        let calls = 0;
        const original = new TypeError("Failed to fetch dynamically imported module");
        const host = loader(page, {modules: async () => {
            calls += 1;
            if (calls === 1) throw original;
            return hostTable;
        }});
        const input = {plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()};
        const failure = await failureOf(host.activateOf(input));
        expect(failure).toMatchObject({code: "code-load-failed", plugin: "acme.counter", entry: "browser", cause: original});
        expect(run(await host.activateOf(input))).toEqual({count: 1, vue: hostTable.vue});
        expect(calls).toBe(2);
    });

    it("激活开始时已经停止：不插脚本、不取宿主模块表，以停止的原因失败", async () => {
        const page = fakePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        let tables = 0;
        const host = loader(page, {modules: async () => {
            tables += 1;
            return hostTable;
        }});
        const controller = new AbortController();
        const reason = new Error("入口已停止");
        controller.abort(reason);
        await expect(host.activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: controller.signal})).rejects.toBe(reason);
        expect(page.scriptsFor("counter.js")).toHaveLength(0);
        expect(tables).toBe(0);
    });

    it("两个入口共用一个文件、一次取回失败：各自的失败写自己的插件与入口", async () => {
        const page = fakePage();
        page.serve("shared.js", {kind: "silent"});
        const host = loader(page);
        const [a, b] = await Promise.all([
            failureOf(host.activateOf({plugin: "acme.shared", entry: "first", url: "shared.js", signal: live()})),
            failureOf(host.activateOf({plugin: "acme.shared", entry: "second", url: "shared.js", signal: live()})),
        ]);
        expect(page.scriptsFor("shared.js")).toHaveLength(1);
        expect([a.entry, b.entry]).toEqual(["first", "second"]);
        expect([a.code, b.code]).toEqual(["code-shape", "code-shape"]);
        expect(b.message).toContain("入口 second");
    });

    it("同一页面里两个装载器同时装同一文件：各插一个脚本，都成功", async () => {
        const page = fakePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        const [a, b] = await Promise.all([
            loader(page).activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()}),
            loader(page).activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()}),
        ]);
        expect([run(a), run(b)]).toEqual([{count: 1, vue: hostTable.vue}, {count: 1, vue: hostTable.vue}]);
        expect(page.scriptsFor("counter.js")).toHaveLength(2);
    });
});
