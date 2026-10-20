/**
 * 子进程里的回放端点（testing/ingest-replay.ts），给由 Node 运行的 e2e 用：Playwright 不在 Bun 下运行，用不了
 * `Bun.serve` 起的端点。启动后向标准输出写一行 `ready <端点地址> <控制地址>`。
 *
 * 控制接口（都是 POST，`key` 写成 `章/步骤`，步骤同回放：beats、draft、review-1、repair-1、consolidation）：
 * - `/close?key=`：关上闸门，之后这一步的请求先等着；
 * - `/open?key=`：打开闸门，等着的请求照常回放；
 * - `/seen`（GET）：已收到的请求，`[{chapter, step, round}]`。
 * 没关闸的请求照常回放。进程收到 SIGTERM 时停止。
 */

import {loadReplay, replay, type ReplayKey} from "./ingest-replay";
import {startEndpoint, type EndpointReply} from "./openai-endpoint";

const data = await loadReplay();
const gates = new Map<string, {promise: Promise<void>; open: () => void}>();
const recorded = (key: ReplayKey): EndpointReply | undefined => {
    const reply = data[String(key.chapter)]?.[key.step];
    return reply ? {kind: "text", text: reply.content, finishReason: reply.finishReason ?? "stop", ...(reply.usage ? {usage: reply.usage} : {})} : undefined;
};
const played = replay(data, key => {
    const gate = gates.get(`${key.chapter}/${key.step}`);
    const reply = recorded(key);
    return gate && reply ? {kind: "after", ready: gate.promise, reply} : undefined;
});
const endpoint = startEndpoint(played.responder);

const control = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
        const url = new URL(request.url);
        const key = url.searchParams.get("key") ?? "";
        if (url.pathname === "/seen") return Response.json(played.seen);
        if (url.pathname === "/close") {
            if (!gates.has(key)) {
                let open!: () => void;
                const promise = new Promise<void>(resolve => (open = resolve));
                gates.set(key, {promise, open});
            }
            return Response.json({ok: true});
        }
        if (url.pathname === "/open") {
            gates.get(key)?.open();
            gates.delete(key);
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
