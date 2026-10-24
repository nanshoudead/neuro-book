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

import {PluginCodeError} from "nbook/plugin-platform/shared/plugin-code-error";
import type {PluginCodeFailure} from "nbook/plugin-platform/shared/plugin-code-error";
import {PLUGIN_REGISTRY_GLOBAL} from "nbook/plugin-platform/shared/plugin-modules";

/** 从插入脚本起（含下载）多久还没登记工厂算失败；回环上的服务端正常情况下远不到这么久。 */
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

/**
 * 全局登记对象：产物脚本经它交出工厂，装载器经它等待。“谁在等哪个 URL”放在这个对象自己身上而不是装载器模块里：同一页面里
 * 几个装载器（测试、Lab 的几个窗口）共用一张表，同一 URL 的每个等待者都收到工厂，互不覆盖；Vite 重新求值本模块后，新的
 * 模块实例取到的仍是同一个对象、同一张表。
 *
 * 对象冻结、全局属性不可写不可删：插件代码都在同一页面里执行，不能把它换掉。装载器经 `registry()` 取它，测试只读这个全局
 * 属性、不写它，所以同一进程里的几个测试文件能共存。代价是对象的形状在页面的一生里固定：开发时改了 `PluginRegistry` 的方法，
 * 要刷新页面才生效。
 */
interface PluginRegistry {
    /** 产物脚本执行时调用。没有人在等这个 URL（不是装载器插入的脚本，或等待者已超时、已停止）时不理会。 */
    register(url: string, factory: unknown): void;
    /** 等这个 URL 的登记；返回的函数撤回这个等待者。 */
    wait(url: string, waiter: (factory: Factory) => void): () => void;
}

function registry(): PluginRegistry {
    const scope = globalThis as unknown as Record<string, PluginRegistry | undefined>;
    const existing = scope[PLUGIN_REGISTRY_GLOBAL];
    if (existing !== undefined) return existing;
    const waiting = new Map<string, Set<(factory: Factory) => void>>();
    const created: PluginRegistry = Object.freeze({
        register: (url: string, factory: unknown) => {
            // 不是函数的登记同样不理会：装载器到 load 事件还没收到工厂，按 `code-shape` 报告。
            if (typeof factory !== "function") return;
            // 先复制：等待者收到工厂后会撤回自己。
            for (const waiter of [...(waiting.get(url) ?? [])]) waiter(factory as Factory);
        },
        wait: (url: string, waiter: (factory: Factory) => void) => {
            let waiters = waiting.get(url);
            if (waiters === undefined) {
                waiters = new Set();
                waiting.set(url, waiters);
            }
            waiters.add(waiter);
            return () => {
                const current = waiting.get(url);
                if (current === undefined) return;
                current.delete(waiter);
                if (current.size === 0) waiting.delete(url);
            };
        },
    });
    Object.defineProperty(scope, PLUGIN_REGISTRY_GLOBAL, {value: created, configurable: false, enumerable: false, writable: false});
    return created;
}

export interface PluginCodeHost {
    /**
     * 这个入口这一次激活用的 `activate`：取回（只取一次）并执行一次工厂。`signal` 中止时立刻以 `signal.reason` 失败，不等
     * 脚本或超时；这个文件再没有别的激活在等时，撤下脚本、监听与计时器，之后迟到的登记不理会。
     */
    activateOf(input: {readonly plugin: string; readonly entry: string; readonly url: string; readonly signal: AbortSignal}): Promise<Activate>;
}

export interface PluginCodeHostOptions {
    readonly document: PluginDocument;
    /**
     * 宿主模块表：模块 id → 冻结的模块对象。第一次装载时才取（只有第三方浏览器入口用到它）；取不到时不缓存失败，下一次激活
     * 重新取。
     */
    readonly modules: () => Promise<Readonly<Record<string, unknown>>>;
    readonly timeoutMs?: number;
}

/** 取回失败的原因。不带插件与入口：几个入口的 `main` 可以是同一个文件，各自的激活按自己的插件与入口报告。 */
interface LoadFailure {
    readonly code: PluginCodeFailure;
    readonly detail: string;
}

/** 一个文件正在进行的取回：同一装载器里同一文件的几次激活共用它，`users` 是还在等它的激活数。`factory` 以 `LoadFailure` 失败。 */
interface Loading {
    readonly factory: Promise<Factory>;
    users: number;
    /** 还没结算时撤下脚本、全局 error 监听、计时器与登记对象上的等待者，`factory` 从此不再结算；已结算时什么也不做。 */
    cancel(): void;
}

export function createPluginCodeHost(options: PluginCodeHostOptions): PluginCodeHost {
    const timeoutMs = options.timeoutMs ?? CODE_LOAD_TIMEOUT_MS;
    const shared = registry();
    /** 登记成功的工厂，按脚本的绝对 URL；失败的不缓存，下次激活重新插入脚本。 */
    const factories = new Map<string, Factory>();
    const loadings = new Map<string, Loading>();
    let fetchingModules: Promise<Readonly<Record<string, unknown>>> | null = null;

    const hostModules = (): Promise<Readonly<Record<string, unknown>>> => {
        // 失败时先清掉缓存再把失败交给这一次的各个激活：典型原因是服务端升级后页面还开着、动态 chunk 404，之后的重试应当重新取。
        fetchingModules ??= (async () => options.modules())().then(undefined, (error: unknown) => {
            fetchingModules = null;
            throw error;
        });
        return fetchingModules;
    };

    const startLoading = (absolute: string): Loading => {
        const fail = (code: PluginCodeFailure, detail: string): LoadFailure => ({code, detail});
        const view = options.document.defaultView;
        const script = options.document.createElement("script");
        let settled = false;
        let resolveFactory: (factory: Factory) => void = () => undefined;
        let rejectFactory: (error: LoadFailure) => void = () => undefined;
        const factory = new Promise<Factory>((resolve, reject) => {
            resolveFactory = resolve;
            rejectFactory = reject;
        });
        // 收口一处：结算或撤下都经这里，脚本元素、监听、计时器、等待者一并释放，只做一次。
        const finish = (outcome: {readonly factory: Factory} | {readonly error: LoadFailure} | null): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            stopWaiting();
            view?.removeEventListener("error", onScriptError);
            script.onload = null;
            script.onerror = null;
            script.remove();
            if (loadings.get(absolute) === loading) loadings.delete(absolute);
            if (outcome === null) return;
            if ("factory" in outcome) {
                factories.set(absolute, outcome.factory);
                resolveFactory(outcome.factory);
            } else {
                rejectFactory(outcome.error);
            }
        };
        // 脚本自身的语法错误不触发 onerror：浏览器派发全局 error 事件，事件的文件名就是脚本 URL，之后 onload 照常触发。
        const onScriptError = (event: {readonly filename: string; readonly message: string}): void => {
            if (event.filename === absolute) finish({error: fail("code-threw", `的脚本执行出错：${event.message}`)});
        };
        const timer = setTimeout(() => finish({error: fail("code-load-failed", `在 ${String(timeoutMs)} 毫秒内没有登记`)}), timeoutMs);
        const stopWaiting = shared.wait(absolute, (registered) => finish({factory: registered}));
        const loading: Loading = {factory, users: 0, cancel: () => finish(null)};
        view?.addEventListener("error", onScriptError);
        script.async = true;
        script.src = absolute;
        // 登记发生在脚本执行时，早于 load 事件：到 load 还没登记，就是脚本执行了但没有交出工厂。
        script.onload = () => finish({error: fail("code-shape", "的脚本执行了，但没有登记工厂（不是用构建预设生成的产物？）")});
        script.onerror = () => finish({error: fail("code-load-failed", "的脚本加载失败（文件不存在，或服务端不可达）")});
        loadings.set(absolute, loading);
        options.document.head.append(script);
        return loading;
    };

    /** 这一次激活的工厂：已登记的直接给；否则加入（或发起）这个文件的取回，`signal` 中止时离开，最后一个离开的撤下取回。 */
    const factoryFor = async (plugin: string, entry: string, url: string, absolute: string, signal: AbortSignal): Promise<Factory> => {
        const known = factories.get(absolute);
        if (known !== undefined) return known;
        const loading = loadings.get(absolute) ?? startLoading(absolute);
        loading.users += 1;
        try {
            return await untilAborted(loading.factory.catch((failure: LoadFailure) => {
                throw new PluginCodeError(failure.code, {plugin, entry, url, detail: failure.detail});
            }), signal);
        } finally {
            loading.users -= 1;
            if (loading.users === 0) loading.cancel();
        }
    };

    return {
        async activateOf({plugin, entry, url, signal}) {
            // 已经停止的激活什么都不做：不插脚本，也不取宿主模块表（取了没人等它的结果）。
            if (signal.aborted) throw signal.reason;
            const absolute = new URL(url, options.document.baseURI).href;
            const modules = hostModules().catch((error: unknown) => {
                throw new PluginCodeError("code-load-failed", {plugin, entry, url, detail: `装载不了：宿主模块表没有取到（${error instanceof Error ? error.message : String(error)}）`, cause: error});
            });
            const [table, factory] = await Promise.all([untilAborted(modules, signal), factoryFor(plugin, entry, url, absolute, signal)]);
            if (signal.aborted) throw signal.reason;
            const module = {exports: {} as Record<string, unknown>};
            const require = (id: string): unknown => {
                if (!Object.hasOwn(table, id)) throw new ModuleNotShared(id);
                return table[id];
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

/** `promise` 先结算就照它结算；`signal` 先中止就以 `signal.reason` 失败。结算后撤掉挂在 `signal` 上的监听：入口的信号活得比一次取回长。 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason as unknown);
    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(signal.reason as unknown);
        signal.addEventListener("abort", onAbort, {once: true});
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}
