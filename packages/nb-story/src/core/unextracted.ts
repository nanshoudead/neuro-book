/**
 * 未抽取的尾部：书还在抽取（或停在半路）时，已提交的章之后那些已经切好、但还没进图的章。原文在
 * `<书库>/.ingest/<书 id>/source.json`（抽取记录，格式见 ingest/store.ts 的 `IngestSource`），这里只读，不改。
 *
 * 尾部必须属于这一代的书：删书后同 id 可以马上换成另一本，`.ingest` 目录也跟着换，所以读出来要核对指纹（source.json 里
 * 已提交那几章的段数与这一代的 `meta.paragraphs` 逐章相同），不符就当没有尾部。这样查询会话固定的一代不会拼进别的书的
 * 原文（w00024 t30 设计审查第 1 条）。结构不对的文件同样当没有尾部，并写一条诊断（第 8 条）：问答照常能用，只是读不到尾部。
 */

import {readFile, stat} from "node:fs/promises";
import {join} from "node:path";

import type {SourceChapter} from "./dataset";
import type {Library} from "./library";

/** 解析结果的缓存：键是文件路径加修改时间与大小，`book.info` 每次页面加载都会问，不重复解析整本原文。 */
const parsed = new Map<string, {key: string; chapters: SourceChapter[] | null}>();

function isSourceChapters(value: unknown): value is SourceChapter[] {
    if (!Array.isArray(value)) return false;
    return value.every(
        (item, index) =>
            typeof item === "object" &&
            item !== null &&
            (item as {chapter?: unknown}).chapter === index + 1 &&
            typeof (item as {title?: unknown}).title === "string" &&
            Array.isArray((item as {paragraphs?: unknown}).paragraphs) &&
            (item as {paragraphs: unknown[]}).paragraphs.length > 0 &&
            (item as {paragraphs: unknown[]}).paragraphs.every(paragraph => typeof paragraph === "string") &&
            typeof (item as {sha256?: unknown}).sha256 === "string",
    );
}

async function readChapters(file: string): Promise<SourceChapter[] | null> {
    let info;
    try {
        info = await stat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    const key = `${info.mtimeMs}:${info.size}`;
    const cached = parsed.get(file);
    if (cached?.key === key) return cached.chapters;
    let chapters: SourceChapter[] | null = null;
    try {
        const source = JSON.parse(await readFile(file, "utf8")) as {chapters?: unknown};
        if (isSourceChapters(source.chapters)) chapters = source.chapters;
        else console.error(`nbstory：${file} 的结构不对，读不到未抽取的章`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        console.error(`nbstory：${file} 读不成，读不到未抽取的章：${error instanceof Error ? error.message : String(error)}`);
    }
    parsed.set(file, {key, chapters});
    return chapters;
}

/**
 * 这一代已提交各章（段数 `committed`）之后的章；没有抽取记录、记录不是这一代的书、结构不对时为空。
 * 指纹每次都核对，不进缓存键：同一份文件对不同代的调用方结果可以不同。
 */
export async function unextractedTail(library: Library, bookId: string, committed: readonly number[]): Promise<SourceChapter[]> {
    const chapters = await readChapters(join(library.ingestDir(bookId), "source.json"));
    if (chapters === null || chapters.length < committed.length) return [];
    if (!committed.every((count, index) => chapters[index]!.paragraphs.length === count)) return [];
    return chapters.slice(committed.length);
}
