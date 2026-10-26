/**
 * 子进程里的问答模型端点（testing/openai-endpoint.ts），给由 Node 运行的问答页 e2e 用：Playwright 不在 Bun 下运行，
 * 用不了 `Bun.serve` 起的端点。启动后向标准输出写一行 `ready <端点地址> <控制地址>`。
 *
 * 控制接口（POST，正文是 JSON）：
 * - `/script`：`{replies: EndpointReply[]}` 换一份脚本，之后的请求按顺序回复（`after` 不能经 JSON 传，用下面的闸门）；
 * - `/hold?from=N`：从下一个请求往后数第 N 个（0 是下一个，缺省 0）起先等着，直到 `/release`；等的时候请求被取消就结束（页面点“停止”）；
 * - `/release`：放行等着的请求；
 * - `/models`：`ModelsReply`，之后 `GET <端点>/models` 这样回（设置页读服务的模型列表）；缺省是空列表。
 * GET `/seen` 给已收到的请求数，GET `/bodies` 给收到的每个请求的 JSON 正文。脚本用完时回一段文字。进程收到 SIGTERM 时停止。
 */

import {startEndpoint, type EndpointReply, type ModelsReply} from "./openai-endpoint";

let replies: EndpointReply[] = [];
let models: ModelsReply = {kind: "models", ids: []};
let gate: {promise: Promise<void>; open: () => void; from: number} | null = null;
let seen = 0;
const endpoint = startEndpoint(
    () => {
        const index = seen;
        seen += 1;
        const reply = replies.shift() ?? {kind: "text", text: "脚本用完了"};
        return gate === null || index < gate.from ? reply : {kind: "after", ready: gate.promise, reply};
    },
    {idleTimeoutSeconds: 0, models: () => models},
);

const control = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/seen") return Response.json({seen});
        if (url.pathname === "/bodies") return Response.json({bodies: endpoint.bodies});
        if (url.pathname === "/script") {
            replies = ((await request.json()) as {replies: EndpointReply[]}).replies;
            return Response.json({ok: true});
        }
        if (url.pathname === "/models") {
            models = (await request.json()) as ModelsReply;
            return Response.json({ok: true});
        }
        if (url.pathname === "/hold") {
            if (gate === null) {
                let open!: () => void;
                const promise = new Promise<void>(resolve => (open = resolve));
                const from = url.searchParams.get("from");
                gate = {promise, open, from: seen + (from === null ? 0 : Number(from))};
            }
            return Response.json({ok: true});
        }
        if (url.pathname === "/release") {
            gate?.open();
            gate = null;
            return Response.json({ok: true});
        }
        return new Response(null, {status: 404});
    },
});

process.stdout.write(`ready ${endpoint.url} http://127.0.0.1:${control.port}\n`);
process.once("SIGTERM", () => {
    endpoint.stop();
    void control.stop(true);
    process.exit(0);
});
