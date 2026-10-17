/**
 * 安装时的复制范围（docs/specs/runtime/plugin-install.md 的“输入与前置条件”）。
 *
 * 有 `files` 时按 npm 的规则：每项是相对插件文件夹的 glob，命中目录时递归包含整个目录，`!` 开头的项排除；总是包含
 * `package.json`。没有 `files` 时复制整个文件夹。两种情况都排除 `node_modules` 与 `.git`（npm 同样总是排除它们）。
 *
 * 复制范围内的任何路径，包括路径中间的目录，是符号链接时拒绝：逐段 `lstat`。范围外的链接不影响安装。复制前对每个
 * 文件再核对一次它仍是普通文件、真实路径仍在源文件夹内，缩小检查与复制之间被替换的窗口。
 */

import {constants} from "node:fs";
import {copyFile, lstat, mkdir, readdir, realpath} from "node:fs/promises";
import {dirname, join, sep} from "node:path";

import {errno} from "nbook/backend/locked-replace";

import {brief} from "./record";

const ALWAYS_EXCLUDED = new Set(["node_modules", ".git"]);
const GLOB_CHARACTERS = /[*?[\]{}]/u;

export type RangeFailure = {readonly ok: false; readonly code: "path-rejected" | "copy-failed"; readonly detail: string};
export type RangeResult = {readonly ok: true; readonly files: ReadonlyArray<string>} | RangeFailure;

class Rejected extends Error {
    constructor(readonly code: RangeFailure["code"], detail: string) {
        super(detail);
    }
}

function rejectedPath(path: string): Rejected {
    return new Rejected("path-rejected", `复制范围内的路径是符号链接：${path}`);
}

/** `files` 的一项写成源文件夹内的相对 glob；越出源文件夹的写法拒绝。 */
function normalizeItem(item: string): string {
    let path = item.trim();
    while (path.startsWith("./")) path = path.slice(2);
    while (path.endsWith("/")) path = path.slice(0, -1);
    const segments = path.split("/");
    if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0") || segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
        throw new Rejected("path-rejected", `files 里的项必须是相对插件文件夹、不越出它的路径：${item}`);
    }
    return path;
}

function excluded(path: string): boolean {
    return path.split("/").some((segment) => ALWAYS_EXCLUDED.has(segment));
}

/** 逐段核对 `path` 的每个祖先与它自己都不是符号链接；不存在时返回 null。 */
async function plainKind(source: string, path: string): Promise<"file" | "directory" | "other" | null> {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
        const prefix = segments.slice(0, index).join("/");
        let info;
        try {
            info = await lstat(join(source, prefix));
        } catch (error) {
            if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return null;
            throw error;
        }
        if (info.isSymbolicLink()) throw rejectedPath(prefix);
        if (index === segments.length) return info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
    }
    return null;
}

/** 递归收集目录下的普通文件；遇到符号链接拒绝。 */
async function walk(source: string, prefix: string, into: Set<string>): Promise<void> {
    const entries = await readdir(prefix === "" ? source : join(source, prefix), {withFileTypes: true});
    for (const entry of entries) {
        if (ALWAYS_EXCLUDED.has(entry.name)) continue;
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) throw rejectedPath(path);
        if (entry.isDirectory()) await walk(source, path, into);
        else if (entry.isFile()) into.add(path);
    }
}

async function include(source: string, path: string, into: Set<string>): Promise<void> {
    if (excluded(path)) return;
    const kind = await plainKind(source, path);
    if (kind === "directory") await walk(source, path, into);
    else if (kind === "file") into.add(path);
}

/** 按 `files`（没有时为 null）算出要复制的普通文件，相对源文件夹、按码元排序。`source` 必须已是真实路径。 */
export async function collectCopyRange(source: string, files: ReadonlyArray<string> | null): Promise<RangeResult> {
    const collected = new Set<string>();
    try {
        await include(source, "package.json", collected);
        if (files === null) {
            await walk(source, "", collected);
        } else {
            const negations: Bun.Glob[] = [];
            for (const raw of files) {
                const negated = raw.trim().startsWith("!");
                const item = normalizeItem(negated ? raw.trim().slice(1) : raw);
                if (negated) {
                    negations.push(new Bun.Glob(item));
                } else if (GLOB_CHARACTERS.test(item)) {
                    for await (const match of new Bun.Glob(item).scan({cwd: source, dot: true, onlyFiles: false, followSymlinks: false})) {
                        await include(source, match.split(sep).join("/"), collected);
                    }
                } else {
                    // 不含通配的项直接逐段核对：glob 扫描不跟随符号链接，中间目录是链接时会静默地什么也匹配不到。
                    await include(source, item, collected);
                }
            }
            // 排除项命中文件本身或它的某个祖先目录；`package.json` 总是包含。
            for (const path of [...collected]) {
                if (path === "package.json") continue;
                const segments = path.split("/");
                const hit = negations.some((glob) => segments.some((_, index) => glob.match(segments.slice(0, index + 1).join("/"))));
                if (hit) collected.delete(path);
            }
        }
    } catch (error) {
        if (error instanceof Rejected) return {ok: false, code: error.code, detail: error.message};
        return {ok: false, code: "copy-failed", detail: `读取插件文件夹失败：${brief(error)}`};
    }
    return {ok: true, files: [...collected].sort()};
}

/** 把收集到的文件复制进 `target`（已存在的空目录）。失败时调用方删除整个 `target`。 */
export async function copyRange(source: string, target: string, files: ReadonlyArray<string>): Promise<{readonly ok: true} | RangeFailure> {
    for (const path of files) {
        const from = join(source, path);
        try {
            const kind = await plainKind(source, path);
            if (kind !== "file") return {ok: false, code: "copy-failed", detail: `复制期间文件被移走或换成了别的东西：${path}`};
            const real = await realpath(from);
            if (!real.startsWith(`${source}${sep}`)) throw rejectedPath(path);
            const to = join(target, path);
            await mkdir(dirname(to), {recursive: true});
            await copyFile(from, to, constants.COPYFILE_EXCL);
        } catch (error) {
            if (error instanceof Rejected) return {ok: false, code: error.code, detail: error.message};
            return {ok: false, code: "copy-failed", detail: `复制 ${path} 失败：${brief(error)}`};
        }
    }
    return {ok: true};
}
