/**
 * 独立服务的 HTTP（docs/specs/story/queries.md 的“边界与兼容”）：
 * - `GET /login?token=<口令>` 是唯一不要求会话的地址；
 * - `POST /api/rpc/<方法名>` 按合同调用，失败按失败码给 HTTP 状态码与 `{code, message}`；
 * - `GET /api/qa/events?book=&conversation=` 是一个对话运行中的推送（SSE，帧见 contract.ts 的 `QaFrame`）；
 * - 其余地址（网页资源与前端路由）都要会话，前端路由回退到 index.html。
 * 每个响应（含 401）都带实例号响应头，命令行据此判断登记是否有效；它不泄露书的内容。
 */

import {stat} from "node:fs/promises";
import {join, normalize} from "node:path";

import {STORY_METHODS, type QaFrame} from "../contract/contract";
import {schemaProblems, type StoryApi} from "../core/api";
import {HTTP_STATUS} from "../core/errors";
import {INSTANCE_HEADER} from "../cli/registration";
import type {ServeAuth} from "./auth";
import {isIngestMethod, type IngestService} from "./ingest-service";
import {isQaMethod, type QaService} from "./qa-service";

export interface HandlerOptions {
    api: StoryApi;
    ingest: IngestService;
    qa: QaService;
    auth: ServeAuth;
    instance: string;
    /** 网页构建产物的目录；不存在时页面请求给出“还没有构建”的提示。 */
    webRoot: string;
    /**
     * 改这个请求的空闲超时（秒，0 为不限；Bun 的 `server.timeout`）。Bun 默认 10 秒没有收发就断开连接：推送的流
     * 要一直开着，测试连接与开始问答的准备也可能超过 10 秒。
     */
    timeout?: (request: Request, seconds: number) => void;
    /** 推送的心跳间隔，默认 20 秒。 */
    heartbeatMs?: number;
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

/** 问答与配置的失败码对应的 HTTP 状态码。 */
const QA_HTTP_STATUS: Record<string, number> = {qa_unconfigured: 400, qa_config_write_failed: 500, full_read_unavailable: 400, qa_not_continuable: 409, qa_busy: 409, qa_position_fixed: 409, qa_conflict: 409, config_conflict: 409, skill_exists: 409, skill_target_invalid: 400, skill_install_failed: 500};

/** RPC 的空闲超时：最长的是测试连接（最多等模型 60 秒）。 */
const RPC_TIMEOUT_SECONDS = 120;

/**
 * 一个推送连接最多积压多少字节还没发出去。读得慢的页面（后台标签页、卡住的连接）超过它就断开：页面重连时按
 * `qa.get` 与新的快照补齐，丢帧可以恢复，积压却会让服务的内存随运行时长一直涨。
 */
export const EVENTS_BACKLOG_BYTES = 2 * 1024 * 1024;

export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
    const {api, ingest, qa, auth, instance, webRoot} = options;
    const heartbeatMs = options.heartbeatMs ?? 20_000;

    function statusOf(code: string): number {
        return (HTTP_STATUS as Record<string, number>)[code] ?? QA_HTTP_STATUS[code] ?? 400;
    }

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
            return json(statusOf(outcome.error.code), outcome.error);
        } catch (error) {
            console.error({method, error}, "抽取接口出错");
            return json(500, {code: "internal", message: "服务内部出错，详情见服务的日志"});
        }
    }

    async function rpc(request: Request, method: string): Promise<Response> {
        options.timeout?.(request, RPC_TIMEOUT_SECONDS);
        if (isIngestMethod(method)) return ingestRpc(request, method);
        let params: unknown;
        try {
            params = await request.json();
        } catch {
            return json(HTTP_STATUS.invalid_params, {code: "invalid_params", message: "请求体不是 JSON"});
        }
        try {
            if (isQaMethod(method)) {
                const outcome = await qa.call(method, params);
                return outcome.ok ? json(200, outcome.value) : json(statusOf(outcome.error.code), outcome.error);
            }
            const call = () => api.call(method as Parameters<StoryApi["call"]>[0], params);
            // 删除书先关上这本书的问答、等进行中的几轮收口（qa-service.ts 模块头）。参数先按合同校验：不对的直接交给
            // 查询接口报错，不为一个不会执行的删除去停问答。
            const book = method === "book.remove" && schemaProblems(STORY_METHODS["book.remove"].input, params) === null ? (params as {book: string}).book : null;
            const outcome = book === null ? await call() : await qa.exclusive(book, call);
            if (outcome.ok) return json(200, outcome.value);
            return json(HTTP_STATUS[outcome.error.code], outcome.error);
        } catch (error) {
            console.error({method, error}, "查询出错");
            return json(500, {code: "internal", message: "服务内部出错，详情见服务的日志"});
        }
    }

    /**
     * 一个对话运行中的推送。第一帧是 `snapshot`；没有运行或已经结束时随即结束。之后每帧一条 SSE 消息，`ended` 之后
     * 结束；页面断开（请求的 signal）时退订；积压超过 `EVENTS_BACKLOG_BYTES` 时断开。间隔发注释行当心跳，让中间的
     * 代理与浏览器知道连接还活着。
     */
    function events(request: Request, url: URL): Response {
        const book = url.searchParams.get("book");
        const conversation = url.searchParams.get("conversation");
        if (!book || !conversation) return json(HTTP_STATUS.invalid_params, {code: "invalid_params", message: "要给 book 与 conversation"});
        options.timeout?.(request, 0);
        const encoder = new TextEncoder();
        let finish = () => {};
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                let closed = false;
                let heartbeat: ReturnType<typeof setInterval> | null = null;
                let subscription: {close(): void} | null = null;
                finish = () => {
                    if (closed) return;
                    closed = true;
                    if (heartbeat !== null) clearInterval(heartbeat);
                    subscription?.close();
                    request.signal.removeEventListener("abort", finish);
                    try {
                        controller.close();
                    } catch {
                        // 对方已经断开，流已经关了。
                    }
                };
                const send = (frame: QaFrame) => {
                    if (closed) return;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
                    // 按字节计的队列（见下面的 size）：desiredSize 是负的积压字节数。
                    if (frame.type === "ended" || (controller.desiredSize ?? 0) < -EVENTS_BACKLOG_BYTES) queueMicrotask(finish);
                };
                // 先挂上中止的处理再订阅：请求在这之前（或订阅的同时）已经断开，就不留下订阅与心跳。
                request.signal.addEventListener("abort", finish);
                if (request.signal.aborted) {
                    finish();
                    return;
                }
                const opened = qa.subscribe(book, conversation, send);
                subscription = opened;
                if (!opened.live || closed) {
                    finish();
                    opened.close();
                    return;
                }
                heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(encoder.encode(": ping\n\n"));
                    } catch {
                        finish();
                    }
                }, heartbeatMs);
            },
            cancel() {
                finish();
            },
        }, {highWaterMark: 0, size: chunk => chunk?.byteLength ?? 0});
        return new Response(body, {headers: {"content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no"}});
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
            if (url.pathname === "/api/qa/events" && request.method === "GET") return events(request, url);
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
