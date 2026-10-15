/**
 * `nbstory serve`：启动查看器的独立服务（docs/specs/story/cli-skill.md 输出 5、F3）。
 *
 * 先后：拿服务锁 → 开始监听 → 写登记 → 打印登录链接。收到 SIGINT 或 SIGTERM 时：删登记 → 停止监听（在途请求随
 * 连接断开结束）→ 放锁。
 * 任何一步启动失败（书库目录、锁、监听、登记）都先关掉已开的监听、放锁，不留下登记，退出码 3；`--json` 时失败也只
 * 输出一份 JSON。
 */

import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "../core/api";
import {defaultLibraryRoot} from "../core/library";
import type {CliIo} from "../cli/main";
import {createServeAuth} from "./auth";
import {createHandler} from "./http";
import {acquireServeLock, registeredUrl, type ServeLock} from "./registry";

export const WEB_ROOT = join(import.meta.dir, "..", "..", "dist", "web");

export interface ServeOptions {
    library: string | undefined;
    port: number | undefined;
    open: boolean;
    /** 标准输出只写一份 JSON（docs/specs/story/cli-skill.md 输出 2）。 */
    json: boolean;
}

function openInBrowser(url: string): void {
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    try {
        Bun.spawn([command, url], {stdout: "ignore", stderr: "ignore"}).unref();
    } catch (error) {
        console.error({error}, "打开浏览器失败");
    }
}

export async function serveCommand(options: ServeOptions, io: CliIo): Promise<number> {
    const fail = (code: string, message: string): number => {
        if (options.json) io.stdout(JSON.stringify({ok: false, error: {code, message}}));
        else io.stderr(message);
        return 3;
    };
    const library = options.library ?? defaultLibraryRoot();
    let lock: ServeLock | null;
    try {
        await mkdir(library, {recursive: true});
        lock = acquireServeLock(library);
    } catch (error) {
        return fail("serve_failed", `启动失败：书库目录 ${library} 用不了（${error instanceof Error ? error.message : String(error)}）`);
    }
    if (!lock) {
        const url = await registeredUrl(library);
        return fail("already_running", `这个书库已有服务在运行${url ? `：${url}` : ""}`);
    }

    const instance = randomUUID();
    const api = createStoryApi({library});
    let server: ReturnType<typeof Bun.serve>;
    let handler: ((request: Request) => Promise<Response>) | null = null;
    try {
        server = Bun.serve({
            hostname: "127.0.0.1",
            port: options.port ?? 0,
            fetch: request => (handler ? handler(request) : new Response(null, {status: 503})),
        });
    } catch (error) {
        lock.release();
        return fail("serve_failed", `启动失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const port = server.port!;
    const auth = createServeAuth(port);
    handler = createHandler({api, auth, instance, webRoot: WEB_ROOT});
    const url = `http://127.0.0.1:${port}`;
    try {
        await lock.publish({instance, url, port, pid: process.pid});
    } catch (error) {
        await server.stop(true);
        await lock.withdraw();
        lock.release();
        return fail("serve_failed", `写服务登记失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const login = `${url}/login?token=${auth.token}`;
    if (options.json) io.stdout(JSON.stringify({ok: true, data: {login, url}}));
    else io.stdout(`剧情图谱查看器已启动：${login}`);
    if (options.open) openInBrowser(login);

    return new Promise<number>(resolve => {
        let stopping = false;
        const stop = async () => {
            if (stopping) return;
            stopping = true;
            // 撤销登记失败（例如书库目录变成只读）也要停掉监听、放锁，否则进程停不下来并一直占着锁；这时退出码为 1。
            let code = 0;
            try {
                await lock.withdraw();
            } catch (error) {
                code = 1;
                io.stderr(`撤销服务登记失败：${error instanceof Error ? error.message : String(error)}`);
            } finally {
                await server.stop(true);
                lock.release();
            }
            resolve(code);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
}
