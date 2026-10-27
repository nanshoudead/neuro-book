/**
 * 状态根的实例认领（docs/specs/runtime/server-host.md 的“实例认领”）：真实子进程各自认领同一状态根，观察谁认领到、
 * 后来者看到什么；暂停、崩溃后的行为用真实信号。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {claimStateRoot, instanceAddress, queryInstance} from "./instance";
import type {ClaimResult} from "./instance";

const CHILD = join(import.meta.dir, "testing", "claim-child.ts");

let tmpRoot = "";
let sequence = 0;

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("neuro-book-server", "instance");
});

afterAll(async () => {
    if (tmpRoot !== "") await rm(tmpRoot, {recursive: true, force: true});
});

function nextRoot(): string {
    sequence += 1;
    return join(tmpRoot, `state-${String(sequence)}`);
}

interface Claimer {
    readonly pid: number;
    /** 子进程写出的认领结果（`{ok: true}` 或失败的那一种）。 */
    readonly result: Promise<{readonly ok: true} | Exclude<ClaimResult, {ok: true}>>;
    readonly exited: Promise<number | null>;
    release(): void;
    kill(signal: NodeJS.Signals): void;
}

function claimer(stateRoot: string): Claimer {
    const child = Bun.spawn(["bun", CHILD, stateRoot], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    const result = (async () => {
        let out = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            out += chunk;
            const newline = out.indexOf("\n");
            if (newline >= 0) return JSON.parse(out.slice(0, newline)) as Awaited<Claimer["result"]>;
        }
        throw new Error("认领子进程没有写出结果就结束了");
    })();
    return {
        pid: child.pid,
        result,
        exited: child.exited,
        release: () => {
            child.stdin.write("release\n");
            child.stdin.flush();
        },
        kill: (signal) => child.kill(signal),
    };
}

describe("状态根的实例认领（真实子进程）", () => {
    it("第二个认领者拿到第一个的 pid 与 starting 状态；第一个放下后可以再认领", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        const second = claimer(root);
        expect(await second.result).toMatchObject({ok: false, reason: "running", instance: {schema: 1, pid: first.pid, status: "starting", kind: "fixture", url: null}});
        first.release();
        expect(await first.exited).toBe(0);
        const third = claimer(root);
        expect(await third.result).toEqual({ok: true});
        third.release();
        expect(await third.exited).toBe(0);
    }, 20_000);

    it("实例被暂停（SIGSTOP）时后来者报没有应答、不接管；恢复后实例照常应答", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        first.kill("SIGSTOP");
        try {
            const second = claimer(root);
            expect(await second.result).toMatchObject({ok: false, reason: "unresponsive"});
        } finally {
            first.kill("SIGCONT");
        }
        // 被暂停期间那次连接已被对方关闭，恢复后往它写会出错：实例不能因此崩溃。
        expect(await queryInstance(root)).toMatchObject({state: "running", instance: {pid: first.pid}});
        first.release();
        expect(await first.exited).toBe(0);
    }, 20_000);

    it("实例被 SIGKILL 后，残留的套接字文件不挡下一次认领", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        first.kill("SIGKILL");
        await first.exited;
        expect(await stat(await instanceAddress(root)).then(() => "left", () => "gone")).toBe("left");
        expect(await queryInstance(root)).toEqual({state: "none"});
        const second = claimer(root);
        expect(await second.result).toEqual({ok: true});
        second.release();
        expect(await second.exited).toBe(0);
    }, 20_000);

    it("几个进程同时认领同一状态根：恰好一个认领到，其余都看到它", async () => {
        const root = nextRoot();
        const all = Array.from({length: 4}, () => claimer(root));
        const results = await Promise.all(all.map((one) => one.result));
        const winners = all.filter((_, index) => results[index]?.ok === true);
        expect(winners).toHaveLength(1);
        for (const result of results) {
            if (!result.ok) expect(result).toMatchObject({reason: "running", instance: {pid: winners[0]?.pid}});
        }
        winners[0]?.release();
        await Promise.all(all.map((one) => one.exited));
    }, 20_000);
});

describe("状态根的实例认领（同进程）", () => {
    it("就绪后应答带地址与插件集合，停止中改报 stopping；放下后删掉套接字文件", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "product", version: "9.9.9", report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: [{id: "acme.focus", version: "1.0.0", state: "enabled", notLoaded: null}]}});
        expect(await queryInstance(root)).toEqual({
            state: "running",
            instance: {schema: 1, pid: process.pid, version: "9.9.9", kind: "product", status: "ready", url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: [{id: "acme.focus", version: "1.0.0", state: "enabled", notLoaded: null}]}},
        });
        claimed.claim.stopping();
        expect(await queryInstance(root)).toMatchObject({state: "running", instance: {status: "stopping"}});
        const address = await instanceAddress(root);
        await claimed.claim.release();
        expect(await stat(address).then(() => "left", () => "gone")).toBe("gone");
        expect(await queryInstance(root)).toEqual({state: "none"});
    });

    it("开发会话的后端不应答页面地址（页面在 Vite 那边）", async () => {
        const root = nextRoot();
        const claimed = await claimStateRoot({stateRoot: root, kind: "development", version: "9.9.9", report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", plugins: {safeMode: false, items: []}});
        expect(await queryInstance(root)).toMatchObject({state: "running", instance: {kind: "development", url: null, rpcUrl: "ws://127.0.0.1:2/"}});
        await claimed.claim.release();
    });

    it("状态根路径太长时套接字放进运行时目录，按状态根真实路径命名", async () => {
        const root = join(tmpRoot, "x".repeat(60), "y".repeat(60), "state");
        const claimed = await claimStateRoot({stateRoot: root, kind: "fixture", version: "9.9.9", report: () => undefined});
        if (!claimed.ok) throw new Error(claimed.reason);
        const address = await instanceAddress(root);
        expect(address.startsWith(root)).toBe(false);
        expect(address).toMatch(/nbook-[0-9a-f]{16}\.sock$/u);
        expect(await queryInstance(root)).toMatchObject({state: "running"});
        await claimed.claim.release();
        expect(await stat(address).then(() => "left", () => "gone")).toBe("gone");
    });

    it("状态根不存在时查询报没有实例、不建目录；认领时建出来", async () => {
        const root = nextRoot();
        expect(await queryInstance(root)).toEqual({state: "none"});
        expect(await stat(root).then(() => "exists", () => "missing")).toBe("missing");
        const claimed = await claimStateRoot({stateRoot: root, kind: "fixture", version: "9.9.9", report: () => undefined});
        expect(claimed.ok).toBe(true);
        if (claimed.ok) await claimed.claim.release();
    });

    it("状态根不可写：报 unwritable", async () => {
        const root = nextRoot();
        await mkdir(root, {recursive: true});
        await chmod(root, 0o555);
        try {
            expect(await claimStateRoot({stateRoot: root, kind: "fixture", version: "9.9.9", report: () => undefined})).toMatchObject({ok: false, reason: "unwritable"});
        } finally {
            await chmod(root, 0o755);
        }
    });
});
