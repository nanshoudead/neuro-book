/**
 * Monaco 的按需加载（docs/specs/workbench/editor.md 输出 20）：第一次打开源码文件时才加载 ESM 入口、编辑器功能、JSON 的
 * 语言服务与 worker，首屏不含它们。别的语言经贡献点 `editor.languages` 登记（`languages.ts`），不在这里引入。加载失败时
 * 下次重试，不缓存失败。
 */

/// <reference path="./monaco-modules.d.ts" />

export type MonacoApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

let loading: Promise<MonacoApi> | null = null;

export function loadMonaco(): Promise<MonacoApi> {
    loading ??= (async () => {
        const [api, , , editorWorker, jsonWorker] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.api.js"),
            // `editor.api.js` 只有 API：查找、折叠、右键菜单这些功能要另外引入。
            import("monaco-editor/esm/vs/editor/editor.all.js"),
            import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
            import("monaco-editor/esm/vs/editor/editor.worker.js?worker"),
            import("monaco-editor/esm/vs/language/json/json.worker.js?worker"),
        ]);
        // 语言服务在模型释放后取消在途的请求，用 Monaco 自己的取消错误（名字与消息都是 "Canceled"）reject，没有人接，
        // 页面上就多一条未处理的拒绝。取消不是失败（VS Code 的 onUnexpectedError 同样忽略它）：只认这一种，其余照常报出。
        window.addEventListener("unhandledrejection", (event) => {
            const reason: unknown = event.reason;
            if (reason instanceof Error && reason.name === "Canceled" && reason.message === "Canceled") event.preventDefault();
        });
        // JSON 的语言服务要自己的 worker，其余走通用的 editor worker。
        globalThis.MonacoEnvironment = {
            getWorker: (_moduleId: string, label: string) => (label === "json" ? new jsonWorker.default() : new editorWorker.default()),
        };
        return api;
    })().catch((error: unknown) => {
        loading = null;
        throw error;
    });
    return loading;
}

/**
 * 模型的 URI 只为让 Monaco 按文件名与首行识别语言（docs/specs/workbench/editor.md 输出 44）。Monaco 的模型登记整页共用、URI
 * 不能重复，而同一文件在几个组里各有模型、不同目录也有同名文件：序号放在模块里，整页递增，不随控件实例重来。
 */
let modelSequence = 0;

export function modelUri(api: MonacoApi, address: string): InstanceType<MonacoApi["Uri"]> {
    modelSequence += 1;
    return api.Uri.from({scheme: "nbook-model", authority: `m${String(modelSequence)}`, path: `/${address.slice(address.lastIndexOf("/") + 1)}`});
}
