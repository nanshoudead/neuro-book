/**
 * 测试用的假页面（Bun 里没有 DOM），按装载器的窄接口 `PluginDocument` 写；入口代码的装载器、窗口的插件样式与构建产物的测试
 * 共用这一份，替身的时序只在这里写一次。
 *
 * 时序按浏览器：插入的脚本在下一轮事件循环里取回并执行。执行时经全局登记对象交出工厂（与构建产物的登记外壳一样只读那个全局，
 * 不写它），执行出错派发带文件名的全局 error 事件，执行完触发 load；文件取不到触发 error。样式表挂进 head，`failStyles` 让
 * 它们像取不到文件那样派发 error。真实浏览器里的同一条路径由 e2e `plugin-code.e2e.ts` 走，这里的时序以它为准。
 */

import type {PluginDocument, PluginLink, PluginScript} from "../web/plugin-code";

export type ModuleFactory = (module: {exports: Record<string, unknown>}, exports: Record<string, unknown>, require: (id: string) => unknown) => void;

/** 文件在“服务端”上的样子：取到后执行时做什么。 */
export type ServedScript =
    | {readonly kind: "registers"; readonly factory: ModuleFactory}
    /** 构建产物的源码：像浏览器那样执行，`document.currentScript` 是这个脚本。 */
    | {readonly kind: "runs"; readonly code: string}
    | {readonly kind: "throws"; readonly message: string}
    | {readonly kind: "silent"}
    | {readonly kind: "missing"}
    /** 请求一直挂着：不执行、不触发 load 与 error。 */
    | {readonly kind: "hangs"};

/** `connected`：元素还在文档里（插入后、`remove()` 前）。 */
export interface FakeScript extends PluginScript {
    connected: boolean;
}

interface FakeLink extends PluginLink {
    readonly failed: Array<() => void>;
}

type ErrorListener = (event: {readonly filename: string; readonly message: string}) => void;

let pageSequence = 0;

/**
 * 一个页面：每个页面有自己的基址，各用例的文件 URL 互不相同（全局登记对象在整个测试进程里只有一个，不同页面的登记不能交错）。
 * `registryGlobal` 是平台档案里登记对象的全局名。
 */
export function fakePage(registryGlobal: string) {
    pageSequence += 1;
    const baseURI = `http://plugin.test/page-${String(pageSequence)}/`;
    const served = new Map<string, ServedScript>();
    const scripts: FakeScript[] = [];
    const styles: FakeLink[] = [];
    const errorListeners = new Set<ErrorListener>();

    const fail = (script: FakeScript, message: string): void => {
        for (const listener of [...errorListeners]) listener({filename: script.src, message});
    };

    const execute = (script: FakeScript): void => {
        const file = served.get(script.src) ?? {kind: "missing"};
        switch (file.kind) {
            case "hangs":
                return;
            case "missing":
                script.onerror?.();
                return;
            case "registers":
                registry(registryGlobal).register(script.src, file.factory);
                break;
            case "runs":
                try {
                    new Function("document", file.code)({currentScript: script});
                } catch (error) {
                    fail(script, error instanceof Error ? error.message : String(error));
                }
                break;
            case "throws":
                fail(script, file.message);
                break;
            case "silent":
                break;
        }
        script.onload?.();
    };

    function createElement(tag: "script"): PluginScript;
    function createElement(tag: "link"): PluginLink;
    function createElement(tag: "script" | "link"): PluginScript | PluginLink {
        if (tag === "link") {
            const link: FakeLink = {
                rel: "",
                href: "",
                dataset: {},
                failed: [],
                addEventListener: (_type, listener) => {
                    link.failed.push(listener);
                },
                remove: () => {
                    const at = styles.indexOf(link);
                    if (at >= 0) styles.splice(at, 1);
                },
            };
            return link;
        }
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
                if ("rel" in node) {
                    styles.push(node as FakeLink);
                    return;
                }
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
        /** 让页面上 `path`（相对基址）的文件取到后做 `file` 说的事。 */
        serve(path: string, file: ServedScript): void {
            served.set(new URL(path, baseURI).href, file);
        },
        /** 这个文件的脚本此刻才执行完、交出工厂（例如装载器已经不等它之后）。 */
        register(path: string, factory: ModuleFactory): void {
            registry(registryGlobal).register(new URL(path, baseURI).href, factory);
        },
        /** 插入过的、指向这个文件的脚本元素，按插入先后。 */
        scriptsFor: (path: string): ReadonlyArray<FakeScript> => scripts.filter((script) => script.src === new URL(path, baseURI).href),
        /** 页面上还挂着的全局 error 监听数。 */
        errorListenerCount: (): number => errorListeners.size,
        /** 还挂在 head 里的样式表，按插入先后。 */
        styles: (): ReadonlyArray<PluginLink> => [...styles],
        /** 让挂着的样式表都像取不到文件那样派发 error。 */
        failStyles(): void {
            for (const link of [...styles]) for (const listener of link.failed) listener();
        },
    };
}

export type FakePage = ReturnType<typeof fakePage>;

/** 产物脚本看到的全局登记对象（装载器建立它）。 */
function registry(registryGlobal: string): {register(url: string, factory: unknown): void} {
    const found = (globalThis as unknown as Record<string, {register(url: string, factory: unknown): void} | undefined>)[registryGlobal];
    if (found === undefined) throw new Error("页面上还没有登记对象：装载器没有建立");
    return found;
}
