/**
 * 扮演后端，制造“样例结果行先于就绪探测返回到达”的先后：就绪探测（health）到达时先在标准输出打样例结果行，再在标准错误
 * 打 `health-held`，然后挂着这次探测，直到测试请求 `/release` 才回 200。标准输入读到 `stop` 或结束时退出。只由测试启动。
 */

const release = Promise.withResolvers<void>();
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/api/runtime/health") {
            process.stdout.write("[dev] open-path /?project=sample\n");
            process.stderr.write("health-held\n");
            await release.promise;
            return new Response("ok");
        }
        if (path === "/release") {
            release.resolve();
            return new Response("released");
        }
        return new Response(null, {status: 404});
    },
});
console.log(`Listening on ${server.url.href}`);
for await (const line of console) {
    if (line.trim() === "stop") break;
}
await server.stop(true);
process.exit(0);

// 顶层 await 要求本文件是模块。
export {};
