#!/usr/bin/env bun
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";

import {sha256File} from "nbook/packages/neuro-book-manager/src/files";
import {run} from "nbook/scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dir, "..", "..");
const PACKAGE_ROOT = resolve(ROOT, "packages", "neuro-book-manager");
const packageJson = await Bun.file(resolve(PACKAGE_ROOT, "package.json")).json() as {name: string; version: string};
const temporaryRoot = await mkdtemp(join(tmpdir(), "neuro-book-public-manager-"));

try {
    await run("bun", ["run", "manager:build"], {cwd: ROOT});
    const metadataResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/${encodeURIComponent(packageJson.version)}`);
    if (!metadataResponse.ok) throw new Error(`npm registry中不存在${packageJson.name}@${packageJson.version}：HTTP ${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as {dist?: {tarball?: string}};
    if (!metadata.dist?.tarball) throw new Error(`npm registry元数据缺少${packageJson.name}@${packageJson.version} tarball。`);
    const tarballResponse = await fetch(metadata.dist.tarball);
    if (!tarballResponse.ok) throw new Error(`下载Manager公开tarball失败：HTTP ${tarballResponse.status}`);
    const archive = resolve(temporaryRoot, "public-manager.tgz");
    await writeFile(archive, new Uint8Array(await tarballResponse.arrayBuffer()));
    await run("tar", ["-xzf", archive, "-C", temporaryRoot], {cwd: ROOT});

    const localRoot = resolve(PACKAGE_ROOT, "dist");
    const publicRoot = resolve(temporaryRoot, "package", "dist");
    const localFiles = await files(localRoot);
    const publicFiles = await files(publicRoot);
    if (JSON.stringify(localFiles) !== JSON.stringify(publicFiles)) {
        throw new Error(`Manager ${packageJson.version}本地与npm bundle文件集合不一致。\nlocal: ${localFiles.join(", ")}\npublic: ${publicFiles.join(", ")}`);
    }
    for (const file of localFiles) {
        const localHash = await comparableHash(resolve(localRoot, file), file);
        const publicHash = await comparableHash(resolve(publicRoot, file), file);
        if (localHash !== publicHash) {
            throw new Error(`Manager ${packageJson.version} bundle与npm公开版本不一致：${file}`);
        }
    }
    console.log(`Manager ${packageJson.version} bundle与npm公开版本一致。`);
} finally {
    await rm(temporaryRoot, {recursive: true, force: true});
}

/** LICENSE允许Git在Windows checkout中转换换行；可执行bundle仍按原始字节比较。 */
async function comparableHash(path: string, relativePath: string): Promise<string> {
    if (relativePath !== "LICENSE") return sha256File(path);
    const normalized = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    return new Bun.CryptoHasher("sha256").update(normalized).digest("hex");
}

/** 返回目录中的相对文件清单，用于比较bundle边界。 */
async function files(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile()) result.push(relative(root, path).replaceAll("\\", "/"));
        }
    };
    await visit(root);
    return result.sort();
}
