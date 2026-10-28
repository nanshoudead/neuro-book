/**
 * 修订文件的读写（docs/specs/story/revisions.md 的“副作用与数据”）：`<书目录>/revisions-<版本>.json`。
 *
 * 读：只认 `generation` 与这本书当前一代相同的文件，取其中版本最大且读得出来的一份；损坏的跳过、回退到更早的完整
 * 版本。同 id 换了一代后旧代遗留的文件因为代号不符不会被读到，所以写入进行中书被换代也污染不了新书。
 *
 * 写：读到当前版本 n，在它上面算出新内容，写成完整的临时文件，再用硬链接发布成 `revisions-<n+1>.json`。硬链接在目标
 * 已存在时失败，所以“只创建一次”是原子的、读者看不到半个文件；别的进程（命令行与独立服务）抢先发布了 n+1 就重读重算，
 * 并发写入不丢。成功后只删最近 `KEEP_VERSIONS` 个版本之外的旧文件：版本号不能马上空出来，否则读到 n 的写入者晚到时，
 * 会把已被回收的 n+1 当作空位再发布一次，覆盖掉别人的写入（跑起来真的会发生）。要撞上这个窗口，得有写入者读到版本之后
 * 停住、别的进程又连续成功写 `KEEP_VERSIONS` 次，这里认为不会出现。core 不能用 `bun:ffi` 的文件锁，
 * 这里是仓库里 `graph-<版本>.json` 同一类“按版本只创建一次”的做法。
 */

import {randomUUID} from "node:crypto";
import {link, readdir, readFile, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {StoryError, systemErrorCode} from "../errors";
import {OVERLAY_FORMAT, overlayProblems} from "./schema";
import type {OverlayFile} from "./schema";

const FILE_PATTERN = /^revisions-(\d+)\.json$/u;
const MAX_ATTEMPTS = 50;
/** 留最近这么多个版本。 */
const KEEP_VERSIONS = 50;

const fileName = (version: number): string => `revisions-${version}.json`;

async function versionsIn(dir: string): Promise<number[]> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
    return names.map(name => FILE_PATTERN.exec(name)).filter((match): match is RegExpExecArray => match !== null).map(match => Number(match[1])).sort((a, b) => b - a);
}

/** 读一个版本的文件；没有、读不出来、结构不对或不属于这一代时为 null。格式版本不认识的不当作坏文件，抛 `unsupported_format`。 */
async function readVersion(dir: string, version: number, generation: string): Promise<OverlayFile | null> {
    let value: unknown;
    try {
        value = JSON.parse(await readFile(join(dir, fileName(version)), "utf8"));
    } catch (error) {
        if (error instanceof SyntaxError || systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
    if (typeof value === "object" && value !== null && "format" in value && typeof value.format === "number" && value.format !== OVERLAY_FORMAT) {
        throw new StoryError("unsupported_format", `修订文件 ${fileName(version)} 的格式版本 ${value.format} 不认识`);
    }
    if (overlayProblems(value) !== null) return null;
    const file = value as OverlayFile;
    return file.generation === generation && file.version === version ? file : null;
}

/** 这一代当前的修订文件；没有时为 null（没有文件等于没有修订）。 */
export async function readOverlay(dir: string, generation: string): Promise<OverlayFile | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const versions = await versionsIn(dir);
        for (const version of versions) {
            const file = await readVersion(dir, version, generation);
            if (file) return file;
        }
        // 列目录之后文件被别的进程回收时，列出的版本都读不到：再列一次；确实一个都没有就是没有。
        if (versions.length === 0 || (await versionsIn(dir))[0] === versions[0]) return null;
    }
    return null;
}

export interface OverlayWrite<T> {
    items: OverlayFile["items"];
    result: T;
    /** 这次改动没有什么要写（例如同一个决定再做一次）：不发布新版本，原样返回当前文件。 */
    unchanged?: boolean;
}

/**
 * 在当前修订文件上做一次改动：`mutate` 拿到最新的文件，返回新的 `items` 与要交给调用方的结果；它可以抛 StoryError
 * 放弃这次写入。发布撞上别人的写入时用最新的文件重新调用 `mutate`，所以 `mutate` 要是纯的、可以重复调用。
 */
export async function writeOverlay<T>(dir: string, generation: string, mutate: (current: OverlayFile) => OverlayWrite<T>): Promise<{file: OverlayFile; result: T}> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = (await readOverlay(dir, generation)) ?? {format: OVERLAY_FORMAT, generation, version: 0, items: []};
        const written = mutate(current);
        if (written.unchanged) return {file: current, result: written.result};
        const next: OverlayFile = {format: OVERLAY_FORMAT, generation, version: current.version + 1, items: written.items};
        const target = join(dir, fileName(next.version));
        const temp = join(dir, `.revisions-${randomUUID()}.tmp`);
        try {
            await writeFile(temp, JSON.stringify(next, null, 2));
            await link(temp, target);
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw new StoryError("book_not_found", "书已被删除");
            if (systemErrorCode(error) !== "EEXIST") throw error;
            // 目标已存在：要么别的进程刚发布了同一个版本（重读再算），要么是别的一代遗留的同名文件（删掉它再写）。
            if ((await readVersion(dir, next.version, generation).catch(() => null)) === null) await unlink(target).catch(() => undefined);
            continue;
        } finally {
            await unlink(temp).catch(() => undefined);
        }
        for (const version of await versionsIn(dir)) if (version <= next.version - KEEP_VERSIONS) await unlink(join(dir, fileName(version))).catch(() => undefined);
        return {file: next, result: written.result};
    }
    throw new StoryError("revision_conflict", "修订文件一直被别的进程更新，这次没写成，请再试一次");
}
