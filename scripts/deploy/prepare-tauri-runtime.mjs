#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAURI_RESOURCE_ROOT = join(REPO_ROOT, "src-tauri", "resources");
const PRODUCT_ROOT = join(REPO_ROOT, "product");
const PRODUCT_ARCHIVE_MANIFEST = join(TAURI_RESOURCE_ROOT, "product.zip.manifest");

await assertProductPayload();
await stageBunRuntime();
await stageCreateAdminCommand();
const productPayloadHash = await productArchivePayloadHash();
const buildMarker = await writeBuildMarker(productPayloadHash);
await stageProductArchive(productPayloadHash, buildMarker);

async function assertProductPayload() {
    const entry = join(PRODUCT_ROOT, ".output", "server", "scripts", "deploy", "product-start.mjs");
    if (!existsSync(entry)) {
        throw new Error(`缺少 Tauri product runtime: ${entry}。请先运行 bun run product:stage。`);
    }
}

async function stageBunRuntime() {
    const bunPath = await resolveBunExecutable();
    const target = join(TAURI_RESOURCE_ROOT, "runtime", "bun", "bun.exe");
    await mkdir(dirname(target), {recursive: true});
    await cp(bunPath, target);
}

async function stageCreateAdminCommand() {
    const target = join(TAURI_RESOURCE_ROOT, "create-admin.cmd");
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, [
        "@echo off",
        "setlocal",
        "chcp 65001 > nul",
        "set \"PRODUCT_ROOT=%~dp0data\\product\"",
        "set \"BUN=%~dp0runtime\\bun\\bun.exe\"",
        "if not exist \"%PRODUCT_ROOT%\\.output\\server\\scripts\\cli\\create-admin.ts\" (",
        "    set \"PRODUCT_ROOT=%APPDATA%\\com.notnotype.neurobook\\product\"",
        ")",
        "if not exist \"%BUN%\" (",
        "    echo Bundled Bun runtime not found: %BUN%",
        "    pause",
        "    exit /b 1",
        ")",
        "if not exist \"%PRODUCT_ROOT%\\.output\\server\\scripts\\cli\\create-admin.ts\" (",
        "    echo NeuroBook desktop runtime was not found: %PRODUCT_ROOT%",
        "    echo Start NeuroBook once before running this script.",
        "    pause",
        "    exit /b 1",
        ")",
        "cd /d \"%PRODUCT_ROOT%\"",
        "set \"DATABASE_KIND=sqlite\"",
        "set \"DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite\"",
        "\"%BUN%\" \".output/server/scripts/cli/create-admin.ts\" %*",
        "set \"EXIT_CODE=%ERRORLEVEL%\"",
        "echo.",
        "if \"%EXIT_CODE%\"==\"0\" (",
        "    echo Admin account has been created or updated.",
        ") else (",
        "    echo Failed to create admin account. Exit code: %EXIT_CODE%",
        ")",
        "pause",
        "exit /b %EXIT_CODE%",
        "",
    ].join("\r\n"), "utf8");
}

async function resolveBunExecutable() {
    if (process.execPath && process.execPath.toLowerCase().endsWith("bun.exe")) {
        return await realpath(process.execPath);
    }
    const command = process.platform === "win32" ? "where.exe" : "which";
    const proc = Bun.spawn([command, "bun"], {stdout: "pipe", stderr: "pipe"});
    const output = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
        throw new Error("未在 PATH 中找到 bun，无法准备 Tauri 内置 runtime。");
    }
    const first = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (!first) {
        throw new Error("where/which 未返回 bun 路径。");
    }
    return await realpath(first);
}

async function writeBuildMarker(productPayloadHash) {
    const packageJson = await Bun.file(join(REPO_ROOT, "package.json")).json();
    const marker = [
        `version=${packageJson.version ?? "0.0.0"}`,
        `productPayloadSha256=${productPayloadHash.trim()}`,
        "",
    ].join("\n");
    await writeFile(join(PRODUCT_ROOT, ".tauri-build-id"), marker, "utf8");
    await writeFile(join(TAURI_RESOURCE_ROOT, "product-build-id"), marker, "utf8");
    return marker;
}

async function stageProductArchive(productPayloadHash, buildMarker) {
    await mkdir(TAURI_RESOURCE_ROOT, {recursive: true});
    const outputPath = join(TAURI_RESOURCE_ROOT, "product.zip");
    const nextManifest = productArchiveManifest(productPayloadHash, buildMarker);
    const currentManifest = existsSync(PRODUCT_ARCHIVE_MANIFEST)
        ? await readFile(PRODUCT_ARCHIVE_MANIFEST, "utf8")
        : "";
    if (existsSync(outputPath) && currentManifest === nextManifest) {
        console.log("Tauri product archive unchanged, reuse existing resources/product.zip");
        return;
    }
    const zipFile = new yazl.ZipFile();
    await addDirectoryToZip(zipFile, PRODUCT_ROOT, PRODUCT_ROOT);
    zipFile.end();
    await new Promise((resolvePromise, rejectPromise) => {
        zipFile.outputStream
            .pipe(createWriteStream(outputPath))
            .on("close", resolvePromise)
            .on("error", rejectPromise);
    });
    await writeFile(PRODUCT_ARCHIVE_MANIFEST, nextManifest, "utf8");
}

async function addDirectoryToZip(zipFile, directory, baseDirectory) {
    const entries = [];
    for await (const entry of new Bun.Glob("**/*").scan({cwd: directory, dot: true, onlyFiles: true})) {
        entries.push(entry);
    }
    entries.sort();
    for (const entry of entries) {
        const source = join(directory, entry);
        const zipPath = source.slice(baseDirectory.length + 1).replaceAll("\\", "/");
        zipFile.addFile(source, zipPath);
    }
}

function productArchiveManifest(productPayloadHash, buildMarker) {
    const hash = createHash("sha256");
    hash.update("payload\0");
    hash.update(productPayloadHash);
    hash.update("marker\0");
    hash.update(buildMarker);
    return `${hash.digest("hex")}\n`;
}

async function productArchivePayloadHash() {
    const hash = createHash("sha256");
    const entries = [];
    for await (const entry of new Bun.Glob("**/*").scan({cwd: PRODUCT_ROOT, dot: true, onlyFiles: true})) {
        if (entry.replaceAll("\\", "/") === ".tauri-build-id") {
            continue;
        }
        entries.push(entry);
    }
    entries.sort();
    for (const entry of entries) {
        const source = join(PRODUCT_ROOT, entry);
        const info = await stat(source);
        hash.update(entry.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(String(info.size));
        hash.update("\0");
        await hashFile(hash, source);
        hash.update("\n");
    }
    return `${hash.digest("hex")}\n`;
}

async function hashFile(hash, filePath) {
    await new Promise((resolvePromise, rejectPromise) => {
        createReadStream(filePath)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", resolvePromise)
            .on("error", rejectPromise);
    });
}
