/**
 * 问答页输入框的 `@` 引用（docs/specs/story/viewer.md 的问答页，w00024 t15 决定 2 到 4）：人物与对象、章节与段落两组候选，
 * 选中后插进 `[名称](entity://id)`、`[章.段](paragraph://章.段)`、`[第 N 章](chapter://N)`，模型按 id 查（story/qa.md 输出 37）。
 *
 * 菜单内容是纯函数 `mentionMenu`；人物要问服务端，由 `createMentionSearch` 按查询取、缓存，数据到了通知页面换一个新的
 * 菜单函数（nb-agent-ui 的 `resolveTriggerMenu` 约定：数据变化时宿主换函数，编辑器按当前查询重取）。
 */

import type {TriggerMenu, TriggerMenuItem} from "@notnotype/nb-agent-ui";
import {writeInlineLink} from "@notnotype/nb-markdown";

import type {EntityKind} from "../../core/dataset";
import {KIND_LABEL} from "../host/kinds";

export const ENTITY_SCHEME = "entity://";
export const CHAPTER_SCHEME = "chapter://";
/** 段落用出处链接同一种写法（link-refs.ts 的 REF_SCHEME）。 */
const PARAGRAPH_SCHEME = "paragraph://";

export type MentionEntity = {id: string; label: string; kind: EntityKind; names: readonly string[]};
/** 书的目录：各章段数（第 N 章在下标 N-1）与章标题（查看器位置之后的章没有标题）。 */
export type MentionBook = {paragraphs: readonly number[]; toc: readonly {chapter: number; title: string | null}[]};
/** 这个对话的阅读位置；不带段时是那一章读完。 */
export type MentionPosition = {chapter: number; paragraph?: number};

const ENTITY_GROUP = "人物与对象";
const PLACE_GROUP = "章节与段落";
const NOT_YET = "还没读到";

/**
 * 引用的插入文字。等于 `promptReferenceText(名称, 地址, schemeTargets)`（这些方案不是文件，地址原样写），直接用核心的
 * 写法函数：`@notnotype/nb-markdown/prompt` 是 Vue 组件的入口，纯 TS 的单测加载不了。
 */
const reference = (label: string, target: string): string => writeInlineLink(label, target);

/** 名字以外的称呼列两个；按称呼搜到的（例如搜“地狱猫”出来南嘉鱼）把搜中的那个排在前面，看得出为什么是它。 */
function entityItem(entity: MentionEntity, query: string): TriggerMenuItem {
    const aliases = entity.names.filter(name => name !== entity.label);
    const hit = query === "" ? [] : aliases.filter(name => name.includes(query));
    const others = [...hit, ...aliases.filter(name => !hit.includes(name))].slice(0, 2);
    return {
        id: `entity:${entity.id}`,
        label: entity.label,
        description: others.length > 0 ? `${KIND_LABEL[entity.kind]} · 也叫 ${others.join("、")}` : KIND_LABEL[entity.kind],
        iconClass: entity.kind === "person" || entity.kind === "persona" ? "i-lucide-user-round" : "i-lucide-shapes",
        group: ENTITY_GROUP,
        insertText: reference(entity.label, `${ENTITY_SCHEME}${entity.id}`),
    };
}

function chapterItem(chapter: number, book: MentionBook, at: MentionPosition): TriggerMenuItem {
    const title = book.toc.find(item => item.chapter === chapter)?.title ?? null;
    const later = chapter > at.chapter;
    return {
        id: `chapter:${chapter}`,
        label: `第 ${chapter} 章`,
        description: later ? NOT_YET : (title ?? `${book.paragraphs[chapter - 1] ?? 0} 段`),
        iconClass: "i-lucide-book-open",
        group: PLACE_GROUP,
        disabled: later,
        insertText: reference(`第 ${chapter} 章`, `${CHAPTER_SCHEME}${chapter}`),
    };
}

function paragraphItem(chapter: number, paragraph: number, at: MentionPosition): TriggerMenuItem {
    const later = chapter > at.chapter || (chapter === at.chapter && at.paragraph !== undefined && paragraph > at.paragraph);
    const ref = `${chapter}.${paragraph}`;
    return {
        id: `paragraph:${ref}`,
        label: ref,
        description: later ? NOT_YET : `第 ${chapter} 章第 ${paragraph} 段`,
        iconClass: "i-lucide-pilcrow",
        group: PLACE_GROUP,
        disabled: later,
        insertText: reference(ref, `${PARAGRAPH_SCHEME}${ref}`),
    };
}

/** 章节与段落：`37` 是一章，`37.8` 是一段（不存在的章、段不列）；文字按章标题筛；空查询给当前这一章。 */
function placeItems(query: string, book: MentionBook, at: MentionPosition): TriggerMenuItem[] {
    const chapters = book.paragraphs.length;
    if (query === "") return at.chapter >= 1 && at.chapter <= chapters ? [chapterItem(at.chapter, book, at)] : [];
    const numeric = /^(\d+)(?:\.(\d*))?$/u.exec(query);
    if (numeric !== null) {
        const chapter = Number(numeric[1]);
        if (chapter < 1 || chapter > chapters) return [];
        const paragraph = numeric[2] === undefined || numeric[2] === "" ? null : Number(numeric[2]);
        if (paragraph === null) return [chapterItem(chapter, book, at)];
        return paragraph >= 1 && paragraph <= book.paragraphs[chapter - 1]! ? [paragraphItem(chapter, paragraph, at)] : [];
    }
    return book.toc.filter(item => item.title !== null && item.title.includes(query)).slice(0, MENTION_LIMIT).map(item => chapterItem(item.chapter, book, at));
}

/** 每组最多列几项。 */
export const MENTION_LIMIT = 8;

/**
 * `@` 菜单。`entities` 是这个查询的人物结果，还没取到时为 null：章节照常列出，菜单显示“正在加载”，
 * 数据到了页面换一个新的菜单函数。
 */
export function mentionMenu(query: string, input: {entities: readonly MentionEntity[] | null; book: MentionBook; at: MentionPosition}): TriggerMenu {
    const items = [...(input.entities ?? []).slice(0, MENTION_LIMIT).map(entity => entityItem(entity, query)), ...placeItems(query, input.book, input.at)];
    return {title: "引用", items, ...(input.entities === null ? {loading: true} : {}), emptyText: query === "" ? "没有可引用的内容" : `没有找到“${query}”`};
}

export type MentionSearch = {
    /** 这个查询的人物；还没取到时为 null，并安排一次请求（同一查询只请求一次；失败的先给空，换过查询再回来时重试）。 */
    lookup(query: string): readonly MentionEntity[] | null;
    /** 阅读位置或书的数据变了：丢掉缓存与还没回来的请求。 */
    reset(): void;
    dispose(): void;
};

/**
 * 按查询取人物。连续输入时只请求停下来的那个查询（`delayMs` 内又换了查询就不发前一个）；`reset` 之前发出、之后才回来的
 * 结果丢掉（位置变了，名单可能剧透）。取到后调 `onChange`，页面据此换菜单函数。
 */
export function createMentionSearch(options: {search: (query: string) => Promise<MentionEntity[]>; onChange: () => void; delayMs?: number}): MentionSearch {
    const delay = options.delayMs ?? 150;
    let cache = new Map<string, readonly MentionEntity[]>();
    let scope = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wanted: string | null = null;
    const inFlight = new Set<string>();
    /** 最近一次失败的查询：查的还是它时给空，换了查询就忘掉。 */
    let failed: string | null = null;

    function fetchNow(query: string): void {
        const started = scope;
        inFlight.add(query);
        options.search(query).then(
            entities => {
                if (started !== scope) return;
                inFlight.delete(query);
                cache.set(query, entities);
                options.onChange();
            },
            (error: unknown) => {
                if (started !== scope) return;
                inFlight.delete(query);
                // 不进缓存：这个查询先显示为空，换了查询再回来时重新请求（不在菜单开着时反复重试）。
                console.warn({error, query}, "取 @ 菜单的人物失败");
                failed = query;
                options.onChange();
            },
        );
    }

    return {
        lookup(query) {
            const hit = cache.get(query);
            if (hit !== undefined) return hit;
            if (failed === query) return [];
            failed = null;
            if (!inFlight.has(query) && wanted !== query) {
                wanted = query;
                if (timer !== null) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    const next = wanted;
                    wanted = null;
                    if (next !== null && !cache.has(next) && !inFlight.has(next)) fetchNow(next);
                }, delay);
            }
            return null;
        },
        reset() {
            scope += 1;
            cache = new Map();
            inFlight.clear();
            wanted = null;
            failed = null;
            if (timer !== null) clearTimeout(timer);
            timer = null;
        },
        dispose() {
            this.reset();
        },
    };
}

const MENTION_TEXT = /\[([^\]\n]*)\]\((?:entity|paragraph|chapter):\/\/[^)\s]*\)/gu;

/** 对话列表与页头显示问题时，引用只留名称。 */
export function mentionPlainText(text: string): string {
    return text.replace(MENTION_TEXT, "$1");
}
