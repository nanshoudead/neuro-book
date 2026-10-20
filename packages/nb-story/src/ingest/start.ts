/**
 * 发起抽取前的判定（docs/specs/story/ingest.md 输出 1、2）：切章，按书 id 对照已保存的原文，定下是新建、接着抽、
 * 追加还是已经抽完。预览只判定不写；开始时调用方先拿到这个 id 的抽取锁，再判定并占用或追加（`applyPlan`）。
 */

import {StoryError} from "../core/errors";
import {bookIdFromTitle, type Library} from "../core/library";
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
}

const BOOK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** 从原文判定。`title` 不给时由调用方先用文件名补上；`id` 不给时由书名得到。 */
export async function planFromText(library: Library, input: {text: string; title: string; id?: string}): Promise<IngestPlan> {
    const split = splitChapters(input.text);
    const id = input.id ?? bookIdFromTitle(input.title);
    if (!BOOK_ID.test(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
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
        const source: IngestSource = {id, title: input.title, chapters: split.chapters, preambleChars: split.preambleChars, volumeLines: split.volumeLines, createdAt: new Date().toISOString()};
        return {...base, title: input.title, action: "new", newChapters: 0, committed: 0, source};
    }
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
        return {...base, title: existing.title, action: "append", newChapters, committed: data.through, source};
    }
    const action = data.through >= existing.chapters.length ? "done" : "resume";
    return {...base, title: existing.title, action, newChapters: 0, committed: data.through, source: null};
}

/** 不给原文，用保存的原文接着抽。 */
export async function planFromSaved(library: Library, id: string): Promise<IngestPlan> {
    const existing = await new IngestStore(library, id).readSource();
    if (!existing) throw new StoryError("book_not_found", `书 ${id} 没有抽取记录`);
    const {data} = await readCommitted(library, id);
    return {
        id, title: existing.title,
        action: data.through >= existing.chapters.length ? "done" : "resume",
        chapters: existing.chapters.map(chapter => ({chapter: chapter.chapter, title: chapter.title, chars: countChars(chapter.paragraphs.join(""))})),
        preambleChars: existing.preambleChars, volumeLines: existing.volumeLines, newChapters: 0, committed: data.through, source: null,
    };
}

/** 按判定写抽取记录：新建时占用 id，追加时替换原文。调用方持锁，且在锁里重新判定过。 */
export async function applyPlan(library: Library, plan: IngestPlan): Promise<void> {
    const store = new IngestStore(library, plan.id);
    if (plan.action === "new") await store.claim(plan.source!);
    else if (plan.action === "append") await store.replaceSource(plan.source!);
}
