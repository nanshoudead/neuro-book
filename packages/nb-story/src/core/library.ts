/**
 * 书库：本机上存放书的目录，一本书一个子目录。行为见 docs/specs/story/queries.md 的“书库与导入”“状态与转换”
 * “副作用与数据”。
 *
 * 落盘：
 *   <书库>/library.json                 {format}
 *   <书库>/<书 id>/book.json             BookMeta：这一代的代号、数据版本与它指向的数据文件
 *   <书库>/<书 id>/graph.json            导入的数据文件原样（导入的书；版本 1）
 *   <书库>/<书 id>/graph-<版本>.json      抽取得来的书每次提交的数据（docs/specs/story/ingest.md 输出 6）
 *   <书库>/<书 id>/extraction-<版本>.json 抽取得来的书每次提交的已提交草稿与整理结果（内容归 src/ingest/ 管）
 *   <书库>/<书 id>/reading.json          ReadingState
 *   <书库>/<书 id>/qa/                   问答记录（qa-records.ts）
 *   <书库>/.ingest/<书 id>/              抽取记录：原文、用量、瞬时状态（src/ingest/store.ts）；有它即占用这个 id
 *
 * 并发与原子性都靠同一个文件系统内的 rename：
 * - 导入先写进 `.importing-<随机>/`，写完整个目录改名成 `<书 id>/`。目标已存在时改名失败，于是同一个 id 的并发
 *   导入只有一次成功；进程中途被杀只留下临时目录，`books.list` 只列正式目录，看不到半本书。中途退出留下的临时
 *   目录不自动清：判断不了它的主人是否还活着，留着只占磁盘，不影响任何查询。抽取占用 id 也是整个目录改名
 *   （`.ingest/<书 id>/`）；导入与抽取各自改名成功后再看一眼对方，看到了就退回，两边同时发生时至少一边退回。
 * - 书目录里只有 `book.json` 与数据文件会变：抽取每提交一章，先写新版本的数据文件，再把 `book.json` 改名替换成
 *   指向它的一份（这一下就是提交），最后删旧版本的数据文件。导入的书只有版本 1，不再变。
 * - 删除先把目录改名成 `.removed-<随机>/`，再递归删。改名之后这个 id 立刻可以重新导入。
 * - 一次查询开始时用 pinBook 固定一代与版本（见它的注释），之后提交、删除、重新导入都不影响已打开的文件。
 * - 阅读状态写到临时文件再改名覆盖：改名的那一刻就是“写进书库”的时刻，后改名的整份生效，读到的总是某一次
 *   完整的写入。
 * 书库放在不支持原子 rename 的文件系统上（某些网络盘）时这些保证不成立。
 */

import {randomUUID, createHash} from "node:crypto";
import {mkdir, open, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

import {validateDataset} from "./dataset";
import type {Dataset, Position} from "./dataset";
import {StoryError, systemErrorCode} from "./errors";
import type {PositionInput} from "./position";

export const LIBRARY_FORMAT = 1;
/** 界面状态的上限（JSON 序列化后的字节数）。 */
export const MAX_VIEW_BYTES = 64 * 1024;
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
    /** 数据版本：导入的书为 1；抽取得来的书每提交一章加 1。格式 1 的旧书没有这一项，读时补成 1。 */
    revision: number;
    /** 这个版本的数据文件名（书目录里）。格式 1 的旧书没有这一项，读时补成 `graph.json`。 */
    graph: string;
    /** 抽取得来的书：提交到第几章，与这次提交的抽取数据文件名。 */
    extraction?: {through: number; file: string};
}

/** 抽取的一次提交（docs/specs/story/ingest.md 输出 6）。 */
export interface ExtractionCommit {
    id: string;
    title: string;
    /** 已有书的这一代；第 1 章（还没有书）时不给。书已被删除或换了一代时提交失败（`book_not_found`）。 */
    generation?: string;
    dataset: Dataset;
    through: number;
    /** 抽取数据（已提交的草稿与整理结果），原样写进书目录。 */
    extraction: string;
}

/**
 * 删除前的检查：别的进程正在抽这个 id 时返回 null（删除报 `ingest_running`）；否则返回放行的凭据，删完调用。
 * 核心库只用 Node 的 API，判断“有没有进程在抽”要用 flock，由命令行与独立服务注入（src/ingest/lock.ts）。
 */
export type RemoveGuard = (id: string) => Promise<{release(): Promise<void>} | null>;

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
    readonly #removeGuard: RemoveGuard | undefined;

    constructor(root: string = defaultLibraryRoot(), options: {removeGuard?: RemoveGuard} = {}) {
        this.root = root;
        this.#removeGuard = options.removeGuard;
    }

    /** 这个 id 的抽取记录目录（不检查存在）。 */
    ingestDir(id: string): string {
        return join(this.root, ".ingest", id);
    }

    /** 书目录的路径（不检查存在）。 */
    bookDir(id: string): string {
        return join(this.root, id);
    }

    /**
     * 给书目录里的附加数据（问答记录）用的写门禁：书库与这本书的格式都认识、书还在且仍是 `generation` 这一代时返回
     * 书目录；否则报 `unsupported_format` 或 `book_not_found`。通过之后书仍可能被删除，调用方的写入要能承受书目录
     * 随时被改名移走（按路径写会失败，不会重新造出书目录）。
     */
    async writableBook(id: string, generation: string): Promise<string> {
        await this.assertWritable();
        const meta = await this.readMeta(id);
        assertBookFormat(meta);
        if (meta.generation !== generation) throw new StoryError("book_not_found", `书 ${id} 已换了一代`);
        return this.bookDir(id);
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

    /**
     * 固定这本书当前的一代与数据版本：返回它的信息与已打开的数据文件。之后提交新版本、删除或同 id 重新导入，已
     * 打开的文件照样读得到固定时的数据（文件被删只是去掉了名字）。调用方读完或不再需要时 release。
     *
     * 顺序是先读 book.json、再打开它指向的数据文件、再读一次 book.json：两次读到同一代同一版本，说明打开的文件就是
     * 这个版本的（数据文件按版本命名、写好后不再改）。打开失败（读到旧版本之后、打开之前，提交把旧文件回收了）或
     * 两次不一样，就关掉重来，这次查询从新的版本开始。
     */
    async pinBook(id: string): Promise<PinnedBook> {
        if (!BOOK_ID_PATTERN.test(id)) throw new StoryError("book_not_found", `书库里没有书 ${id}`);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const before = await this.readMetaOrNull(id);
            if (!before) throw new StoryError("book_not_found", `书库里没有书 ${id}`);
            let handle: FileHandle;
            try {
                handle = await open(join(this.root, id, before.graph), "r");
            } catch (error) {
                if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") continue;
                throw error;
            }
            try {
                const after = await this.readMetaOrNull(id);
                if (after && after.generation === before.generation && after.revision === before.revision) return new PinnedBook(after, handle);
            } catch (error) {
                await handle.close();
                throw error;
            }
            await handle.close();
        }
        // 连续几次都碰上换代或新版本，几乎只会是有进程在不停地删除与导入同一本书。
        throw new StoryError("book_not_found", `书 ${id} 正在被反复删除与导入，没能固定一代`);
    }

    /** 导入 V9 数据集，成功后返回新书的 id 与这一代的代号。失败时书库不变。 */
    async importBook(input: {file: string; title: string; id?: string}): Promise<{id: string; generation: string}> {
        await this.assertWritable();
        const id = input.id ?? bookIdFromTitle(input.title);
        if (!BOOK_ID_PATTERN.test(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
        if (await this.hasIngest(id)) throw new StoryError("book_exists", `书 id ${id} 已被抽取占用`);
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
            revision: 1,
            graph: "graph.json",
        };

        await this.publishNewBook(id, generation, meta, [["graph.json", bytes]]);
        return {id, generation};
    }

    /**
     * 抽取的一次提交（docs/specs/story/ingest.md 输出 6）：第 1 章时建书目录（新的一代），之后写新版本的数据与抽取数据，
     * 再改名替换 book.json。调用方持有这个 id 的抽取锁，同一本书同时只有它在提交。
     */
    async commitExtraction(commit: ExtractionCommit): Promise<{generation: string; revision: number}> {
        await this.assertWritable();
        const dataBytes = Buffer.from(JSON.stringify(commit.dataset));
        const extractedThrough = commit.dataset.through;
        const shape = {
            chapters: commit.dataset.sources.length,
            paragraphs: [...commit.dataset.sources].sort((a, b) => a.chapter - b.chapter).map(chapter => chapter.paragraphs.length),
            extractedThrough,
        };
        if (commit.generation === undefined) {
            const generation = randomUUID();
            const meta: BookMeta = {
                format: LIBRARY_FORMAT, id: commit.id, title: commit.title, generation, importedAt: new Date().toISOString(),
                source: {bookId: commit.dataset.book.id, title: commit.dataset.book.title, file: "（抽取）"},
                ...shape, revision: 1, graph: "graph-1.json", extraction: {through: commit.through, file: "extraction-1.json"},
            };
            await this.publishNewBook(commit.id, generation, meta, [["graph-1.json", dataBytes], ["extraction-1.json", Buffer.from(commit.extraction)]]);
            return {generation, revision: 1};
        }
        const current = await this.readMeta(commit.id);
        if (current.generation !== commit.generation) throw new StoryError("book_not_found", `书 ${commit.id} 已被删除或换了一代`);
        const revision = current.revision + 1;
        const dir = this.bookDir(commit.id);
        const graph = `graph-${revision}.json`;
        const extraction = `extraction-${revision}.json`;
        await writeFile(join(dir, graph), dataBytes);
        await writeFile(join(dir, extraction), commit.extraction);
        const meta: BookMeta = {...current, ...shape, revision, graph, extraction: {through: commit.through, file: extraction}};
        const temp = join(dir, `book.json.${randomUUID()}.tmp`);
        await writeFile(temp, `${JSON.stringify(meta, null, 2)}\n`);
        await rename(temp, join(dir, "book.json"));
        // 提交之后回收上一版：已经 pin 住的查询持有打开的文件，不受影响；读到旧版本还没打开的会重来（见 pinBook）。
        await Promise.all([current.graph, current.extraction?.file].filter((file): file is string => file !== undefined).map(file => rm(join(dir, file), {force: true})));
        return {generation: current.generation, revision};
    }

    /** 这个 id 有没有抽取记录（第 1 章还没提交的也算）。 */
    async hasIngest(id: string): Promise<boolean> {
        try {
            await stat(join(this.ingestDir(id), "source.json"));
            return true;
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return false;
            throw error;
        }
    }

    /**
     * 新书：写进临时目录，整个改名成书目录。目标已存在时报 `book_exists`。改名之后再看一眼这个 id 有没有抽取记录：
     * 与抽取同时占用同一个 id 时，至少一边会看到另一边并退回（抽取那边的对称检查见 src/ingest/store.ts）。
     */
    private async publishNewBook(id: string, generation: string, meta: BookMeta, files: [string, Buffer][]): Promise<void> {
        await mkdir(this.root, {recursive: true});
        const staging = join(this.root, `.importing-${generation}`);
        await mkdir(staging);
        try {
            for (const [name, bytes] of files) await writeFile(join(staging, name), bytes);
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
        if (meta.extraction === undefined && (await this.hasIngest(id))) {
            await this.discard(id);
            throw new StoryError("book_exists", `书 id ${id} 已被抽取占用`);
        }
    }

    /** 把书目录改名移走再删掉。 */
    private async discard(id: string): Promise<void> {
        const trash = join(this.root, `.removed-${randomUUID()}`);
        await rename(join(this.root, id), trash);
        await rm(trash, {recursive: true, force: true});
    }

    /**
     * 删除一本书与它的抽取记录；之后同一 id 可以重新导入或抽取（得到新的一代）。只有抽取记录、还没有书（第 1 章没
     * 提交）的 id 也能删。别的进程正在抽这个 id 时报 `ingest_running`，什么都不删（docs/specs/story/ingest.md 输出 16）。
     */
    async removeBook(id: string): Promise<void> {
        await this.assertWritable();
        if (!BOOK_ID_PATTERN.test(id)) throw new StoryError("book_not_found", `书库里没有书 ${id}`);
        const meta = await this.readMetaOrNull(id);
        const ingest = await this.hasIngest(id);
        if (!meta && !ingest) throw new StoryError("book_not_found", `书库里没有书 ${id}`);
        if (meta) assertBookFormat(meta);
        const pass = this.#removeGuard ? await this.#removeGuard(id) : {release: async () => undefined};
        if (!pass) throw new StoryError("ingest_running", `书 ${id} 正在别的进程里抽取，先在那里停下它`);
        try {
            if (meta) {
                try {
                    await this.discard(id);
                } catch (error) {
                    if (systemErrorCode(error) === "ENOENT") throw new StoryError("book_not_found", `书 ${id} 已被删除`, {cause: error});
                    throw error;
                }
            }
            if (ingest) {
                const trash = join(this.root, ".ingest", `.removed-${randomUUID()}`);
                await rename(this.ingestDir(id), trash).then(() => rm(trash, {recursive: true, force: true}), (error: unknown) => {
                    if (systemErrorCode(error) !== "ENOENT") throw error;
                });
            }
        } finally {
            await pass.release();
        }
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
        assertBookFormat(await this.readMeta(id));
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
            if (!isObject(value) || value.id !== id || typeof value.generation !== "string") return null;
            // 格式 1 里早于抽取的书没有版本与数据文件名：它们只有版本 1 与 graph.json。只在读时补，不改写磁盘。
            return {...(value as unknown as BookMeta), revision: typeof value.revision === "number" ? value.revision : 1, graph: typeof value.graph === "string" ? value.graph : "graph.json"};
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
}

/** 单本书的格式版本不认识时只读。 */
function assertBookFormat(meta: BookMeta): void {
    if (meta.format !== LIBRARY_FORMAT) throw new StoryError("unsupported_format", `书 ${meta.id} 的格式版本 ${meta.format} 不认识，只能读`);
}

/** pinBook 固定下来的一代。 */
export class PinnedBook {
    readonly meta: BookMeta;
    readonly #handle: FileHandle;
    #released = false;

    constructor(meta: BookMeta, handle: FileHandle) {
        this.meta = meta;
        this.#handle = handle;
    }

    /** 读这一代的数据集。导入时已整份校验过，这里不再校验。 */
    async readDataset(): Promise<Dataset> {
        if (this.#released) throw new Error("PinnedBook 已 release");
        return JSON.parse(await this.#handle.readFile("utf8")) as Dataset;
    }

    async release(): Promise<void> {
        if (this.#released) return;
        this.#released = true;
        await this.#handle.close();
    }
}
