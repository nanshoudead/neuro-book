/**
 * 内置问答的记录：一问一条，存在书目录的 `qa/` 下（docs/specs/story/qa.md 输出 15、16 与“副作用与数据”）。
 *
 * 落盘：
 *   <书目录>/qa/<记录 id>.json            QaRecord
 *   <书目录>/qa/<记录 id>.session.jsonl   这一问的会话日志
 *
 * 一问运行期间书库里不写任何东西（会话日志在内存里），结束时 save 一次写下两个文件：先各写临时文件，再先改名日志、
 * 后改名记录。读者只认 `.json`，所以看到记录时日志已经在；改名前进程被杀只留下临时文件，不被列出。
 *
 * 和书的删除（整个书目录改名移走再递归删）的关系：写之前经 Library.writableBook 核对书还在、还是这一代、格式认识；
 * 核对之后被删除时，按路径写临时文件或改名会找不到目录而失败，按“没保存”返回，不会重新造出书目录（`qa/` 只用
 * 不递归的 mkdir 建）。核对之后被删除又同 id 导入时，按路径的写入会落进新一代的目录：所以两个文件都改好名之后
 * 再读一次这本书的代号，已经不是这一代就删掉刚写的文件、按“没保存”返回。复查通过之后才发生的删除，等同于
 * 保存之后书被删除，记录随旧目录一起删掉。
 *
 * 只用 Node 的文件接口：以后的独立服务（网页问答页）直接读同一份记录。
 */

import {randomBytes} from "node:crypto";
import {mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {Type, type Static} from "typebox";

import type {Position} from "./dataset";
import {StoryError, systemErrorCode} from "./errors";
import type {Library} from "./library";

/** 出处：“章.段”或“章.段—章.段”。 */
const Ref = Type.String({description: "出处：“章.段”或“章.段—章.段”，例如 37.8 或 38.50—38.57"});

/** 作答工具 `answer` 的参数，也是记录里答案的形状（qa.md 输出 7）。 */
export const AnswerSchema = Type.Object(
    {
        conclusion: Type.String({description: "先给的结论"}),
        conclusionType: Type.Union([Type.Literal("明说"), Type.Literal("推断"), Type.Literal("解读"), Type.Literal("无法确定")]),
        knowledge: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        who: Type.String(),
                        state: Type.Union([Type.Literal("知道"), Type.Literal("怀疑"), Type.Literal("不知道"), Type.Literal("原文没有表明")]),
                        how: Type.String({description: "怎么知道的"}),
                        refs: Type.Array(Ref),
                    },
                    {additionalProperties: false},
                ),
                {description: "“谁知道什么”的题：一行一人"},
            ),
        ),
        points: Type.Optional(Type.Array(Type.Object({text: Type.String(), refs: Type.Array(Ref)}, {additionalProperties: false}), {description: "其他题：分点"})),
        explanation: Type.String({description: "展开说明"}),
        evidence: Type.Array(Ref, {description: "依据出处"}),
        coverage: Type.String({description: "覆盖了哪些范围、可能漏了什么"}),
    },
    {additionalProperties: false},
);
export type Answer = Static<typeof AnswerSchema>;

export type QaStatus = "answered" | "failed" | "interrupted";
export type QaMode = "graph" | "full";

/** 各次模型运行相加的用量；`cost` 在单价未知时为 null，`complete` 为 false 表示只是下界。 */
export interface QaUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number | null;
    complete: boolean;
}

export interface QaRecord {
    id: string;
    book: string;
    generation: string;
    question: string;
    at: Position;
    mode: QaMode;
    status: QaStatus;
    /** 只在已答时有。 */
    answer: Answer | null;
    /** 只在失败时有；`kind` 是模型失败的错误归类。 */
    error: {code: string; kind?: string; message: string} | null;
    chaptersRead: number[];
    /** 作答被退回的次数。 */
    rejections: number;
    usage: QaUsage;
    ms: number;
    model: string;
    /** ISO 8601。 */
    startedAt: string;
}

export type SaveResult = {saved: true} | {saved: false; reason: "book_not_found" | "unsupported_format"};

/** 一份读不成 QaRecord 的记录文件：`nbstory qa` 列出时标为损坏，可以删除（qa.md F6）。 */
export interface BrokenQaRecord {
    id: string;
    problem: string;
}

const RECORD_ID = /^\d{17}-[0-9a-z]{6}$/u;

/** 新的记录 id：UTC 时间到毫秒加 6 位随机，按名字排序即按时间排序。 */
export function newQaRecordId(now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[-:.TZ]/gu, "");
    return `${stamp}-${randomBytes(4).toString("hex").slice(0, 6)}`;
}

function notFound(id: string): StoryError {
    return new StoryError("qa_record_not_found", `没有问答记录 ${id}（不存在、已删除，或属于这本书的另一代）`);
}

export class QaRecords {
    readonly #library: Library;
    readonly #bookId: string;

    constructor(library: Library, bookId: string) {
        this.#library = library;
        this.#bookId = bookId;
    }

    #dir(): string {
        return join(this.#library.bookDir(this.#bookId), "qa");
    }

    /** 记录与会话日志一起写下；书删了、换了代或格式不认识时不写，返回原因。 */
    async save(record: QaRecord, sessionJsonl: string): Promise<SaveResult> {
        if (!RECORD_ID.test(record.id)) throw new Error(`问答记录 id 不合法：${record.id}`);
        let bookDir: string;
        try {
            bookDir = await this.#library.writableBook(this.#bookId, record.generation);
        } catch (error) {
            if (error instanceof StoryError && (error.code === "book_not_found" || error.code === "unsupported_format")) return {saved: false, reason: error.code};
            throw error;
        }
        const dir = join(bookDir, "qa");
        const recordPath = join(dir, `${record.id}.json`);
        const logPath = join(dir, `${record.id}.session.jsonl`);
        const temps = [`${recordPath}.tmp`, `${logPath}.tmp`] as const;
        try {
            await mkdir(dir).catch((error: unknown) => {
                if (systemErrorCode(error) !== "EEXIST") throw error;
            });
            await writeFile(temps[1], sessionJsonl);
            await writeFile(temps[0], `${JSON.stringify(record, null, 2)}\n`);
            await rename(temps[1], logPath);
            await rename(temps[0], recordPath);
        } catch (error) {
            await Promise.all(temps.map(path => rm(path, {force: true})));
            // 核对之后书目录被改名移走：按路径的写入找不到目录。
            if (systemErrorCode(error) === "ENOENT") return {saved: false, reason: "book_not_found"};
            throw error;
        }
        const current = await this.#library.readMeta(this.#bookId).catch((error: unknown) => {
            if (error instanceof StoryError && error.code === "book_not_found") return null;
            throw error;
        });
        if (current?.generation !== record.generation) {
            await Promise.all([recordPath, logPath].map(path => rm(path, {force: true})));
            return {saved: false, reason: "book_not_found"};
        }
        return {saved: true};
    }

    /** 这一代的记录，新的在前；读不成记录的文件另列为损坏，不挡住其余记录。 */
    async list(generation: string): Promise<{records: QaRecord[]; broken: BrokenQaRecord[]}> {
        let names: string[];
        try {
            names = await readdir(this.#dir());
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return {records: [], broken: []};
            throw error;
        }
        const records: QaRecord[] = [];
        const broken: BrokenQaRecord[] = [];
        for (const name of names) {
            const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
            if (!RECORD_ID.test(id)) continue;
            const read = await this.#read(id);
            if (read.kind === "broken") broken.push({id, problem: read.problem});
            else if (read.kind === "record" && read.record.generation === generation) records.push(read.record);
        }
        const byIdDesc = (a: {id: string}, b: {id: string}): number => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
        return {records: records.sort(byIdDesc), broken: broken.sort(byIdDesc)};
    }

    async get(id: string, generation: string): Promise<QaRecord> {
        const read = RECORD_ID.test(id) ? await this.#read(id) : ({kind: "missing"} as const);
        if (read.kind === "broken") throw new StoryError("qa_record_broken", `问答记录 ${id} 已损坏（${read.problem}），可以用 nbstory qa rm 删除`);
        if (read.kind === "missing" || read.record.generation !== generation) throw notFound(id);
        return read.record;
    }

    /** 这一问的会话日志（JSONL）。 */
    async sessionLog(id: string, generation: string): Promise<string> {
        await this.get(id, generation);
        return readFile(join(this.#dir(), `${id}.session.jsonl`), "utf8");
    }

    /**
     * 删除一条记录与它的会话日志。损坏的记录也能删：读不出它属于哪一代，但它就在这本书的目录里。先删记录，
     * 列表立刻看不到它；再删日志。
     */
    async remove(id: string, generation: string): Promise<void> {
        const read = RECORD_ID.test(id) ? await this.#read(id) : ({kind: "missing"} as const);
        if (read.kind === "missing" || (read.kind === "record" && read.record.generation !== generation)) throw notFound(id);
        await this.#library.writableBook(this.#bookId, generation);
        try {
            await rm(join(this.#dir(), `${id}.json`));
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw notFound(id);
            throw error;
        }
        await rm(join(this.#dir(), `${id}.session.jsonl`), {force: true});
    }

    async #read(id: string): Promise<{kind: "record"; record: QaRecord} | {kind: "broken"; problem: string} | {kind: "missing"}> {
        let text: string;
        try {
            text = await readFile(join(this.#dir(), `${id}.json`), "utf8");
        } catch (error) {
            const code = systemErrorCode(error);
            if (code === "ENOENT" || code === "ENOTDIR") return {kind: "missing"};
            throw error;
        }
        let value: unknown;
        try {
            value = JSON.parse(text) as unknown;
        } catch (error) {
            return {kind: "broken", problem: `不是 JSON：${error instanceof Error ? error.message : String(error)}`};
        }
        const problem = recordProblem(value, id);
        return problem === null ? {kind: "record", record: value as QaRecord} : {kind: "broken", problem};
    }
}

/** 记录文件是外部输入：读出来后核对显示与筛选要用到的字段，形状不对的当作损坏。 */
function recordProblem(value: unknown, id: string): string | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "不是对象";
    const record = value as Record<string, unknown>;
    if (record.id !== id) return "id 与文件名不符";
    for (const field of ["book", "generation", "question", "startedAt", "model"]) if (typeof record[field] !== "string") return `缺少 ${field}`;
    if (record.status !== "answered" && record.status !== "failed" && record.status !== "interrupted") return "status 不对";
    const at = record.at as Record<string, unknown> | null;
    if (typeof at !== "object" || at === null || typeof at.chapter !== "number" || typeof at.paragraph !== "number") return "at 不对";
    if (!Array.isArray(record.chaptersRead) || typeof record.usage !== "object" || record.usage === null) return "缺少 chaptersRead 或 usage";
    if (record.status === "answered" && (typeof record.answer !== "object" || record.answer === null)) return "已答却没有 answer";
    return null;
}
