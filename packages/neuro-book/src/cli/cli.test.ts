/**
 * `nbook` 命令行（docs/specs/runtime/cli.md）：在测试里把 `src/cli/main.ts` 与项目宿主构建到临时目录（与 `build:server`
 * 同样的布局），用真实进程运行打包产物。Web 根给一个只有 `index.html` 的目录；主目录、XDG 与 SSH 环境都换成测试自己的，
 * 不碰真实的数据目录；`PATH` 前面放一个记下参数的假 `xdg-open`，观察“打开浏览器”。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {claimStateRoot, queryInstance} from "nbook/server/instance";
import {PRODUCT_VERSION} from "nbook/shared/product";

const PACKAGE_ROOT = resolve(import.meta.dir, "..", "..");

let tmp = "";
let nbook = "";
let web = "";
let fakeBin = "";
let opened = "";
let sequence = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-cli", "nbook");
    const server = join(tmp, "app", "server");
    for (const [entry, out] of [["src/cli/main.ts", "nbook.js"], ["src/project/main.ts", "project.js"]] as const) {
        const built = Bun.spawnSync(["bun", "build", entry, "--target", "bun", "--outfile", join(server, out)], {cwd: PACKAGE_ROOT, stderr: "pipe"});
        if (built.exitCode !== 0) throw new Error(`构建 ${entry} 失败：${built.stderr.toString()}`);
    }
    nbook = join(server, "nbook.js");
    web = join(tmp, "web");
    await mkdir(web, {recursive: true});
    await writeFile(join(web, "index.html"), "<!doctype html><title>nbook test</title>");
    fakeBin = join(tmp, "bin");
    opened = join(tmp, "opened.txt");
    await mkdir(fakeBin, {recursive: true});
    await writeFile(join(fakeBin, "xdg-open"), `#!/bin/sh\necho "$1" >> ${JSON.stringify(opened)}\n`);
    await chmod(join(fakeBin, "xdg-open"), 0o755);
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function nextRoot(): string {
    sequence += 1;
    return join(tmp, `state-${String(sequence)}`);
}

/** 测试进程的环境：去掉会改变行为的外部变量，主目录换成临时目录，有一个假的图形会话。 */
function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
    const env: Record<string, string | undefined> = {...process.env};
    for (const name of Object.keys(env)) {
        if (name.startsWith("NBOOK_") || name.startsWith("SSH_") || name === "XDG_DATA_HOME" || name === "NEURO_BOOK_SAFE_MODE") delete env[name];
    }
    Object.assign(env, {HOME: join(tmp, "home"), PATH: `${fakeBin}:${process.env.PATH ?? ""}`, DISPLAY: ":99", NBOOK_WEB_ROOT: web}, extra);
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

interface Run {
    readonly pid: number;
    /** 标准输出的第一行 JSON（`--json` 时的结果）。 */
    readonly result: Promise<Record<string, unknown>>;
    readonly exit: Promise<number | null>;
    readonly stderr: () => string;
    signal(name: NodeJS.Signals): void;
}

function run(args: readonly string[], env: Record<string, string | undefined> = {}): Run {
    const child = Bun.spawn(["bun", nbook, ...args], {env: cleanEnv(env), stdout: "pipe", stderr: "pipe"});
    let stderr = "";
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    const result = (async () => {
        let out = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            out += chunk;
            const newline = out.indexOf("\n");
            if (newline >= 0) return JSON.parse(out.slice(0, newline)) as Record<string, unknown>;
        }
        throw new Error(`nbook 没有写出结果；stderr：${stderr}`);
    })();
    result.catch(() => undefined);
    return {pid: child.pid, result, exit: child.exited, stderr: () => stderr, signal: (name) => child.kill(name)};
}

async function openedUrls(): Promise<string[]> {
    return (await readFile(opened, "utf8").catch(() => "")).split("\n").filter(Boolean);
}

describe("nbook start（真实进程）", () => {
    it("启动后报告地址并打开浏览器；再运行一次得到同一个实例并再打开它；SIGHUP 有序停止，放下状态根", async () => {
        const root = nextRoot();
        const first = run(["start", "--state-root", root, "--port", "0", "--json"]);
        const started = await first.result;
        expect(started).toMatchObject({ok: true, started: true, pid: first.pid, version: PRODUCT_VERSION, stateRoot: root});
        const url = started.url as string;
        expect((await fetch(`${url}api/runtime/health`)).status).toBe(200);
        expect(await (await fetch(url)).text()).toContain("nbook test");
        expect(await waitUntil("打开了浏览器", async () => ((await openedUrls()).includes(url) ? true : undefined))).toBe(true);

        // 不给子命令等于 start；选项写在前面也行。
        const second = run(["--state-root", root, "--json", "--port", "4999"]);
        expect(await second.result).toMatchObject({ok: true, started: false, pid: first.pid, url});
        expect(await second.exit).toBe(0);
        expect(second.stderr()).toContain("忽略 --port");
        expect((await openedUrls()).filter((opened) => opened === url)).toHaveLength(2);

        first.signal("SIGHUP");
        expect(await first.exit).toBe(0);
        expect(await queryInstance(root)).toEqual({state: "none"});
    }, 30_000);

    it("--no-open 不打开；SSH 会话里不打开，提示端口转发；Ctrl-C（SIGINT）以 0 退出", async () => {
        for (const [args, env] of [[["--no-open"], {}], [[], {SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22"}]] as const) {
            const root = nextRoot();
            const before = (await openedUrls()).length;
            const server = run(["start", "--state-root", root, "--port", "0", "--json", ...args], env);
            const started = await server.result;
            expect(started).toMatchObject({ok: true, started: true});
            if ("SSH_CONNECTION" in env) expect(await waitUntil("提示了端口转发", () => (server.stderr().includes("ssh -L") ? true : undefined))).toBe(true);
            server.signal("SIGINT");
            expect(await server.exit).toBe(0);
            expect((await openedUrls()).length).toBe(before);
        }
    }, 30_000);

    it("没给状态根时用主目录下的平台数据目录", async () => {
        const server = run(["--json", "--no-open", "--port", "0"]);
        const started = await server.result;
        expect(started).toMatchObject({ok: true, stateRoot: join(tmp, "home", ".local", "share", "neuro-book")});
        expect((await stat(started.stateRoot as string)).isDirectory()).toBe(true);
        server.signal("SIGTERM");
        expect(await server.exit).toBe(0);
    }, 30_000);
});

describe("nbook start 遇到已有实例", () => {
    it("还在启动：等它就绪后报告它（started 为 false）", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            const waiting = run(["start", "--state-root", root, "--json", "--no-open"]);
            await waitUntil("nbook 看到实例在启动、开始等", () => (waiting.stderr().includes("等它就绪") ? true : undefined));
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            expect(await waiting.result).toMatchObject({ok: true, started: false, pid: process.pid, url: "http://127.0.0.1:1/"});
            expect(await waiting.exit).toBe(0);
        } finally {
            await claimed.claim.release();
        }
    }, 30_000);

    it("正在停止：等它停完，自己认领并启动", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        claimed.claim.stopping();
        const next = run(["start", "--state-root", root, "--json", "--no-open", "--port", "0"]);
        await waitUntil("nbook 看到实例在停止、开始等", () => (next.stderr().includes("等它停完") ? true : undefined));
        await claimed.claim.release();
        expect(await next.result).toMatchObject({ok: true, started: true, pid: next.pid});
        next.signal("SIGTERM");
        expect(await next.exit).toBe(0);
    }, 30_000);

    it("版本不同：以 1 退出，码 version-mismatch，说明两个版本", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: "9.9.9", report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            const attempt = run(["--state-root", root, "--json"]);
            expect(await attempt.result).toMatchObject({ok: false, code: "version-mismatch", running: "9.9.9", installed: PRODUCT_VERSION, pid: process.pid});
            expect(await attempt.exit).toBe(1);
        } finally {
            await claimed.claim.release();
        }
    });

    it("开发服务占着：以 1 退出，码 development-instance", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "development", version: PRODUCT_VERSION, report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        try {
            claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
            const attempt = run(["--state-root", root, "--json"]);
            expect(await attempt.result).toMatchObject({ok: false, code: "development-instance"});
            expect(await attempt.exit).toBe(1);
        } finally {
            await claimed.claim.release();
        }
    });
});

describe("用法", () => {
    it("拼错的命令、不认识的选项、不合法的端口：以 2 退出，带码 usage；--version 与 --help 以 0 退出", async () => {
        for (const args of [["strat"], ["--bogus"], ["start", "--port", "70000"]]) {
            const attempt = run(["--json", ...args]);
            expect(await attempt.result).toMatchObject({ok: false, code: "usage"});
            expect(await attempt.exit).toBe(2);
        }
        const typo = run(["strat"]);
        expect(await typo.exit).toBe(2);
        expect(typo.stderr()).toContain("不认识的命令 strat");
        const version = Bun.spawnSync(["bun", nbook, "--version"], {env: cleanEnv()});
        expect(version.exitCode).toBe(0);
        expect(version.stdout.toString()).toContain(`NeuroBook ${PRODUCT_VERSION}`);
        const help = Bun.spawnSync(["bun", nbook, "--help"], {env: cleanEnv()});
        expect(help.exitCode).toBe(0);
        expect(help.stdout.toString()).toContain("用法：");
    }, 30_000);
});
