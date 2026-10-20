/**
 * `nbstory serve`：启动查看器的独立服务（docs/specs/story/cli-skill.md 输出 5、F3）。
 *
 * 先后：拿服务锁 → 开始监听 → 写登记 → 装上停止信号的处理 → 打印登录链接。收到 SIGINT 或 SIGTERM 时：删登记 →
 * 停止监听（在途请求随连接断开结束）→ 放锁。
 * 信号处理必须在打印之前装：调用方读到登录链接就可能马上发 SIGTERM，Bun 在监听期间先打印、后装处理时，这个信号会
 * 按默认动作杀掉进程（退出码 143），登记留在书库里（2026-10-20 实测，先打印时 30 次全中）。
 * 任何一步启动失败（书库目录、锁、监听、登记）都先关掉已开的监听、放锁，不留下登记，退出码 3；`--json` 时失败也只
 * 输出一份 JSON。
 */

import {randomUUID} from "node:crypto";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {createStoryApi} from "../core/api";
import {defaultLibraryRoot} from "../core/library";
import {coordinatedLibrary} from "../ingest/coordinator";
import {createIngestService, type IngestService} from "./ingest-service";
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
    // 本服务运行的抽取任务由抽取服务管；删除书时书库的协调者经它先停这个 id 的任务（含正在启动的）。抽取服务要用
    // 书库，书库要用抽取服务，所以协调者在调用时才取它。
    let ingest!: IngestService;
    const books = coordinatedLibrary(library, {stop: id => ingest.stopLocal(id)});
    const api = createStoryApi({library: books});
    // 抽取的模型取自默认位置的配置（与 nbstory ingest 相同），每次发起时重读。
    ingest = createIngestService({library: books});
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
    handler = createHandler({api, ingest, auth, instance, webRoot: WEB_ROOT});
    const url = `http://127.0.0.1:${port}`;
    try {
        await lock.publish({instance, url, port, pid: process.pid});
    } catch (error) {
        await server.stop(true);
        await lock.withdraw();
        lock.release();
        return fail("serve_failed", `写服务登记失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const exited = new Promise<number>(resolve => {
        let stopping = false;
        const stop = async () => {
            if (stopping) return;
            stopping = true;
            // 先停下本服务的抽取任务、等它们放锁，再撤销登记、停监听（ingest-service.ts 模块头）。
            await ingest.close();
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

    const login = `${url}/login?token=${auth.token}`;
    if (options.json) io.stdout(JSON.stringify({ok: true, data: {login, url}}));
    else io.stdout(`剧情图谱查看器已启动：${login}`);
    if (options.open) openInBrowser(login);
    return exited;
}
