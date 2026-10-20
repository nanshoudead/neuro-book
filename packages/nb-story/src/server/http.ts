/**
 * 独立服务的 HTTP（docs/specs/story/queries.md 的“边界与兼容”）：
 * - `GET /login?token=<口令>` 是唯一不要求会话的地址；
 * - `POST /api/rpc/<方法名>` 按合同调用，失败按失败码给 HTTP 状态码与 `{code, message}`；
 * - 其余地址（网页资源与前端路由）都要会话，前端路由回退到 index.html。
 * 每个响应（含 401）都带实例号响应头，命令行据此判断登记是否有效；它不泄露书的内容。
 */

import {stat} from "node:fs/promises";
import {join, normalize} from "node:path";

import type {StoryApi} from "../core/api";
import {HTTP_STATUS} from "../core/errors";
import {INSTANCE_HEADER} from "../cli/registration";
import type {ServeAuth} from "./auth";
import {isIngestMethod, type IngestService} from "./ingest-service";

export interface HandlerOptions {
    api: StoryApi;
    ingest: IngestService;
    auth: ServeAuth;
    instance: string;
    /** 网页构建产物的目录；不存在时页面请求给出“还没有构建”的提示。 */
    webRoot: string;
}

const PAGE_401 = `<!doctype html><meta charset="utf-8"><title>剧情图谱</title><p>登录已失效，请用服务启动时打印的链接重新打开。</p>`;
const PAGE_400 = `<!doctype html><meta charset="utf-8"><title>剧情图谱</title><p>地址的编码不对。</p>`;
const PAGE_UNBUILT = `<!doctype html><meta charset="utf-8"><title>剧情图谱</title><p>查看器还没有构建：运行 <code>bun run --cwd packages/nb-story build:web</code> 后刷新。</p>`;

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8"}});
}

function html(status: number, body: string): Response {
    return new Response(body, {status, headers: {"content-type": "text/html; charset=utf-8"}});
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

/** `ingest.*` 的请求体上限：32 MiB 的原文经 base64 约 43 MiB，加上书名等字段。 */
export const INGEST_BODY_LIMIT = 48 * 1024 * 1024;

/** 读请求体，超过 `limit` 字节时取消读取并返回 null。 */
async function readLimited(request: Request, limit: number): Promise<string | null> {
    if (!request.body) return "";
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

/** 问答配置的失败码（抽取发起时读配置）对应的 HTTP 状态码。 */
const QA_HTTP_STATUS: Record<string, number> = {qa_unconfigured: 400, qa_config_write_failed: 500, full_read_unavailable: 400};

export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
    const {api, ingest, auth, instance, webRoot} = options;

    async function ingestRpc(request: Request, method: Parameters<IngestService["call"]>[0]): Promise<Response> {
        const tooLarge = () => json(HTTP_STATUS.ingest_bad_text, {code: "ingest_bad_text", message: "原文文件超过 32 MiB 的上限"});
        // 自报的长度只用来提前拒绝；分块传输没有长度，所以边读边数，超了就不再读（实现审查 S5 第 3 条）。
        if (Number(request.headers.get("content-length") ?? "0") > INGEST_BODY_LIMIT) return tooLarge();
        const text = await readLimited(request, INGEST_BODY_LIMIT);
        if (text === null) return tooLarge();
        let params: unknown;
        try {
            params = JSON.parse(text) as unknown;
        } catch {
            return json(HTTP_STATUS.invalid_params, {code: "invalid_params", message: "请求体不是 JSON"});
        }
        try {
            const outcome = await ingest.call(method, params);
            if (outcome.ok) return json(200, outcome.value);
            const status = (HTTP_STATUS as Record<string, number>)[outcome.error.code] ?? QA_HTTP_STATUS[outcome.error.code] ?? 400;
            return json(status, outcome.error);
        } catch (error) {
            console.error({method, error}, "抽取接口出错");
            return json(500, {code: "internal", message: "服务内部出错，详情见服务的日志"});
        }
    }

    async function rpc(request: Request, method: string): Promise<Response> {
        if (isIngestMethod(method)) return ingestRpc(request, method);
        let params: unknown;
        try {
            params = await request.json();
        } catch {
            return json(HTTP_STATUS.invalid_params, {code: "invalid_params", message: "请求体不是 JSON"});
        }
        try {
            const outcome = await api.call(method as Parameters<StoryApi["call"]>[0], params);
            if (outcome.ok) return json(200, outcome.value);
            return json(HTTP_STATUS[outcome.error.code], outcome.error);
        } catch (error) {
            console.error({method, error}, "查询出错");
            return json(500, {code: "internal", message: "服务内部出错，详情见服务的日志"});
        }
    }

    async function staticFile(pathname: string): Promise<Response> {
        const index = join(webRoot, "index.html");
        if (!(await isFile(index))) return html(200, PAGE_UNBUILT);
        let decoded: string;
        try {
            decoded = decodeURIComponent(pathname);
        } catch {
            return html(400, PAGE_400);
        }
        const relative = normalize(decoded).replace(/^([/\\])+/u, "");
        const candidate = join(webRoot, relative);
        // 只托管产物目录里的文件；其余路径（前端路由）都回到 index.html。
        if (relative !== "" && candidate.startsWith(webRoot) && (await isFile(candidate))) return new Response(Bun.file(candidate));
        return new Response(Bun.file(index), {headers: {"content-type": "text/html; charset=utf-8"}});
    }

    async function route(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/login") {
            const session = auth.login(url.searchParams.get("token"));
            if (!session) return html(401, PAGE_401);
            return new Response(null, {status: 302, headers: {location: "/", "set-cookie": auth.cookie(session)}});
        }
        const authorized = auth.authorized(request.headers.get("cookie"));
        if (url.pathname.startsWith("/api/")) {
            if (!authorized) return json(HTTP_STATUS.unauthorized, {code: "unauthorized", message: "没有有效的会话，请用服务启动时打印的登录链接重新登录"});
            const match = /^\/api\/rpc\/([^/]+)$/u.exec(url.pathname);
            if (!match || request.method !== "POST") return json(404, {code: "invalid_params", message: "没有这个接口"});
            let method: string;
            try {
                method = decodeURIComponent(match[1]!);
            } catch {
                return json(HTTP_STATUS.invalid_params, {code: "invalid_params", message: "方法名的编码不对"});
            }
            return rpc(request, method);
        }
        if (!authorized) return html(401, PAGE_401);
        return staticFile(url.pathname);
    }

    // 最外层的错误边界：任何没接住的异常都给出 JSON 或页面形式的 500，并且照样带实例号，不落到运行时的默认错误页。
    return async request => {
        let response: Response;
        try {
            response = await route(request);
        } catch (error) {
            console.error({url: request.url, error}, "请求出错");
            response = new URL(request.url).pathname.startsWith("/api/")
                ? json(500, {code: "internal", message: "服务内部出错，详情见服务的日志"})
                : html(500, `<!doctype html><meta charset="utf-8"><title>剧情图谱</title><p>服务内部出错。</p>`);
        }
        response.headers.set(INSTANCE_HEADER, instance);
        return response;
    };
}
