/**
 * 本机的 OpenAI 兼容端点：按顺序给出脚本里的回复（或由一个函数按请求内容决定回复），记下每次请求带的认证头与正文。
 * 命令行测试用它代替真实模型服务，请求经真实的 OMP provider 或 OpenAI SDK 与 HTTP 发出（写法同 nb-harness 的
 * tests/provider.test.ts）。
 */

export type EndpointReply =
    | {kind: "tools"; calls: {name: string; args: Record<string, unknown>}[]}
    /** 正常的文字回复；`finishReason` 默认 `stop`，`usage` 默认一组固定的小数。 */
    | {kind: "text"; text: string; finishReason?: string; usage?: Record<string, unknown>}
    /** 先给这段文字，然后一直输出空白，直到请求被取消（“跑飞”）。 */
    | {kind: "runaway"; text: string}
    /** 给这段文字后直接结束，没有结束原因也没有用量（流中断）。 */
    | {kind: "cut"; text: string}
    /** HTTP 200 开始流，流到一半发一个错误事件（luna 渠道的 upstream_error 就是这样）。 */
    | {kind: "stream-error"; message: string}
    /** 回错误状态码；`echoKey` 时错误正文里原样带上收到的认证头。 */
    | {kind: "status"; status: number; echoKey?: boolean}
    /** 不回应，直到请求被取消。 */
    | {kind: "hang"};

export interface Endpoint {
    readonly url: string;
    /** 每次请求的认证头。 */
    readonly authorizations: (string | null)[];
    /** 每次请求的 JSON 正文。 */
    readonly bodies: Record<string, unknown>[];
    /** 第一次收到请求时 resolve。 */
    readonly firstRequest: Promise<void>;
    stop(): void;
}

function sse(chunks: object[]): string {
    return `${chunks.map(chunk => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...chunk})}\n\n`).join("")}data: [DONE]\n\n`;
}

/** 按请求正文决定回复；`index` 是这是第几次请求（从 0 起）。 */
export type Responder = (body: Record<string, unknown>, index: number) => EndpointReply;

export function startEndpoint(replies: EndpointReply[] | Responder): Endpoint {
    const authorizations: (string | null)[] = [];
    const bodies: Record<string, unknown>[] = [];
    let signalFirst!: () => void;
    const firstRequest = new Promise<void>(resolve => (signalFirst = resolve));
    let calls = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            authorizations.push(request.headers.get("authorization"));
            signalFirst();
            const body = JSON.parse(await request.text()) as Record<string, unknown>;
            bodies.push(body);
            const reply = typeof replies === "function" ? replies(body, bodies.length - 1) : replies.shift() ?? {kind: "text", text: "脚本用完了"};
            const usage = {choices: [], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
            const encoder = new TextEncoder();
            switch (reply.kind) {
                case "status": {
                    const message = reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : "error";
                    return new Response(JSON.stringify({error: {message}}), {status: reply.status, headers: {"content-type": "application/json"}});
                }
                case "hang":
                    return new Promise<Response>(resolve => request.signal.addEventListener("abort", () => resolve(new Response(null, {status: 499}))));
                case "text":
                    return new Response(
                        sse([
                            {choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]},
                            {choices: [{index: 0, delta: {}, finish_reason: reply.finishReason ?? "stop"}]},
                            reply.usage ? {choices: [], usage: reply.usage} : usage,
                        ]),
                        {headers: {"content-type": "text/event-stream"}},
                    );
                case "stream-error": {
                    const first = sse([{choices: [{index: 0, delta: {role: "assistant", content: "{"}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    return new Response(`${first}data: ${JSON.stringify({error: {message: reply.message, type: "upstream_error"}})}\n\n`, {headers: {"content-type": "text/event-stream"}});
                }
                case "cut": {
                    const chunk = sse([{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    return new Response(chunk, {headers: {"content-type": "text/event-stream"}});
                }
                case "runaway": {
                    const first = sse([{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    const blank = sse([{choices: [{index: 0, delta: {content: " ".repeat(500)}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    // 一直写空白，直到客户端取消读取（cancel）或请求被中止。
                    const stream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(encoder.encode(first));
                        },
                        pull(controller) {
                            if (request.signal.aborted) {
                                controller.close();
                                return;
                            }
                            controller.enqueue(encoder.encode(blank));
                        },
                    });
                    return new Response(stream, {headers: {"content-type": "text/event-stream"}});
                }
                case "tools": {
                    const toolCalls = reply.calls.map((call, index) => {
                        calls += 1;
                        return {index, id: `call_${calls}`, type: "function", function: {name: call.name, arguments: JSON.stringify(call.args)}};
                    });
                    return new Response(sse([{choices: [{index: 0, delta: {role: "assistant", tool_calls: toolCalls}, finish_reason: null}]}, {choices: [{index: 0, delta: {}, finish_reason: "tool_calls"}]}, usage]), {
                        headers: {"content-type": "text/event-stream"},
                    });
                }
            }
        },
    });
    return {url: `http://127.0.0.1:${server.port}/v1`, authorizations, bodies, firstRequest, stop: () => server.stop(true)};
}
