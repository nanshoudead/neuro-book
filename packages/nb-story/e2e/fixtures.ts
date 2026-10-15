/**
 * e2e 的场地：临时书库里导入样例书，起真实的 `nbstory serve`，用打印的登录链接登录。
 * 子进程用 Node 的 child_process 起（e2e 由 Node 运行），命令本身仍是 `bun src/cli.ts`。
 */

import {spawn, type ChildProcess} from "node:child_process";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import type {BrowserContext} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const PACKAGE = join(import.meta.dirname, "..");
const CLI = join(PACKAGE, "src", "cli.ts");

export interface StoryServer {
    library: string;
    login: string;
    base: string;
    stop(signal?: NodeJS.Signals): Promise<number | null>;
}

export async function makeLibrary(name: string): Promise<{root: string; library: string; cleanup(): Promise<void>}> {
    const root = await createTestTmpRoot(`nb-story-e2e-${name}`, `nb-story e2e ${name}`);
    const library = join(root, "library");
    const file = join(root, "sample.json");
    await writeFile(file, gunzipSync(await readFile(join(PACKAGE, "tests", "fixtures", "sample-100ch.json.gz"))));
    const result = await runCli(["import", file, "--title", "转生反派萝莉，找茬魔法少女", "--id", "fox", "--library", library]);
    if (result.code !== 0) throw new Error(`导入样例书失败：${result.stderr}`);
    return {root, library, cleanup: () => rm(root, {recursive: true, force: true})};
}

export function runCli(args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> {
    return new Promise((resolve, reject) => {
        const child = spawn("bun", [CLI, ...args], {stdio: ["ignore", "pipe", "pipe"]});
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", code => resolve({code, stdout, stderr}));
    });
}

export async function startServe(library: string): Promise<StoryServer> {
    const child: ChildProcess = spawn("bun", [CLI, "serve", "--library", library], {stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    const login = await new Promise<string>((resolve, reject) => {
        child.stdout!.on("data", chunk => {
            output += chunk;
            const match = /http:\/\/\S+\/login\?token=\S+/u.exec(output);
            if (match) resolve(match[0]);
        });
        child.stderr!.on("data", chunk => (output += chunk));
        void exited.then(code => reject(new Error(`serve 提前退出（${code}）：${output}`)));
    });
    return {
        library,
        login,
        base: login.slice(0, login.indexOf("/login")),
        async stop(signal = "SIGTERM") {
            if (child.exitCode === null) child.kill(signal);
            return exited;
        },
    };
}

/** 在一个浏览器配置里登录（拿到会话 Cookie）。 */
export async function login(context: BrowserContext, server: StoryServer): Promise<void> {
    const page = await context.newPage();
    await page.goto(server.login);
    await page.close();
}

/** 读书库里存下的阅读状态（经已登录的配置调 RPC）。 */
export async function readingState(context: BrowserContext, server: StoryServer): Promise<{position: {chapter: number; paragraph?: number}; view: Record<string, unknown> | null}> {
    const response = await context.request.post(`${server.base}/api/rpc/reading.get`, {data: {book: "fox"}});
    return (await response.json()) as never;
}
