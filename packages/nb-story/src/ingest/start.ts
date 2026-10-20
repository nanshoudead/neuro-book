/**
 * 发起抽取前的判定（docs/specs/story/ingest.md 输出 1、2）：切章，按书 id 对照已保存的原文，定下是新建、接着抽、
 * 追加还是已经抽完。预览只判定不写；开始时调用方先拿到这个 id 的抽取锁，再判定并占用或追加（`applyPlan`）。
 */

import {featuresOf, type BookFeatures} from "../core/dataset";
import {StoryError} from "../core/errors";
import {bookIdFromTitle, isValidBookId, type Library} from "../core/library";
import {readCommitted} from "./job";
import {IngestStore, type IngestSource} from "./store";
import {countChars, splitChapters} from "./text";

export type IngestAction = "new" | "resume" | "append" | "done";

export interface IngestPlan {
    id: string;
    title: string;
    action: IngestAction;
    chapters: {chapter: number; title: string; chars: number}[];
    preambleChars: number;
    volumeLines: number;
    /** 追加时多出几章。 */
    newChapters: number;
    /** 已提交到第几章。 */
    committed: number;
    /** 开始时要写的原文：新建时是整份，追加时是加上新章的整份；接着抽与抽完时为 null。 */
    source: IngestSource | null;
    /** 生效的开关：新建时是请求值，已有抽取记录时是保存的值。 */
    features: BookFeatures;
}

/**
 * 用法错误：请求里的开关与这本书新建时定下的不同（开关只在新建时设，docs/specs/story/ingest.md 的按书开关）。码仍是
 * `invalid_params`；命令行按这个类型以退出码 2 退出，其余 `invalid_params`（读不了原文文件等）照旧是 1。
 */
export class IngestUsageError extends StoryError {
    constructor(message: string) {
        super("invalid_params", message);
        this.name = "IngestUsageError";
    }
}

const FEATURE_NAMES: Record<keyof BookFeatures, string> = {ledger: "记录数值", secrets: "记录秘密"};

/** 已有抽取记录时的开关：没给的项沿用保存值；给了而与保存值不同时报 `IngestUsageError`，什么都不改。 */
function savedFeatures(saved: IngestSource, requested: Partial<BookFeatures> | undefined): BookFeatures {
    const features = featuresOf(saved.features);
    for (const key of ["ledger", "secrets"] as const) {
        const wanted = requested?.[key];
        if (wanted === undefined || wanted === features[key]) continue;
        throw new IngestUsageError(`书 ${saved.id} 新建时定的是“${FEATURE_NAMES[key]}”${features[key] ? "开" : "关"}，开关只能在新建时设；要换请删除这本书后重抽`);
    }
    return features;
}

/** 从原文判定。`title` 不给时由调用方先用文件名补上；`id` 不给时由书名得到。 */
export async function planFromText(library: Library, input: {text: string; title: string; id?: string; features?: Partial<BookFeatures>}): Promise<IngestPlan> {
    const split = splitChapters(input.text);
    const id = input.id ?? bookIdFromTitle(input.title);
    if (!isValidBookId(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
    const store = new IngestStore(library, id);
    const existing = await store.readSource();
    const listing = split.chapters.map(chapter => ({chapter: chapter.chapter, title: chapter.title, chars: countChars(chapter.paragraphs.join(""))}));
    const base = {id, chapters: listing, preambleChars: split.preambleChars, volumeLines: split.volumeLines};
    if (!existing) {
        const imported = await library.readMeta(id).then(() => true, (error: unknown) => {
            if (error instanceof StoryError && error.code === "book_not_found") return false;
            throw error;
        });
        if (imported) throw new StoryError("book_exists", `书 id ${id} 是导入数据文件得来的书，不能抽取；换一个书名或 --id`);
        const features = featuresOf(input.features);
        const source: IngestSource = {id, title: input.title, chapters: split.chapters, preambleChars: split.preambleChars, volumeLines: split.volumeLines, createdAt: new Date().toISOString(), features};
        return {...base, title: input.title, action: "new", newChapters: 0, committed: 0, source, features};
    }
    // 在比较原文之前：开关不对时不论原文怎样都要拒绝，也要在 done 提前返回之前。
    const features = savedFeatures(existing, input.features);
    // 已保存的每一章都要与文件里的相同（标题与每一段）；不同或文件少了章就拒绝，什么都不改。
    for (const saved of existing.chapters) {
        const incoming = split.chapters[saved.chapter - 1];
        if (!incoming) throw new StoryError("ingest_text_changed", `原文文件只有 ${split.chapters.length} 章，比已保存的 ${existing.chapters.length} 章少；改稿重抽不支持`);
        if (incoming.sha256 === saved.sha256 && incoming.title === saved.title) continue;
        const paragraph = saved.paragraphs.findIndex((text, index) => incoming.paragraphs[index] !== text);
        const at = paragraph < 0 ? saved.paragraphs.length + 1 : paragraph + 1;
        throw new StoryError("ingest_text_changed", `第 ${saved.chapter} 章与已保存的不一样（第 ${at} 段起不同）；改稿重抽不支持：换一个书名重新抽，或删掉这本书后重抽`);
    }
    const {data} = await readCommitted(library, id);
    const newChapters = split.chapters.length - existing.chapters.length;
    if (newChapters > 0) {
        const source: IngestSource = {...existing, chapters: [...existing.chapters, ...split.chapters.slice(existing.chapters.length)]};
        return {...base, title: existing.title, action: "append", newChapters, committed: data.through, source, features};
    }
    const action = data.through >= existing.chapters.length ? "done" : "resume";
    return {...base, title: existing.title, action, newChapters: 0, committed: data.through, source: null, features};
}

/** 不给原文，用保存的原文接着抽。 */
export async function planFromSaved(library: Library, id: string, requested?: Partial<BookFeatures>): Promise<IngestPlan> {
    if (!isValidBookId(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
    const existing = await new IngestStore(library, id).readSource();
    if (!existing) throw new StoryError("book_not_found", `书 ${id} 没有抽取记录`);
    const features = savedFeatures(existing, requested);
    const {data} = await readCommitted(library, id);
    return {
        id, title: existing.title,
        action: data.through >= existing.chapters.length ? "done" : "resume",
        chapters: existing.chapters.map(chapter => ({chapter: chapter.chapter, title: chapter.title, chars: countChars(chapter.paragraphs.join(""))})),
        preambleChars: existing.preambleChars, volumeLines: existing.volumeLines, newChapters: 0, committed: data.through, source: null, features,
    };
}

/** 按判定写抽取记录：新建时占用 id，追加时替换原文。调用方持锁，且在锁里重新判定过。 */
export async function applyPlan(library: Library, plan: IngestPlan): Promise<void> {
    const store = new IngestStore(library, plan.id);
    if (plan.action === "new") await store.claim(plan.source!);
    else if (plan.action === "append") await store.replaceSource(plan.source!);
}
