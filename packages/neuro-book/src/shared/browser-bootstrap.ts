/**
 * 浏览器引导协议：窗口在挂载界面前向后端取有效插件集合与内核 RPC 端口（runtime.browser-host 启动序列第 2 步）。
 *
 * 前后端宿主共用这里的路径、协议版本与 schema；本目录只放合同，不引用任何一侧的实现。
 * 读取方容忍多出来的字段，只有破坏性变更才升协议版本；版本不同时窗口提示刷新，而不是尝试解析。
 * 版本 2 加入 `rpc`：新外壳没有它就连不上远程服务。版本 3 的 `plugins` 条目带上运行位置与顶层声明，
 * 第三方插件不在页面构建里，窗口据此在运行期登记它们。版本 4 改为带第三方插件的清单（浏览器用得到的部分）与文件 URL
 * 的前缀：窗口要按清单登记入口、经插件文件端点取回代码与样式（docs/specs/runtime/plugin-code-loading.md）。版本 5 加入
 * `catalogs`（第三方插件的消息目录索引）：窗口在挂载界面前取齐目录并登记进翻译引擎，旧窗口不认识它，会把插件文字显示成
 * 键名（docs/specs/runtime/browser-host.md 输出 2）。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const BROWSER_BOOTSTRAP_PATH = "/api/runtime/browser-bootstrap";
export const BROWSER_PROTOCOL_VERSION = 5;

export const BrowserBootstrapSchema = Type.Object({
    protocolVersion: Type.Integer(),
    /**
     * 有效插件集合的修订号：集合、版本、第三方插件的内容摘要与目录索引不变时不变，供以后的事件流核对集合是否变化。只有后端
     * 入口的插件不在 `plugins` 里，它的目录变化经目录索引算进来。
     */
    revision: Type.String({minLength: 1}),
    /**
     * 在浏览器登记的插件。内置插件的定义随前端构建，窗口按 id 与版本核对；第三方插件不在构建里，带 `manifest`
     * （`package.json` 的原始内容，入口只留浏览器的）与 `files`（插件文件 URL 的前缀，以 `/` 结尾），窗口按清单在运行期
     * 登记它（runtime/plugin-manifest.md 输出 11）。
     */
    plugins: Type.Array(Type.Object({
        id: Type.String({minLength: 1}),
        version: Type.String({minLength: 1}),
        manifest: Type.Optional(Type.Unknown()),
        files: Type.Optional(Type.String({pattern: "^/.*/$"})),
    })),
    /**
     * 消息目录索引：本次启动有效安装、清单写了 `l10n` 的第三方插件，不限于在浏览器登记的（只有后端入口的插件的文字也在窗口里
     * 显示）。`digest` 是版本目录的内容摘要，`prefix` 是目录端点的 URL 前缀（以 `/` 结尾，后接 `<语言>.json`）。内置插件的目录
     * 随前端构建，不在这里。按插件 id 排序。
     */
    catalogs: Type.Array(Type.Object({
        plugin: Type.String({minLength: 1}),
        source: Type.String({minLength: 1}),
        locales: Type.Array(Type.String({minLength: 1}), {minItems: 1}),
        digest: Type.String({minLength: 1}),
        prefix: Type.String({pattern: "^/.*/$"}),
    })),
    /** 内核 RPC 端口与路径。窗口用页面自己的主机名与协议拼出地址，使连接的 Origin 与页面一致。 */
    rpc: Type.Object({port: Type.Integer({minimum: 1, maximum: 65_535}), path: Type.String({pattern: "^/"})}),
    /** 请求带 `project` 且这部作品已登记时才有：界面上的显示名（书名，没有书名时是目录原名）。 */
    project: Type.Optional(Type.Object({title: Type.String({minLength: 1})})),
});

export type BrowserBootstrap = Static<typeof BrowserBootstrapSchema>;

/**
 * 引导响应声明的协议版本，先于结构校验读取：新版本的服务端可能改了结构，此时应提示刷新而不是报格式错误。
 * 没有这个字段或它不是整数时返回 null，交给结构校验判为不符合协议。首连与断线重连都经这里判定。
 */
export function declaredProtocolVersion(raw: unknown): number | null {
    if (typeof raw !== "object" || raw === null || !("protocolVersion" in raw)) return null;
    const version = raw.protocolVersion;
    return typeof version === "number" && Number.isInteger(version) ? version : null;
}
