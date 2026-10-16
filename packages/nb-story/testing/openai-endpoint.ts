/**
 * 本机的 OpenAI 兼容端点：按顺序给出脚本里的回复，记下每次请求带的认证头与正文。命令行测试用它代替真实模型服务，
 * 请求经真实的 OMP provider 与 HTTP 发出（写法同 nb-harness 的 tests/provider.test.ts）。
 */

export type EndpointReply =
    | {kind: "tools"; calls: {name: string; args: Record<string, unknown>}[]}
    | {kind: "text"; text: string}
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

export function startEndpoint(replies: EndpointReply[]): Endpoint {
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
            bodies.push(JSON.parse(await request.text()) as Record<string, unknown>);
            const reply = replies.shift() ?? {kind: "text", text: "脚本用完了"};
            const usage = {choices: [], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
            switch (reply.kind) {
                case "status": {
                    const message = reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : "error";
                    return new Response(JSON.stringify({error: {message}}), {status: reply.status, headers: {"content-type": "application/json"}});
                }
                case "hang":
                    return new Promise<Response>(resolve => request.signal.addEventListener("abort", () => resolve(new Response(null, {status: 499}))));
                case "text":
                    return new Response(sse([{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}, {choices: [{index: 0, delta: {}, finish_reason: "stop"}]}, usage]), {
                        headers: {"content-type": "text/event-stream"},
                    });
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
