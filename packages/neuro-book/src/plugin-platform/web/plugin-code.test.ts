/**
 * 浏览器入口代码的装载器（docs/specs/runtime/plugin-code-loading.md 输出 2、4 与“失败与恢复”的浏览器装载失败）。
 *
 * Bun 里没有 DOM：页面是共用的假页面（`../testing/fake-page.ts`，时序按浏览器）；真实浏览器里的同一条路径由 e2e
 * `plugin-code.e2e.ts` 走。
 */

import {describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PluginCodeError} from "nbook/plugin-platform/shared/plugin-code-error";
import {fakePage} from "../testing/fake-page";
import type {FakePage, ModuleFactory} from "../testing/fake-page";
import {ACME_PROFILE} from "../testing/profile";

import {createPluginCodeHost} from "./plugin-code";
import type {PluginCodeHostOptions} from "./plugin-code";

/** 用 acme 档案的登记对象全局名的假页面（见 `../testing/fake-page.ts`）。 */
const acmePage = (): FakePage => fakePage(ACME_PROFILE.registryGlobal);

const hostTable: Readonly<Record<string, unknown>> = Object.freeze({vue: Object.freeze({marker: "宿主的 vue"})});

function loader(page: FakePage, options: Partial<PluginCodeHostOptions> = {}) {
    return createPluginCodeHost({document: page.document, registryGlobal: ACME_PROFILE.registryGlobal, modules: async () => hostTable, ...options});
}

/** 模块顶层有一个计数器：每份模块实例从 0 开始；`activate` 返回加一后的值与取到的 vue。 */
const counterModule: ModuleFactory = (_module, exports, require) => {
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
        const page = acmePage();
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
        // 装载器只插脚本；样式表由窗口在登记插件时加（styles.ts）。
        expect(page.styles()).toEqual([]);
    });

    it("同一文件的并发激活只插入一个脚本，两次激活都成功、各得一份模块实例", async () => {
        const page = acmePage();
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
        const page = acmePage();
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
        const page = acmePage();
        const host = loader(page);
        const input = {plugin: "acme.missing", entry: "browser", url: "missing.js", signal: live()};
        expect(await failureOf(host.activateOf(input))).toMatchObject({code: "code-load-failed"});
        page.serve("missing.js", {kind: "registers", factory: counterModule});
        expect(run(await host.activateOf(input))).toEqual({count: 1, vue: hostTable.vue});
    });

    it("全局 error 事件按文件名归属：本文件的执行出错报 code-threw，别的文件的出错不影响本文件", async () => {
        const page = acmePage();
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
        const page = acmePage();
        page.serve("plain.js", {kind: "silent"});
        page.serve("no-activate.js", {kind: "registers", factory: (_module, exports) => {
            exports.other = 1;
        }});
        const host = loader(page);
        expect(await failureOf(host.activateOf({plugin: "acme.plain", entry: "browser", url: "plain.js", signal: live()}))).toMatchObject({code: "code-shape"});
        expect(await failureOf(host.activateOf({plugin: "acme.plain", entry: "browser", url: "no-activate.js", signal: live()}))).toMatchObject({code: "code-shape"});
    });

    it("require 宿主模块表之外的 id：module-not-shared，原因写出模块 id；模块顶层抛出：code-threw（输出 4）", async () => {
        const page = acmePage();
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
        const page = acmePage();
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
        page.register("hang.js", counterModule);
        page.serve("hang.js", {kind: "registers", factory: counterModule});
        expect(run(await host.activateOf({plugin: "acme.hang", entry: "browser", url: "hang.js", signal: live()}))).toEqual({count: 1, vue: hostTable.vue});
        expect(page.scriptsFor("hang.js")).toHaveLength(2);
    });

    it("同一文件的两次激活中停止一个：只有它离开，脚本留着，另一个照常拿到工厂", async () => {
        const page = acmePage();
        page.serve("shared.js", {kind: "hangs"});
        const host = loader(page, {timeoutMs: 60_000});
        const stopping = new AbortController();
        const stopped = host.activateOf({plugin: "acme.shared", entry: "a", url: "shared.js", signal: stopping.signal});
        const kept = host.activateOf({plugin: "acme.shared", entry: "b", url: "shared.js", signal: live()});
        await waitUntil("脚本已插入", () => page.scriptsFor("shared.js").length === 1);
        stopping.abort(new Error("入口 a 停止"));
        await expect(stopped).rejects.toThrow("入口 a 停止");
        expect(page.scriptsFor("shared.js").map((script) => script.connected)).toEqual([true]);

        page.register("shared.js", counterModule);
        expect(run(await kept)).toEqual({count: 1, vue: hostTable.vue});
    });

    it("宿主模块表没取到：code-load-failed，带插件与入口，保留原始错误；不缓存失败，下次激活重新取并成功", async () => {
        const page = acmePage();
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
        const page = acmePage();
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
        const page = acmePage();
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
        const page = acmePage();
        page.serve("counter.js", {kind: "registers", factory: counterModule});
        const [a, b] = await Promise.all([
            loader(page).activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()}),
            loader(page).activateOf({plugin: "acme.counter", entry: "browser", url: "counter.js", signal: live()}),
        ]);
        expect([run(a), run(b)]).toEqual([{count: 1, vue: hostTable.vue}, {count: 1, vue: hostTable.vue}]);
        expect(page.scriptsFor("counter.js")).toHaveLength(2);
    });
});
