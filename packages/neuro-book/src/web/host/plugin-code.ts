/**
 * 第三方插件浏览器入口代码的装载（docs/specs/runtime/plugin-code-loading.md 输出 1–4）。
 *
 * 构建预设把入口打成登记工厂：脚本执行时调用 `globalThis[PLUGIN_REGISTRY_GLOBAL].register(脚本 URL, factory)`，
 * `factory(module, exports, require)` 才是 CommonJS 模块体（`scripts/plugin-sdk/build-plugin.ts`）。这里：
 *
 * - 同一个文件只插入一次同源 `<script src>`，脚本有真实的文件名，source map 照常，不需要 `unsafe-eval`；只缓存登记成功的
 *   工厂，失败的下次重试重新插入脚本。
 * - 入口每次激活都调用一次工厂，得到一份新的模块实例：重试与依赖恢复后的再激活不带上一代的模块顶层状态，与服务端一致。
 * - `require` 只从宿主模块表取；表外的 id 抛 `module-not-shared`。
 *
 * 失败都抛 `PluginCodeError`，由内核按入口激活失败处理，只影响这个入口；原因带插件 id、入口 id 与文件 URL。
 */

import type {PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";

import {PluginCodeError} from "nbook/shared/plugin-code-error";
import type {PluginCodeFailure} from "nbook/shared/plugin-code-error";
import {PLUGIN_REGISTRY_GLOBAL} from "nbook/shared/plugin-modules";

/** 脚本执行后多久还没登记工厂算失败；回环上的服务端正常情况下远不到这么久。 */
export const CODE_LOAD_TIMEOUT_MS = 30_000;

/** 宿主模块表外的 id；只在工厂执行期间抛出，由装载器换成带插件与入口的 `PluginCodeError`。 */
class ModuleNotShared extends Error {
    readonly id: string;

    constructor(id: string) {
        super(`引用了宿主没有共享的模块 ${id}`);
        this.id = id;
    }
}

/**
 * 装载器用到的那一点文档接口。按结构写而不是用 DOM 的 `Document`：窗口宿主的代码也在 Bun 里做类型检查与测试，那里没有 DOM 库；
 * 真实的 `document` 满足它。
 */
export interface PluginDocument {
    readonly baseURI: string;
    readonly head: {append(node: PluginScript | PluginLink): void};
    readonly defaultView: {
        addEventListener(type: "error", listener: (event: {readonly filename: string; readonly message: string}) => void): void;
        removeEventListener(type: "error", listener: (event: {readonly filename: string; readonly message: string}) => void): void;
    } | null;
    createElement(tag: "script"): PluginScript;
    createElement(tag: "link"): PluginLink;
}

export interface PluginScript {
    src: string;
    async: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    remove(): void;
}

export interface PluginLink {
    rel: string;
    href: string;
    readonly dataset: Record<string, string | undefined>;
    addEventListener(type: "error", listener: () => void): void;
    remove(): void;
}

/**
 * 页面的文档；Bun 里（测试）没有，为 undefined。经 `unknown` 转换：DOM 库里事件回调带参数、`append` 收 `Node`，与这里按用法写的
 * 窄接口在类型上互不可比，运行时它们是同一个对象。
 */
export function pageDocument(): PluginDocument | undefined {
    return (globalThis as unknown as {readonly document?: PluginDocument}).document;
}

type Factory = (module: {exports: Record<string, unknown>}, exports: Record<string, unknown>, require: (id: string) => unknown) => void;

type Activate = PluginEntryDefinition["activate"];

interface Waiter {
    resolve(factory: Factory): void;
}

/** 等待登记的脚本：按脚本的绝对 URL。同一页面里几个窗口（测试）共用这一张。 */
const waiting = new Map<string, Waiter>();

function registry(): {register(url: string, factory: unknown): void} {
    const scope = globalThis as unknown as Record<string, {register(url: string, factory: unknown): void} | undefined>;
    const existing = scope[PLUGIN_REGISTRY_GLOBAL];
    if (existing !== undefined) return existing;
    const created = Object.freeze({
        register: (url: string, factory: unknown) => {
            const waiter = waiting.get(url);
            // 不认识的登记（不是装载器插入的脚本，或已经超时）不理会：装载器那边会按超时或“没有登记”报告。
            if (waiter !== undefined && typeof factory === "function") waiter.resolve(factory as Factory);
        },
    });
    Object.defineProperty(scope, PLUGIN_REGISTRY_GLOBAL, {value: created, configurable: false, enumerable: false, writable: false});
    return created;
}

export interface PluginCodeHost {
    /** 这个入口这一次激活用的 `activate`：取回（只取一次）并执行一次工厂。 */
    activateOf(input: {readonly plugin: string; readonly entry: string; readonly url: string; readonly signal: AbortSignal}): Promise<Activate>;
}

export interface PluginCodeHostOptions {
    readonly document: PluginDocument;
    /** 宿主模块表：模块 id → 冻结的模块对象。第一次装载时才取（只有第三方浏览器入口用到它）。 */
    readonly modules: () => Promise<Readonly<Record<string, unknown>>>;
    readonly timeoutMs?: number;
}

export function createPluginCodeHost(options: PluginCodeHostOptions): PluginCodeHost {
    const factories = new Map<string, Factory>();
    const pending = new Map<string, Promise<Factory>>();
    let table: Promise<Readonly<Record<string, unknown>>> | null = null;
    registry();

    const fetchFactory = (plugin: string, entry: string, url: string): Promise<Factory> => {
        const known = factories.get(url);
        if (known !== undefined) return Promise.resolve(known);
        const inflight = pending.get(url);
        if (inflight !== undefined) return inflight;
        const absolute = new URL(url, options.document.baseURI).href;
        const fail = (code: PluginCodeFailure, detail: string): PluginCodeError => new PluginCodeError(code, {plugin, entry, url, detail});
        const loading = new Promise<Factory>((resolve, reject) => {
            const script = options.document.createElement("script");
            let settled = false;
            const finish = (outcome: {readonly factory: Factory} | {readonly error: PluginCodeError}): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                waiting.delete(absolute);
                options.document.defaultView?.removeEventListener("error", onScriptError);
                script.remove();
                if ("factory" in outcome) resolve(outcome.factory);
                else reject(outcome.error);
            };
            // 脚本自身的语法错误不触发 onerror：浏览器派发全局 error 事件，事件的文件名就是脚本 URL，之后 onload 照常触发。
            const onScriptError = (event: {readonly filename: string; readonly message: string}): void => {
                if (event.filename === absolute) finish({error: fail("code-threw", `的脚本执行出错：${event.message}`)});
            };
            const timer = setTimeout(() => finish({error: fail("code-load-failed", `在 ${String(options.timeoutMs ?? CODE_LOAD_TIMEOUT_MS)} 毫秒内没有登记`)}), options.timeoutMs ?? CODE_LOAD_TIMEOUT_MS);
            waiting.set(absolute, {resolve: (factory) => finish({factory})});
            options.document.defaultView?.addEventListener("error", onScriptError);
            script.async = true;
            script.src = absolute;
            // 登记发生在脚本执行时，早于 load 事件：到 load 还没登记，就是脚本执行了但没有交出工厂。
            script.onload = () => finish({error: fail("code-shape", "的脚本执行了，但没有登记工厂（不是用构建预设生成的产物？）")});
            script.onerror = () => finish({error: fail("code-load-failed", "的脚本加载失败（文件不存在，或服务端不可达）")});
            options.document.head.append(script);
        });
        pending.set(url, loading);
        return loading.then(
            (factory) => {
                pending.delete(url);
                factories.set(url, factory);
                return factory;
            },
            (error: unknown) => {
                pending.delete(url);
                throw error;
            },
        );
    };

    return {
        async activateOf({plugin, entry, url, signal}) {
            table ??= options.modules();
            const [modules, factory] = await Promise.all([table, fetchFactory(plugin, entry, url)]);
            if (signal.aborted) throw signal.reason;
            const module = {exports: {} as Record<string, unknown>};
            const require = (id: string): unknown => {
                if (!Object.hasOwn(modules, id)) throw new ModuleNotShared(id);
                return modules[id];
            };
            try {
                factory(module, module.exports, require);
            } catch (error) {
                if (error instanceof ModuleNotShared) throw new PluginCodeError("module-not-shared", {plugin, entry, url, detail: `${error.message}`});
                throw new PluginCodeError("code-threw", {plugin, entry, url, detail: `的模块顶层抛出：${error instanceof Error ? error.message : String(error)}`});
            }
            const activate = module.exports.activate;
            if (typeof activate !== "function") throw new PluginCodeError("code-shape", {plugin, entry, url, detail: "没有导出 activate"});
            return activate as Activate;
        },
    };
}
