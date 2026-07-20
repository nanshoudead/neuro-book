import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Product start生命周期", () => {
    it.skipIf(process.platform === "win32")("SIGTERM会转发给Nitro子进程并在超时前退出", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-signal-"));
        roots.push(root);
        const deployRoot = join(root, ".output", "server", "scripts", "deploy");
        const buildRoot = join(root, ".output", "server", "scripts", "build");
        const marker = join(root, "server-signal.txt");
        const ready = join(root, "server-ready.txt");
        await Promise.all([mkdir(deployRoot, {recursive: true}), mkdir(buildRoot, {recursive: true})]);
        await Promise.all([
            writeFile(join(deployRoot, "product-start.mjs"), await readFile(join(process.cwd(), "scripts", "deploy", "product-start.mjs"), "utf8"), "utf8"),
            writeFile(join(buildRoot, "prepare-system-assets.ts"), "process.exit(0);\n", "utf8"),
            writeFile(join(root, ".output", "server", "index.mjs"), [
                'import {writeFileSync} from "node:fs";',
                `writeFileSync(${JSON.stringify(ready)}, "ready", "utf8");`,
                `process.on("SIGTERM", () => { writeFileSync(${JSON.stringify(marker)}, "SIGTERM", "utf8"); process.exit(0); });`,
                'setInterval(() => {}, 1_000);',
            ].join("\n"), "utf8"),
        ]);
        const launcher = spawn(process.execPath, [join(deployRoot, "product-start.mjs")], {
            cwd: root,
            env: {...process.env, NEURO_BOOK_STATE_ROOT: root},
            stdio: "ignore",
        });
        try {
            await waitFor(() => fileExists(ready));
            launcher.kill("SIGTERM");
            await waitFor(() => launcher.exitCode !== null || launcher.signalCode !== null);
            await expect(readFile(marker, "utf8")).resolves.toBe("SIGTERM");
            expect(launcher.exitCode).toBe(0);
        } finally {
            if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill("SIGKILL");
        }
    });
});

/** 在容器stop默认10秒窗口内等待进程状态变化。 */
async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    throw new Error("等待Product进程状态超时");
}

/** 同步确认测试子进程写出的ready标记。 */
function fileExists(path: string): boolean {
    try {
        readFileSync(path);
        return true;
    } catch {
        return false;
    }
}
