/**
 * 浏览器引导协议：窗口在挂载界面前向后端取有效插件集合与内核 RPC 端口（runtime.browser-host 启动序列第 2 步）。
 *
 * 前后端宿主共用这里的路径、协议版本与 schema；本目录只放合同，不引用任何一侧的实现。
 * 读取方容忍多出来的字段，只有破坏性变更才升协议版本；版本不同时窗口提示刷新，而不是尝试解析。
 * 版本 2 加入 `rpc`：新外壳没有它就连不上远程服务。版本 3 的 `plugins` 条目带上运行位置与顶层声明，
 * 第三方插件不在页面构建里，窗口据此在运行期登记它们。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const BROWSER_BOOTSTRAP_PATH = "/api/runtime/browser-bootstrap";
export const BROWSER_PROTOCOL_VERSION = 3;

export const BrowserBootstrapSchema = Type.Object({
    protocolVersion: Type.Integer(),
    /** 有效插件集合的修订号：集合与版本不变时不变，供以后的事件流核对集合是否变化。 */
    revision: Type.String({minLength: 1}),
    /**
     * 在浏览器登记的插件。内置插件的定义随前端构建，窗口按 id 与版本核对；第三方插件不在构建里，
     * 窗口用它带来的运行位置与顶层声明在运行期登记（runtime/plugin-manifest.md 输出 11）。
     */
    plugins: Type.Array(Type.Object({
        id: Type.String({minLength: 1}),
        version: Type.String({minLength: 1}),
        locations: Type.Optional(Type.Array(Type.String({minLength: 1}))),
        contributions: Type.Optional(Type.Array(Type.Object({
            capability: Type.String({minLength: 1}),
            id: Type.String({minLength: 1}),
            declaration: Type.Unknown(),
        }, {additionalProperties: false}))),
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
