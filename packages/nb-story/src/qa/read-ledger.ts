/**
 * 一轮的读原文账本（docs/specs/story/qa.md 输出 4、5、8 的第 3 项、24、26）：记下这个对话经 `read` 读过的段，管住
 * 图当目录的章数上限，并判断一个出处是不是全在读过的原文里。以段为单位：范围出处要求范围内每一段都读过，同一章
 * 分几次读的段合起来算。前几轮读过的段由构造参数 `read` 带进来，算读过的原文；章数上限只数这一轮新读、前几轮
 * 没读过的章。一轮结束时 `snapshot()` 导出全部读过的段，随记录保存。
 *
 * 只有 `read` 工具改它，而 `read` 声明为 exclusive（同一条模型消息里的几次 `read` 依次执行），所以 plan 与 record
 * 之间不会插进另一次 `read`，章数检查与登记之间没有竞态。
 */

import type {Position} from "../core/dataset";
import type {PositionInput} from "../core/position";
import type {ReadRange} from "../core/qa-records";

/** 一段原文的位置。 */
export type Paragraph = Position;

export type ReadPlan = {ok: true; from: Position; to: Position} | {ok: false; reason: string};

/** “章.段”或“章.段—章.段”（也接受短横线）。 */
const REF = /^(\d+)\.(\d+)(?:[—–-](\d+)\.(\d+))?$/u;
/**
 * 文字里形如出处的片段：前面不紧挨数字或小数点，后面不紧跟数字、也不紧跟“小数点加数字”。所以句末的“39.1。”
 * “39.1.”算出处，“3.5.0”这类三段数字不算。先做 NFKC 归一，全角的“３９．１”与半角同样识别。
 */
const REF_IN_TEXT = /(?<![\d.])(\d+)\.(\d+)(?:[—–-](\d+)\.(\d+))?(?!\d)(?!\.\d)/gu;

export function refsInText(text: string): string[] {
    return [...text.normalize("NFKC").matchAll(REF_IN_TEXT)].map(match => match[0]);
}

function before(a: Position, b: Position): boolean {
    return a.chapter < b.chapter || (a.chapter === b.chapter && a.paragraph < b.paragraph);
}

export class ReadLedger {
    readonly #paragraphs: readonly number[];
    readonly #at: Position;
    readonly #maxChapters: number | null;
    readonly #readAll: boolean;
    readonly #read = new Map<number, Set<number>>();
    /** 前几轮读过的章：再读不计入这一轮的上限。 */
    readonly #earlier: ReadonlySet<number>;
    /** 这一轮新读、前几轮没读过的章。 */
    readonly #fresh = new Set<number>();

    /**
     * @param paragraphs 各章的段数，下标是章号减 1
     * @param at 阅读位置（已落定到段）
     * @param maxChapters 图当目录的章数上限；全读时为 null
     * @param readAll 全读：P 以前的段落都算读过
     * @param read 前几轮读过的段（`snapshot()` 的输出）；超出全书或晚于 P 时抛错，调用方按记录损坏处理
     */
    constructor(options: {paragraphs: readonly number[]; at: Position; maxChapters: number | null; readAll: boolean; read?: readonly ReadRange[]}) {
        this.#paragraphs = options.paragraphs;
        this.#at = options.at;
        this.#maxChapters = options.maxChapters;
        this.#readAll = options.readAll;
        for (const [chapter, from, to] of options.read ?? []) {
            const length = this.#length(chapter);
            if (length === undefined || from > to || to > length || before(this.#at, {chapter, paragraph: to})) throw new Error(`读过的段 ${chapter}.${from}—${chapter}.${to} 不在全书或阅读位置以内`);
            for (let paragraph = from; paragraph <= to; paragraph += 1) this.#add(chapter, paragraph);
        }
        this.#earlier = new Set(this.#read.keys());
    }

    #add(chapter: number, paragraph: number): void {
        let set = this.#read.get(chapter);
        if (!set) this.#read.set(chapter, (set = new Set()));
        set.add(paragraph);
    }

    #length(chapter: number): number | undefined {
        return this.#paragraphs[chapter - 1];
    }

    /** 一次 `read` 请求裁到 P 以后的范围；整个在 P 之后、超出全书或会超过章数上限时给出拒绝原因。 */
    plan(from: PositionInput, to?: PositionInput): ReadPlan {
        const fromLength = this.#length(from.chapter);
        if (fromLength === undefined) return {ok: false, reason: `没有第 ${from.chapter} 章`};
        const start: Position = {chapter: from.chapter, paragraph: from.paragraph ?? 1};
        const endInput = to ?? (from.paragraph === undefined ? {chapter: from.chapter} : from);
        const endLength = this.#length(endInput.chapter);
        if (endLength === undefined) return {ok: false, reason: `没有第 ${endInput.chapter} 章`};
        const end: Position = {chapter: endInput.chapter, paragraph: endInput.paragraph ?? endLength};
        if (start.paragraph < 1 || start.paragraph > fromLength || end.paragraph < 1 || end.paragraph > endLength) {
            return {ok: false, reason: "范围超出这一章的段数"};
        }
        if (before(end, start)) return {ok: false, reason: "范围的终点在起点之前"};
        if (before(this.#at, start)) return {ok: false, reason: `这段原文整个在阅读位置 ${this.#at.chapter}.${this.#at.paragraph} 之后，不能读`};
        const clipped = before(this.#at, end) ? {...this.#at} : end;
        if (this.#maxChapters !== null) {
            const fresh: number[] = [];
            for (let chapter = start.chapter; chapter <= clipped.chapter; chapter += 1) if (!this.#read.has(chapter)) fresh.push(chapter);
            if (this.#fresh.size + fresh.length > this.#maxChapters) {
                const earlier = this.#earlier.size > 0 ? `；前几轮读过的 ${[...this.#earlier].sort((a, b) => a - b).join("、")} 章不算` : "";
                return {
                    ok: false,
                    reason: `一问最多读 ${this.#maxChapters} 个不同的章，这一问已读 ${this.#fresh.size} 章（${this.chapters().join("、") || "无"}），这次要再读 ${fresh.join("、")} 章，超过上限；已读的章可以再读${earlier}`,
                };
            }
        }
        return {ok: true, from: start, to: clipped};
    }

    /** 登记实际返回给模型的段。 */
    record(paragraphs: readonly Paragraph[]): void {
        for (const {chapter, paragraph} of paragraphs) {
            if (!this.#earlier.has(chapter)) this.#fresh.add(chapter);
            this.#add(chapter, paragraph);
        }
    }

    /** 这一轮新读的章，按章号排序。全读时是 P 以前的全部章。 */
    chapters(): number[] {
        if (this.#readAll) return Array.from({length: this.#at.chapter}, (_, index) => index + 1);
        return [...this.#fresh].sort((a, b) => a - b);
    }

    /** 对话里读过的全部段，按章、段排序的闭区间；同一章里只合并相邻的段。全读时为空（恢复时仍按全读处理）。 */
    snapshot(): ReadRange[] {
        if (this.#readAll) return [];
        const ranges: ReadRange[] = [];
        for (const chapter of [...this.#read.keys()].sort((a, b) => a - b)) {
            const paragraphs = [...this.#read.get(chapter)!].sort((a, b) => a - b);
            for (const paragraph of paragraphs) {
                const last = ranges.at(-1);
                if (last && last[0] === chapter && last[2] + 1 === paragraph) last[2] = paragraph;
                else ranges.push([chapter, paragraph, paragraph]);
            }
        }
        return ranges;
    }

    #wasRead(position: Position): boolean {
        if (this.#readAll) return true;
        return this.#read.get(position.chapter)?.has(position.paragraph) ?? false;
    }

    /** 一个出处的问题；没有问题时为 null。 */
    checkRef(ref: string): string | null {
        const match = REF.exec(ref.normalize("NFKC").trim());
        if (!match) return `出处 ${ref} 的写法不对，要写“章.段”或“章.段—章.段”`;
        const start: Position = {chapter: Number(match[1]), paragraph: Number(match[2])};
        const end: Position = match[3] === undefined ? start : {chapter: Number(match[3]), paragraph: Number(match[4])};
        for (const position of [start, end]) {
            const length = this.#length(position.chapter);
            if (length === undefined || position.paragraph < 1 || position.paragraph > length) return `出处 ${ref} 超出了全书范围`;
        }
        if (before(end, start)) return `出处 ${ref} 的终点在起点之前`;
        if (before(this.#at, end)) return `出处 ${ref} 晚于阅读位置 ${this.#at.chapter}.${this.#at.paragraph}`;
        const unread: string[] = [];
        for (let position = start; ; position = this.#next(position)) {
            if (!this.#wasRead(position)) unread.push(`${position.chapter}.${position.paragraph}`);
            if (position.chapter === end.chapter && position.paragraph === end.paragraph) break;
        }
        if (unread.length > 0) {
            const shown = unread.length > 5 ? `${unread.slice(0, 5).join("、")} 等 ${unread.length} 段` : unread.join("、");
            return `出处 ${ref} 里有没读过的段落（${shown}）：先用 read 读了再引用`;
        }
        return null;
    }

    #next(position: Position): Position {
        return position.paragraph < this.#length(position.chapter)! ? {chapter: position.chapter, paragraph: position.paragraph + 1} : {chapter: position.chapter + 1, paragraph: 1};
    }
}
