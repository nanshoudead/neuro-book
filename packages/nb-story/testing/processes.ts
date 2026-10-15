/**
 * 在子进程里跑真实的 `nbstory` 命令与 `serve`。用完的服务进程由调用方 stop；测试失败时也要在 afterEach 里收口。
 */

import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export interface CliRun {
    code: number;
    stdout: string;
    stderr: string;
}

export async function runCli(args: readonly string[]): Promise<CliRun> {
    const child = Bun.spawn(["bun", CLI, ...args], {stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

export interface ServeProcess {
    /** 启动成功时的登录链接；启动失败时为 null。 */
    login: string | null;
    base: string | null;
    stderr(): string;
    /** 进程还没退出。 */
    running(): boolean;
    /** 发信号并等进程退出，返回退出码。 */
    stop(signal?: NodeJS.Signals): Promise<number>;
    exited: Promise<number>;
}

/** 启动 `serve`，等到打印出登录链接或进程先退出。 */
export async function startServe(library: string): Promise<ServeProcess> {
    const child = Bun.spawn(["bun", CLI, "serve", "--library", library], {stdout: "pipe", stderr: "pipe"});
    let out = "";
    let err = "";
    const decoder = new TextDecoder();
    void (async () => {
        for await (const chunk of child.stdout) out += decoder.decode(chunk);
    })();
    void (async () => {
        for await (const chunk of child.stderr) err += decoder.decode(chunk);
    })();
    let exited = false;
    void child.exited.then(() => {
        exited = true;
    });
    try {
        await waitUntil("serve 打印登录链接或退出", () => /http:\/\/\S+\/login\?token=\S+/u.test(out) || exited, {timeoutMs: 15_000});
    } catch (error) {
        // 没等到就绪：调用方拿不到句柄，这里自己收口。
        child.kill("SIGKILL");
        await child.exited;
        throw error;
    }
    const login = /http:\/\/\S+\/login\?token=\S+/u.exec(out)?.[0] ?? null;
    return {
        login,
        base: login ? login.slice(0, login.indexOf("/login")) : null,
        stderr: () => err,
        running: () => !exited,
        async stop(signal = "SIGTERM") {
            if (!exited) child.kill(signal);
            return child.exited;
        },
        exited: child.exited,
    };
}

/** 用登录链接登录，返回会话 Cookie（`名=值`）。 */
export async function loginCookie(login: string): Promise<string> {
    const response = await fetch(login, {redirect: "manual"});
    const cookie = response.headers.get("set-cookie");
    if (response.status !== 302 || !cookie) throw new Error(`登录失败：${response.status}`);
    return cookie.split(";")[0]!;
}

export async function rpc(base: string, method: string, params: unknown, cookie?: string): Promise<{status: number; body: unknown; instance: string | null}> {
    const response = await fetch(`${base}/api/rpc/${method}`, {
        method: "POST",
        headers: {"content-type": "application/json", ...(cookie ? {cookie} : {})},
        body: typeof params === "string" ? params : JSON.stringify(params),
    });
    return {status: response.status, body: await response.json(), instance: response.headers.get("x-nbstory-instance")};
}
