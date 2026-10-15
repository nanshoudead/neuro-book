/**
 * 书库：本机上存放书的目录，一本书一个子目录。行为见 docs/specs/story/queries.md 的“书库与导入”“状态与转换”
 * “副作用与数据”。
 *
 * 落盘：
 *   <书库>/library.json          {format}
 *   <书库>/<书 id>/book.json      BookMeta
 *   <书库>/<书 id>/graph.json     导入的数据文件原样
 *   <书库>/<书 id>/reading.json   ReadingState
 *
 * 并发与原子性都靠同一个文件系统内的 rename：
 * - 导入先写进 `.importing-<随机>/`，写完整个目录改名成 `<书 id>/`。目标已存在时改名失败，于是同一个 id 的并发
 *   导入只有一次成功；进程中途被杀只会留下临时目录，`books.list` 只列正式目录，看不到半本书。
 * - 删除先把目录改名成 `.removed-<随机>/`，再递归删。改名之后这个 id 立刻可以重新导入；已经开始的查询用的是
 *   内存里那一代的数据（book-index.ts），不再读盘。
 * - 阅读状态写到临时文件再改名覆盖，后改名的那次整份生效。
 * 书库放在不支持原子 rename 的文件系统上（某些网络盘）时这些保证不成立。
 */

import {randomUUID, createHash} from "node:crypto";
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

import {validateDataset} from "./dataset";
import type {Dataset, Position} from "./dataset";
import {StoryError, systemErrorCode} from "./errors";
import type {PositionInput} from "./position";

export const LIBRARY_FORMAT = 1;
/** 界面状态的上限（JSON 序列化后的字节数）。 */
export const MAX_VIEW_BYTES = 64 * 1024;
/** 超过这个时长的 `.importing-*` 视为中途退出留下的，下一次导入时清掉。 */
const STALE_IMPORT_MS = 60 * 60 * 1000;
const BOOK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export interface BookMeta {
    format: number;
    id: string;
    title: string;
    /** 这一代的代号：每次成功导入新生成，不复用。 */
    generation: string;
    importedAt: string;
    /** 数据集自带的书 id 与导入时的文件名，说明这本书从哪里来。 */
    source: {bookId: string; title: string; file: string};
    chapters: number;
    /** 各章的段数，按章号顺序。 */
    paragraphs: number[];
    extractedThrough: Position;
}

export interface ReadingState {
    position: PositionInput;
    /** 使用方定义的界面状态；从没存过时为 null。 */
    view: unknown;
    /** 写入时间（ISO 8601）；从没存过时为 null。 */
    savedAt: string | null;
}

/** 用户数据目录下的默认书库位置。 */
export function defaultLibraryRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "nbstory");
    if (platform === "darwin") return join(homedir(), "Library", "Application Support", "nbstory");
    return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "nbstory");
}

/**
 * 由书名得到书 id：书名里的英文字母与数字连成短横线写法；书名里没有时（中文书名）用书名摘要。
 * 同一书名总是得到同一个 id，所以“换书名”能得到新的 id。
 */
export function bookIdFromTitle(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48);
    return slug.length > 0 ? slug : `book-${createHash("sha256").update(title).digest("hex").slice(0, 8)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export class Library {
    readonly root: string;

    constructor(root: string = defaultLibraryRoot()) {
        this.root = root;
    }

    /** 可用的书，按书名排序。导入中的、已删除的不在里面。 */
    async listBooks(): Promise<BookMeta[]> {
        let entries;
        try {
            entries = await readdir(this.root, {withFileTypes: true});
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return [];
            throw error;
        }
        const books: BookMeta[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            const meta = await this.readMetaOrNull(entry.name);
            if (meta) books.push(meta);
        }
        return books.sort((a, b) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id));
    }

    /** 一本可用的书的信息；不存在、已删除或还在导入时报 `book_not_found`。 */
    async readMeta(id: string): Promise<BookMeta> {
        const meta = BOOK_ID_PATTERN.test(id) ? await this.readMetaOrNull(id) : null;
        if (!meta) throw new StoryError("book_not_found", `书库里没有书 ${id}`);
        return meta;
    }

    /** 调用方省略 `book` 时：书库只有一本书就取它，否则报 `book_ambiguous`（没有书时报 `book_not_found`）。 */
    async resolveBookId(book: string | undefined): Promise<string> {
        if (book !== undefined) return (await this.readMeta(book)).id;
        const books = await this.listBooks();
        if (books.length === 1) return books[0]!.id;
        if (books.length === 0) throw new StoryError("book_not_found", "书库里还没有书");
        throw new StoryError("book_ambiguous", `书库里有 ${books.length} 本书，请指定 book：${books.map(item => item.id).join("、")}`);
    }

    /** 读这一代的数据集。meta 必须来自同一次 readMeta：读到的 graph.json 已换代时报 `book_not_found`，调用方重试即可。 */
    async readDataset(meta: BookMeta): Promise<Dataset> {
        const dir = join(this.root, meta.id);
        let current: unknown;
        let dataset: unknown;
        try {
            [current, dataset] = await Promise.all([readJson(join(dir, "book.json")), readJson(join(dir, "graph.json"))]);
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw new StoryError("book_not_found", `书 ${meta.id} 已被删除`, {cause: error});
            throw error;
        }
        // book.json 与 graph.json 不是一次读出的：两次读之间这本书可能被删除并重新导入。核对代号，读到的不是同一代就当作已删除。
        if (!isObject(current) || current.generation !== meta.generation) throw new StoryError("book_not_found", `书 ${meta.id} 已换了一代`);
        return dataset as Dataset;
    }

    /** 导入 V9 数据集，成功后返回新书的 id 与这一代的代号。失败时书库不变。 */
    async importBook(input: {file: string; title: string; id?: string}): Promise<{id: string; generation: string}> {
        await this.assertWritable();
        const id = input.id ?? bookIdFromTitle(input.title);
        if (!BOOK_ID_PATTERN.test(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
        let bytes: Buffer;
        try {
            bytes = await readFile(input.file);
        } catch (error) {
            throw new StoryError("invalid_params", `读不了导入文件 ${input.file}`, {cause: error});
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch (error) {
            throw new StoryError("unsupported_format", "导入文件不是 JSON", {cause: error});
        }
        const problem = validateDataset(parsed);
        if (problem) throw new StoryError("unsupported_format", `导入文件不是 V9 记忆图：${problem}`);
        const dataset = parsed as Dataset;

        const generation = randomUUID();
        const meta: BookMeta = {
            format: LIBRARY_FORMAT,
            id,
            title: input.title,
            generation,
            importedAt: new Date().toISOString(),
            source: {bookId: dataset.book.id, title: dataset.book.title, file: input.file.split(/[\\/]/u).at(-1) ?? input.file},
            chapters: dataset.sources.length,
            paragraphs: [...dataset.sources].sort((a, b) => a.chapter - b.chapter).map(chapter => chapter.paragraphs.length),
            extractedThrough: dataset.through,
        };

        await mkdir(this.root, {recursive: true});
        await this.sweepStaleImports();
        const staging = join(this.root, `.importing-${generation}`);
        await mkdir(staging);
        try {
            await writeFile(join(staging, "graph.json"), bytes);
            await writeFile(join(staging, "book.json"), `${JSON.stringify(meta, null, 2)}\n`);
            await rename(staging, join(this.root, id));
        } catch (error) {
            await rm(staging, {recursive: true, force: true});
            const code = systemErrorCode(error);
            if (code === "ENOTEMPTY" || code === "EEXIST") {
                throw new StoryError("book_exists", `书 id ${id} 已被占用`, {cause: error});
            }
            throw error;
        }
        return {id, generation};
    }

    /** 删除一本书；之后同一 id 可以重新导入（得到新的一代）。 */
    async removeBook(id: string): Promise<void> {
        await this.assertWritable();
        await this.readMeta(id);
        const trash = join(this.root, `.removed-${randomUUID()}`);
        try {
            await rename(join(this.root, id), trash);
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw new StoryError("book_not_found", `书 ${id} 已被删除`, {cause: error});
            throw error;
        }
        await rm(trash, {recursive: true, force: true});
    }

    /** 这本书存的阅读状态；从没存过时是全书开头、界面状态为 null。 */
    async getReading(id: string): Promise<ReadingState> {
        await this.readMeta(id);
        try {
            const value = await readJson(join(this.root, id, "reading.json"));
            if (isObject(value) && isObject(value.position) && typeof value.savedAt === "string") return value as unknown as ReadingState;
            throw new Error("reading.json 结构不对");
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return {position: {chapter: 1}, view: null, savedAt: null};
            throw error;
        }
    }

    /**
     * 整份替换阅读状态；完成即已写进书库。位置已由调用方按这本书校验过。
     * 界面状态超过 MAX_VIEW_BYTES 时报 `state_too_large`。
     */
    async setReading(id: string, position: PositionInput, view: unknown): Promise<ReadingState> {
        await this.assertWritable();
        const meta = await this.readMeta(id);
        if (meta.format !== LIBRARY_FORMAT) throw new StoryError("unsupported_format", `书 ${id} 的格式版本 ${meta.format} 不认识，只能读`);
        const viewBytes = Buffer.byteLength(JSON.stringify(view ?? null), "utf8");
        if (viewBytes > MAX_VIEW_BYTES) throw new StoryError("state_too_large", `界面状态 ${viewBytes} 字节，超过上限 ${MAX_VIEW_BYTES}`);
        const state: ReadingState = {position, view: view ?? null, savedAt: new Date().toISOString()};
        const target = join(this.root, id, "reading.json");
        const temp = `${target}.${randomUUID()}.tmp`;
        try {
            await writeFile(temp, `${JSON.stringify(state)}\n`);
            await rename(temp, target);
        } catch (error) {
            await rm(temp, {force: true});
            if (systemErrorCode(error) === "ENOENT") throw new StoryError("book_not_found", `书 ${id} 已被删除`, {cause: error});
            throw error;
        }
        return state;
    }

    private async readMetaOrNull(id: string): Promise<BookMeta | null> {
        try {
            const value = await readJson(join(this.root, id, "book.json"));
            if (isObject(value) && value.id === id && typeof value.generation === "string") return value as unknown as BookMeta;
            return null;
        } catch (error) {
            const code = systemErrorCode(error);
            if (code === "ENOENT" || code === "ENOTDIR") return null;
            throw error;
        }
    }

    /** 书库格式版本不认识时只读：写入类方法报 `unsupported_format`。第一次写入时建 library.json。 */
    private async assertWritable(): Promise<void> {
        const path = join(this.root, "library.json");
        try {
            const value = await readJson(path);
            if (isObject(value) && value.format === LIBRARY_FORMAT) return;
            throw new StoryError("unsupported_format", `书库格式版本不认识（${path}），只能读`);
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT") throw error;
        }
        await mkdir(this.root, {recursive: true});
        await writeFile(path, `${JSON.stringify({format: LIBRARY_FORMAT})}\n`);
    }

    /** 清掉中途退出留下的临时目录；正在进行的导入不到 STALE_IMPORT_MS，不会被误删。 */
    private async sweepStaleImports(): Promise<void> {
        const now = Date.now();
        for (const entry of await readdir(this.root, {withFileTypes: true})) {
            if (!entry.isDirectory() || !(entry.name.startsWith(".importing-") || entry.name.startsWith(".removed-"))) continue;
            const path = join(this.root, entry.name);
            try {
                if (now - (await stat(path)).mtimeMs > STALE_IMPORT_MS) await rm(path, {recursive: true, force: true});
            } catch (error) {
                if (systemErrorCode(error) !== "ENOENT") throw error;
            }
        }
    }
}
