/**
 * 内置问答的记录：一个对话一条，存在书目录的 `qa/` 下（docs/specs/story/qa.md 输出 15、16、25 与“副作用与数据”）。
 *
 * 落盘：
 *   <书目录>/qa/<对话 id>.json                          QaConversation（旧的一问一条记录也在这个名字下）
 *   <书目录>/qa/<对话 id>.<第几轮>-<随机>.session.jsonl  记录的 `log.file` 指向的会话日志
 *   <书目录>/qa/<对话 id>.session.jsonl                  旧记录的会话日志（`log` 为 null）
 *
 * 一轮运行期间书库里不写任何东西（会话日志在内存里），结束时 save 写下一对文件。记录与日志要成对：每轮的日志写成
 * 新文件、不覆盖旧的，再把指向它的记录用一次改名发布；读者只认 `.json`，看到的记录总指向已经写好的日志。发布前
 * 任何一步失败都删掉新日志，旧的一对原样保留；发布之后才删上一轮的日志，删不掉只留下一个没人引用的文件，`remove`
 * 会一并删掉。临时文件名每次都带随机后缀，同时保存的两方不会写同一个临时文件。
 *
 * 同时追问同一个对话：发布前再读一次磁盘上的记录，轮数不是这一轮开始时的就不保存（`conflict`）。读与改名之间
 * 还有极短的窗口，Spec 的“不承诺”写明不保证一定不丢一轮。
 *
 * 和书的删除（整个书目录改名移走再递归删）的关系：写之前经 Library.writableBook 核对书还在、还是这一代、格式认识；
 * 核对之后被删除时，按路径写临时文件或改名会找不到目录而失败，按“没保存”返回，不会重新造出书目录（`qa/` 只用
 * 不递归的 mkdir 建）。核对之后被删除又同 id 导入时，按路径的写入会落进新一代的目录：所以发布之后再读一次这本书
 * 的代号，已经不是这一代就删掉刚写的两个文件、按“没保存”返回。复查通过之后才发生的删除，等同于保存之后书被删除，
 * 记录随旧目录一起删掉。
 *
 * 只用 Node 的文件接口：独立服务（网页问答页）直接读同一份记录。
 */

import {createHash, randomBytes} from "node:crypto";
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {Type, type Static} from "typebox";
import {Compile} from "typebox/compile";

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

/** 文字回复（qa.md 输出 10、24）：Agent 没调 `answer`、直接用文字说完的一轮。 */
export interface QaReply {
    text: string;
    /** 输出到上限被截断。 */
    truncated: boolean;
    /** 正文里写成出处形状、却没读过或晚于阅读位置的内容。 */
    unverifiedRefs: string[];
}

/** 对话的一轮。已答的一轮 `answer` 与 `reply` 恰有一个；失败与中断的一轮两个都是 null。 */
export interface QaTurn {
    question: string;
    status: QaStatus;
    answer: Answer | null;
    reply: QaReply | null;
    /** 只在失败时有；`kind` 是模型失败的错误归类。 */
    error: {code: string; kind?: string; message: string} | null;
    /** 这一轮新读的章（全读时是 P 以前的全部章）。 */
    chaptersRead: number[];
    /** 作答被退回的次数。 */
    rejections: number;
    usage: QaUsage;
    ms: number;
    model: string;
    /** ISO 8601。 */
    startedAt: string;
    /**
     * 这一轮在会话日志里的第一条的 seq（这一轮开始前日志的长度加一）：网页按它把记录的各轮对到日志上（附注挂哪一条
     * 回复），不数用户提问（有的失败轮在写用户消息之前就结束）。之前的记录没有它。
     */
    logFrom?: number;
}

/** 读过的段：闭区间 `[章, 起段, 止段]`，按章、段排序，同一章里不相邻的段分开存。 */
export type ReadRange = [number, number, number];

export interface QaConversation {
    id: string;
    book: string;
    generation: string;
    at: Position;
    mode: QaMode;
    /** 对话开始时的章数上限；全读为 null。续问用它，不看当时的配置（qa.md 输出 26）。 */
    maxChapters: number | null;
    /** 对话里读过的段；全读的对话不存（P 以前都算读过）。 */
    read: ReadRange[];
    turns: QaTurn[];
    /** 这一对的会话日志与内容摘要；旧的一问一条记录为 null，日志在 `<id>.session.jsonl`。由 `save` 填写。 */
    log: {file: string; sha256: string} | null;
    /** ISO 8601，第一轮的开始时间。 */
    startedAt: string;
}

/** 没保存的原因：书删了或换了代、格式不认识只读、对话在这一轮期间被别人改了或删了。 */
export type SaveResult = {saved: true; conversation: QaConversation} | {saved: false; reason: "book_not_found" | "unsupported_format" | "conflict"};

/** 一份读不成记录的文件：`nbstory qa` 列出时标为损坏，可以删除（qa.md F6）。 */
export interface BrokenQaRecord {
    id: string;
    problem: string;
}

const RECORD_ID = /^\d{17}-[0-9a-z]{6}$/u;

/** 新的记录 id：UTC 时间到毫秒加 6 位随机，按名字排序即按时间排序。 */
export function newQaRecordId(now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[-:.TZ]/gu, "");
    return `${stamp}-${randomSuffix()}`;
}

function randomSuffix(): string {
    return randomBytes(4).toString("hex").slice(0, 6);
}

function notFound(id: string): StoryError {
    return new StoryError("qa_record_not_found", `没有问答记录 ${id}（不存在、已删除，或属于这本书的另一代）`);
}

function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

/** 会话日志读出来的结果：读不出或与记录里的摘要不符时给出原因（续问据此报 qa_not_continuable）。 */
export type SessionLogRead = {ok: true; jsonl: string} | {ok: false; problem: string; missing?: true};

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

    /**
     * 写下一轮结束后的对话与它的会话日志。`expectTurns` 是这一轮开始时磁盘上的轮数（新对话为 0）：发布前磁盘上
     * 的记录已经不是这个轮数（或被删了），就不保存、返回 `conflict`。书删了、换了代或格式不认识时也不写，返回原因。
     */
    async save(conversation: Omit<QaConversation, "log">, sessionJsonl: string, options: {expectTurns: number}): Promise<SaveResult> {
        const {id} = conversation;
        if (!RECORD_ID.test(id)) throw new Error(`问答记录 id 不合法：${id}`);
        let bookDir: string;
        try {
            bookDir = await this.#library.writableBook(this.#bookId, conversation.generation);
        } catch (error) {
            if (error instanceof StoryError && (error.code === "book_not_found" || error.code === "unsupported_format")) return {saved: false, reason: error.code};
            throw error;
        }
        const dir = join(bookDir, "qa");
        const logFile = `${id}.${conversation.turns.length}-${randomSuffix()}.session.jsonl`;
        const logPath = join(dir, logFile);
        const recordPath = join(dir, `${id}.json`);
        const suffix = randomSuffix();
        const temps = [`${logPath}.${suffix}.tmp`, `${recordPath}.${suffix}.tmp`] as const;
        const saved: QaConversation = {...conversation, log: {file: logFile, sha256: sha256(sessionJsonl)}};
        let published = false;
        let previous: QaConversation | null = null;
        try {
            await mkdir(dir).catch((error: unknown) => {
                if (systemErrorCode(error) !== "EEXIST") throw error;
            });
            // 先把日志写到一个还没人引用的新名字，再核对轮数；核对不过就删掉它，旧的一对不受影响。
            await writeFile(temps[0], sessionJsonl);
            await rename(temps[0], logPath);
            const current = await this.#read(id);
            if (options.expectTurns === 0) {
                if (current.kind !== "missing") return await this.#discard(logPath, "conflict");
            } else {
                if (current.kind !== "conversation" || current.conversation.generation !== conversation.generation || current.conversation.turns.length !== options.expectTurns) {
                    return await this.#discard(logPath, "conflict");
                }
                previous = current.conversation;
            }
            await writeFile(temps[1], `${JSON.stringify(saved, null, 2)}\n`);
            await rename(temps[1], recordPath);
            published = true;
        } catch (error) {
            await Promise.all([...temps, ...(published ? [] : [logPath])].map(path => rm(path, {force: true})));
            // 核对之后书目录被改名移走：按路径的写入找不到目录。
            if (systemErrorCode(error) === "ENOENT") return {saved: false, reason: "book_not_found"};
            throw error;
        }
        const meta = await this.#library.readMeta(this.#bookId).catch((error: unknown) => {
            if (error instanceof StoryError && error.code === "book_not_found") return null;
            throw error;
        });
        if (meta?.generation !== conversation.generation) {
            await Promise.all([recordPath, logPath].map(path => rm(path, {force: true})));
            return {saved: false, reason: "book_not_found"};
        }
        // 发布之前对话被删了：remove 按 id 扫日志时会把这份还没发布的日志一起删掉，刚改名进去的记录就指向一个不在的
        // 文件。remove 最后还会再删一次记录，所以记录改名早于那一步的会被它删掉；晚于它的，日志一定已经被它扫掉，
        // 在这里看到日志不在，就撤回记录、按冲突返回，不留下没有日志的记录。
        if (!(await exists(logPath))) {
            await rm(recordPath, {force: true});
            return {saved: false, reason: "conflict"};
        }
        // 新的一对已经发布：上一轮的日志删不掉只是多留一个没人引用的文件（remove 会一并删），不改变保存结果。
        if (previous !== null) {
            await rm(join(dir, logFileOf(previous)), {force: true}).catch((error: unknown) => console.warn({error, file: logFileOf(previous!)}, "删除上一轮的会话日志失败"));
        }
        return {saved: true, conversation: saved};
    }

    async #discard(logPath: string, reason: "conflict"): Promise<SaveResult> {
        await rm(logPath, {force: true});
        return {saved: false, reason};
    }

    /** 这一代的对话，新的在前；读不成记录的文件另列为损坏，不挡住其余记录。 */
    async list(generation: string): Promise<{records: QaConversation[]; broken: BrokenQaRecord[]}> {
        let names: string[];
        try {
            names = await readdir(this.#dir());
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return {records: [], broken: []};
            throw error;
        }
        const records: QaConversation[] = [];
        const broken: BrokenQaRecord[] = [];
        for (const name of names) {
            const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
            if (!RECORD_ID.test(id)) continue;
            const read = await this.#read(id);
            if (read.kind === "broken") broken.push({id, problem: read.problem});
            else if (read.kind === "conversation" && read.conversation.generation === generation) records.push(read.conversation);
        }
        const byIdDesc = (a: {id: string}, b: {id: string}): number => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
        return {records: records.sort(byIdDesc), broken: broken.sort(byIdDesc)};
    }

    async get(id: string, generation: string): Promise<QaConversation> {
        const read = RECORD_ID.test(id) ? await this.#read(id) : ({kind: "missing"} as const);
        if (read.kind === "broken") throw new StoryError("qa_record_broken", `问答记录 ${id} 已损坏（${read.problem}），可以用 nbstory qa rm 删除`);
        if (read.kind === "missing" || read.conversation.generation !== generation) throw notFound(id);
        return read.conversation;
    }

    /** 这个对话的会话日志（JSONL）。读不出（不在、没权限、是目录等）或新形状记录的摘要对不上时给出原因，不抛出。 */
    async sessionLog(conversation: QaConversation): Promise<SessionLogRead> {
        let jsonl: string;
        try {
            jsonl = await readFile(join(this.#dir(), logFileOf(conversation)), "utf8");
        } catch (error) {
            const code = systemErrorCode(error);
            if (code === "ENOENT") return {ok: false, problem: "会话日志不在了", missing: true};
            return {ok: false, problem: `会话日志读不出来（${code ?? (error instanceof Error ? error.message : String(error))}）`};
        }
        if (conversation.log !== null && sha256(jsonl) !== conversation.log.sha256) return {ok: false, problem: "会话日志与记录里的摘要对不上（被改过或损坏）"};
        return {ok: true, jsonl};
    }

    /**
     * 读一个对话与它此刻指向的会话日志。读记录与读日志之间别处可能发布了下一轮、删掉了这份记录指向的旧日志：
     * 日志不在时再读一次记录，已经指向另一份日志就按新的一对重读，仍指向同一份才算日志丢了（照 Library.pinBook
     * 对旧版本被回收的处理）。
     */
    async getWithLog(id: string, generation: string): Promise<{conversation: QaConversation; log: SessionLogRead}> {
        for (let attempt = 0; ; attempt += 1) {
            const conversation = await this.get(id, generation);
            const log = await this.sessionLog(conversation);
            if (log.ok || !log.missing || attempt >= 2) return {conversation, log};
            const again = await this.get(id, generation);
            if (logFileOf(again) === logFileOf(conversation)) return {conversation, log};
        }
    }

    /**
     * 删除一个对话与它的全部会话日志。损坏的记录也能删：读不出它属于哪一代，但它就在这本书的目录里。先删记录，
     * 列表立刻看不到它；再删这个 id 的日志（包括保存中途留下、没人引用的）；最后再删一次记录：删除期间正在保存的
     * 一轮可能在第一次删除之后把记录改名回来，它的日志已经被这次扫掉（save 那一侧的配合见 save 里的说明）。
     */
    async remove(id: string, generation: string): Promise<void> {
        const read = RECORD_ID.test(id) ? await this.#read(id) : ({kind: "missing"} as const);
        if (read.kind === "missing" || (read.kind === "conversation" && read.conversation.generation !== generation)) throw notFound(id);
        await this.#library.writableBook(this.#bookId, generation);
        try {
            await rm(join(this.#dir(), `${id}.json`));
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") throw notFound(id);
            throw error;
        }
        const names = await readdir(this.#dir());
        await Promise.all(names.filter(name => name.startsWith(`${id}.`) && name.endsWith(".session.jsonl")).map(name => rm(join(this.#dir(), name), {force: true})));
        await rm(join(this.#dir(), `${id}.json`), {force: true});
    }

    async #read(id: string): Promise<{kind: "conversation"; conversation: QaConversation} | {kind: "broken"; problem: string} | {kind: "missing"}> {
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
        return conversationOf(value, id);
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

function logFileOf(conversation: QaConversation): string {
    return conversation.log?.file ?? `${conversation.id}.session.jsonl`;
}

const Usage = Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), cost: Type.Union([Type.Number(), Type.Null()]), complete: Type.Boolean()});
const Status = Type.Union([Type.Literal("answered"), Type.Literal("failed"), Type.Literal("interrupted")]);
const Failure = Type.Union([Type.Object({code: Type.String(), kind: Type.Optional(Type.String()), message: Type.String()}), Type.Null()]);
const PositionSchema = Type.Object({chapter: Type.Integer({minimum: 1}), paragraph: Type.Integer({minimum: 1})});
const Chapters = Type.Array(Type.Integer({minimum: 1}));
const TurnSchema = Type.Object({
    question: Type.String(),
    status: Status,
    answer: Type.Union([AnswerSchema, Type.Null()]),
    reply: Type.Union([Type.Object({text: Type.String(), truncated: Type.Boolean(), unverifiedRefs: Type.Array(Type.String())}), Type.Null()]),
    error: Failure,
    chaptersRead: Chapters,
    rejections: Type.Integer({minimum: 0}),
    usage: Usage,
    ms: Type.Number(),
    model: Type.String(),
    startedAt: Type.String(),
    logFrom: Type.Optional(Type.Integer({minimum: 1})),
});
const ConversationSchema = Type.Object({
    id: Type.String(),
    book: Type.String(),
    generation: Type.String(),
    at: PositionSchema,
    mode: Type.Union([Type.Literal("graph"), Type.Literal("full")]),
    maxChapters: Type.Union([Type.Integer({minimum: 1}), Type.Null()]),
    read: Type.Array(Type.Tuple([Type.Integer({minimum: 1}), Type.Integer({minimum: 1}), Type.Integer({minimum: 1})])),
    turns: Type.Array(TurnSchema, {minItems: 1}),
    log: Type.Object({file: Type.String(), sha256: Type.String()}),
    startedAt: Type.String(),
});
const checkConversation = Compile(ConversationSchema);
/** 这项改动之前的一问一条的记录（qa.md 输出 15 的旧形状）：读进来换成一轮的对话。 */
const LegacySchema = Type.Object({
    id: Type.String(),
    book: Type.String(),
    generation: Type.String(),
    question: Type.String(),
    at: PositionSchema,
    mode: Type.Union([Type.Literal("graph"), Type.Literal("full")]),
    status: Status,
    answer: Type.Union([AnswerSchema, Type.Null()]),
    error: Failure,
    chaptersRead: Chapters,
    rejections: Type.Integer({minimum: 0}),
    usage: Usage,
    ms: Type.Number(),
    model: Type.String(),
    startedAt: Type.String(),
});
const checkLegacy = Compile(LegacySchema);

/** 记录文件是外部输入：两种形状都按 schema 整份核对，再核对两种形状共同的约束；不合的当作损坏。 */
function conversationOf(value: unknown, id: string): {kind: "conversation"; conversation: QaConversation} | {kind: "broken"; problem: string} {
    let conversation: QaConversation;
    if (typeof value === "object" && value !== null && "turns" in value) {
        if (!checkConversation.Check(value)) {
            const first = [...checkConversation.Errors(value)][0];
            return {kind: "broken", problem: `字段不对：${first?.instancePath || "/"} ${first?.message ?? ""}`.trim()};
        }
        conversation = value as QaConversation;
        const prefix = `${id}.`;
        if (!conversation.log!.file.startsWith(prefix) || !conversation.log!.file.endsWith(".session.jsonl") || conversation.log!.file.includes("/")) return {kind: "broken", problem: "log.file 不是这个对话的日志"};
    } else if (checkLegacy.Check(value)) {
        const {id: legacyId, book, generation, at, mode, startedAt, ...turn} = value;
        conversation = {id: legacyId, book, generation, at, mode, startedAt, maxChapters: null, read: [], turns: [{...turn, startedAt, reply: null}], log: null};
    } else {
        const first = [...checkLegacy.Errors(value)][0];
        return {kind: "broken", problem: `字段不对：${first?.instancePath || "/"} ${first?.message ?? ""}`.trim()};
    }
    if (conversation.id !== id) return {kind: "broken", problem: "id 与文件名不符"};
    for (const turn of conversation.turns) {
        if (turn.status === "answered" && (turn.answer === null) === (turn.reply === null)) return {kind: "broken", problem: "已答的一轮要恰有答案或文字回复之一"};
        if (turn.status !== "answered" && (turn.answer !== null || turn.reply !== null)) return {kind: "broken", problem: "没答的一轮带着答案"};
    }
    return {kind: "conversation", conversation};
}
