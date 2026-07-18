import {chmod, copyFile, mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {removePath} from "#manager/files";
import {sha256File} from "#manager/files";
import {installManagerExecutable, resolveManagerRuntime, writeManagerWrapper} from "#manager/runtime";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => removePath(root)));
});

describe("portable manager wrapper", () => {
    it("不写入 staging 绝对路径", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-wrapper-"));
        roots.push(root);
        const source = join(root, "manager-source.mjs");
        const bun = join(root, ".runtime", "bun", "1.0.0", process.platform === "win32" ? "bun.exe" : "bun");
        await mkdir(join(root, ".runtime", "bun", "1.0.0"), {recursive: true});
        await writeFile(source, "console.log('manager')\n", "utf8");
        await writeFile(bun, "bun", "utf8");

        const manager = await installManagerExecutable(root, "0.1.0", source);
        await writeManagerWrapper(root, manager, {
            provider: "managed",
            version: "1.0.0",
            path: bun.slice(root.length + 1).replaceAll("\\", "/"),
            archiveSha256: "a".repeat(64),
            executableSha256: "b".repeat(64),
            sourceUrl: "https://example.com/bun.zip",
            license: "MIT",
            redistribution: "test",
        });

        const wrapper = await readFile(join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book"), "utf8");
        expect(wrapper).not.toContain(root);
        expect(wrapper).toContain("manager/0.1.0/neuro-book.mjs".replaceAll("/", process.platform === "win32" ? "\\" : "/"));
    });

    it("校验并接管 Stage 0 Bun", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-stage0-"));
        roots.push(root);
        const source = join(root, process.platform === "win32" ? "cache-bun.exe" : "cache-bun");
        const version = process.versions.bun;
        if (!version) throw new Error("Stage 0测试必须由Bun执行。" );
        if (process.platform === "win32") {
            await copyFile(process.execPath, source);
        } else {
            await writeFile(source, `#!/bin/sh\nprintf '${version}\\n'\n`, "utf8");
            await chmod(source, 0o755);
        }
        const executableSha256 = await sha256File(source);
        const previous = {...process.env};
        process.env.NEURO_BOOK_STAGE0_BUN_PATH = source;
        process.env.NEURO_BOOK_STAGE0_BUN_VERSION = version;
        process.env.NEURO_BOOK_STAGE0_BUN_SOURCE_URL = "https://example.com/bun.zip";
        process.env.NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256 = "a".repeat(64);
        process.env.NEURO_BOOK_STAGE0_BUN_SHA256 = executableSha256;
        try {
            const runtime = await resolveManagerRuntime(root);
            expect(runtime.provider).toBe("managed");
            if (runtime.provider === "managed") expect(await sha256File(join(root, runtime.path))).toBe(executableSha256);
        } finally {
            process.env = previous;
        }
    });
});
