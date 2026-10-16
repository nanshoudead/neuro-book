/**
 * 查询接口的进程内调用：命令行直接用它，独立服务的 `POST /api/rpc/<方法名>` 也只经它调用，两种形式因此结果相同
 * （docs/specs/story/queries.md 验收 8）。
 *
 * 一次调用的顺序：按合同校验参数 → 解析书并固定一代 → 落定阅读位置与视角 → 调查询 → 按合同校验结果。
 * 结果不符合合同是程序缺陷，抛普通 Error（独立服务回 500），不伪装成某个业务失败码。
 */

import type {TSchema} from "typebox";
import {Compile} from "typebox/compile";

import {STORY_METHODS} from "../contract/contract";
import type {StoryMethod, StoryParams, StoryResult} from "../contract/contract";
import {openBookIndex} from "./book-index";
import type {BookIndex} from "./book-index";
import {decodeCursor, paramsDigest} from "./cursor";
import {StoryError} from "./errors";
import type {EntityCandidate, StoryErrorCode} from "./errors";
import {characterGrouping, READER, readerGrouping} from "./identity";
import type {Grouping} from "./identity";
import {Library} from "./library";
import type {BookMeta} from "./library";
import {resolvePosition} from "./position";
import {BookView} from "./projection";
import {bookInfo, bookStats} from "./queries/books";
import {makePager} from "./queries/context";
import type {QueryContext} from "./queries/context";
import {entitiesList, entityCard, entityEpisodes, entityKnowledge, entityStatements} from "./queries/entities";
import {entityRelation, entityRelations} from "./queries/relations";
import {arcsList, chapterDigest, episodesList} from "./queries/episodes";
import {bookGraph, relationsGraph, storyline} from "./queries/graph";
import {ledgerTrack, ledgerTracks} from "./queries/ledger";
import {questionsList} from "./queries/questions";
import {search} from "./queries/search";
import {secretsMatrix} from "./queries/secrets";
import {sourceRead, sourceRecords} from "./queries/source";
import {timeline} from "./queries/timeline";

export type StoryOutcome<M extends StoryMethod> = {ok: true; value: StoryResult<M>} | {ok: false; error: {code: StoryErrorCode; message: string; candidates?: EntityCandidate[]}};

export interface StoryApi {
    readonly library: Library;
    call<M extends StoryMethod>(method: M, params: unknown): Promise<StoryOutcome<M>>;
    /**
     * 固定这本书当前的一代（`book` 的省略规则同书级方法）。之后经它的调用都查这一代，删除与同 id 重新导入不影响
     * 它；内置问答一问用一个（docs/specs/story/qa.md 的“时序与寿命”）。书不存在等失败以 StoryError 抛出。
     */
    openBook(book: string | undefined): Promise<BookSession>;
}

/** 固定在一代上的书。索引整份在内存里，不持有文件，不需要释放。 */
export interface BookSession {
    readonly id: string;
    readonly generation: string;
    readonly meta: BookMeta;
    /** 只接受书级方法；参数里的 `book` 被忽略。 */
    call<M extends StoryMethod>(method: M, params: unknown): Promise<StoryOutcome<M>>;
}

type BookHandler = (ctx: QueryContext, params: never) => unknown;

/** 书级方法 → 查询函数。 */
const BOOK_HANDLERS: Partial<Record<StoryMethod, BookHandler>> = {
    "book.info": bookInfo,
    "book.stats": bookStats,
    "entities.list": entitiesList,
    "entity.card": entityCard,
    "entity.knowledge": entityKnowledge,
    "entity.statements": entityStatements,
    "entity.episodes": entityEpisodes,
    "entity.relations": entityRelations,
    "entity.relation": entityRelation,
    "secrets.matrix": secretsMatrix,
    "chapter.digest": chapterDigest,
    "ledger.tracks": ledgerTracks,
    "ledger.track": ledgerTrack,
    "questions.list": questionsList,
    timeline,
    "episodes.list": episodesList,
    "arcs.list": arcsList,
    "source.read": sourceRead,
    "source.records": sourceRecords,
    search,
    "graph.relations": relationsGraph,
    "graph.book": bookGraph,
    "graph.storyline": storyline,
};

/** 不适用视角的方法：忽略 perspective，用读者视角。 */
const PERSPECTIVE_METHODS: ReadonlySet<StoryMethod> = new Set(["entities.list", "entity.card", "entity.knowledge", "entity.statements", "entity.episodes", "entity.relations", "entity.relation", "secrets.matrix", "graph.relations"]);

const compiled = new Map<TSchema, ReturnType<typeof Compile<TSchema>>>();

function problems(schema: TSchema, value: unknown): string | null {
    let check = compiled.get(schema);
    if (!check) compiled.set(schema, (check = Compile(schema)));
    if (check.Check(value)) return null;
    return [...check.Errors(value)]
        .slice(0, 3)
        .map(error => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`)
        .join("；");
}

function isMethod(method: string): method is StoryMethod {
    return Object.hasOwn(STORY_METHODS, method);
}

/**
 * 调用参数里的对象 → 给定分组（缺省读者视角）下的点 id。可以写对象 id（任一成员），也可以写名字或称呼（按 P 时
 * 可见的称呼与显示名精确匹配）。对象在这本书里不存在或还没出现报 `entity_not_found`；对应几个点报
 * `entity_ambiguous`。角色视角下读者合并、他不合并的两个身份是两个点，所以要在查询自己的分组里解析。
 */
export function resolveEntity(view: BookView, text: string, grouping: Grouping = readerGrouping(view)): string {
    const reader = grouping;
    const byId = reader.nodeOf.get(text);
    if (byId !== undefined) return byId;
    if (view.index.entityById.has(text)) throw new StoryError("entity_not_found", `对象 ${text} 在这个阅读位置还没出现`);
    const query = text.trim();
    const nodes = new Set<string>();
    for (const entity of view.entities) {
        if (entity.names.some(name => name.text === query)) nodes.add(reader.nodeOf.get(entity.id)!);
    }
    for (const [node, label] of reader.labels) if (label === query) nodes.add(node);
    if (nodes.size === 1) return [...nodes][0]!;
    if (nodes.size === 0) throw new StoryError("entity_not_found", `这个阅读位置没有叫“${query}”的对象`);
    const candidates = [...nodes].sort().map(node => {
        const entity = view.entity(node)!;
        return {id: node, label: reader.labels.get(node)!, note: entity.label};
    });
    throw new StoryError("entity_ambiguous", `“${query}”对应 ${candidates.length} 个对象，请改用 id：${candidates.map(item => `${item.id}（${item.label}）`).join("、")}`, {candidates});
}

export function createStoryApi(options: {library?: Library | string} = {}): StoryApi {
    const library = options.library instanceof Library ? options.library : new Library(options.library);

    async function bookCall(method: StoryMethod, params: Record<string, unknown>): Promise<unknown> {
        const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
        let index: BookIndex;
        try {
            index = await openBookIndex(library, await library.resolveBookId(params.book as string | undefined));
        } catch (error) {
            // 带着合法旧游标来、书却已删除：按游标失效报（F10），调用方从第一页重来即可。
            if (cursor !== undefined && error instanceof StoryError && error.code === "book_not_found" && decodeCursor(cursor) !== null) {
                throw new StoryError("cursor_invalid", "分页游标对应的书已删除，请从第一页重新取", {cause: error});
            }
            throw error;
        }
        return queryIndex(index, method, params);
    }

    /** 在给定的一代上跑一个书级方法。 */
    function queryIndex(index: BookIndex, method: StoryMethod, params: Record<string, unknown>): unknown {
        const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
        const at = resolvePosition(params.at as {chapter: number; paragraph?: number} | undefined, index.chapters, index.meta.extractedThrough);
        const view = new BookView(index, at);
        const perspective = PERSPECTIVE_METHODS.has(method) ? (params.perspective as string | undefined) : undefined;
        let grouping = readerGrouping(view);
        if (perspective !== undefined && perspective !== READER) {
            const node = resolveEntity(view, perspective);
            const members = grouping.members.get(node) ?? [];
            if (!view.knowledge.some(item => members.includes(item.who))) {
                throw new StoryError("invalid_params", `${grouping.labels.get(node)} 在这个阅读位置还没有知情记录，不能作视角`);
            }
            grouping = characterGrouping(view, node);
        }
        const ctx: QueryContext = {
            method,
            index,
            view,
            grouping,
            page: makePager(index.meta.generation, paramsDigest(method, params), cursor, params.limit as number | undefined),
            resolveEntity: text => resolveEntity(view, text, grouping),
        };
        const handler = BOOK_HANDLERS[method];
        if (!handler) throw new Error(`书级方法 ${method} 没有登记查询函数`);
        return handler(ctx, params as never);
    }

    async function dispatch(method: StoryMethod, params: Record<string, unknown>): Promise<unknown> {
        switch (method) {
            case "books.list":
                return {books: (await library.listBooks()).map(({id, title, generation, chapters, extractedThrough}) => ({id, title, generation, chapters, extractedThrough}))};
            case "book.import": {
                const input = params as StoryParams<"book.import">;
                return library.importBook({file: input.file, title: input.title, ...(input.id === undefined ? {} : {id: input.id})});
            }
            case "book.remove":
                await library.removeBook((params as StoryParams<"book.remove">).book);
                return {};
            case "reading.get":
                return library.getReading(await library.resolveBookId(params.book as string | undefined));
            case "reading.set": {
                const input = params as StoryParams<"reading.set">;
                const id = await library.resolveBookId(input.book);
                const index = await openBookIndex(library, id);
                // 存进去的位置要能在这本书里落定；存原样（只给章就存章），读回时含义不变。
                resolvePosition(input.position, index.chapters, index.meta.extractedThrough);
                return library.setReading(id, input.position, input.view);
            }
            default:
                return bookCall(method, params);
        }
    }

    /** 按合同校验参数 → 执行 → 按合同校验结果；业务失败转成 StoryOutcome。 */
    async function checked<M extends StoryMethod>(method: M, params: unknown, run: (params: Record<string, unknown>) => Promise<unknown> | unknown): Promise<StoryOutcome<M>> {
        try {
            if (!isMethod(method)) throw new StoryError("invalid_params", `没有方法 ${String(method)}`);
            const spec = STORY_METHODS[method];
            const invalid = problems(spec.input, params);
            if (invalid) throw new StoryError("invalid_params", `参数不符合 ${method} 的 schema：${invalid}`);
            const value = await run(params as Record<string, unknown>);
            const broken = problems(spec.output, value);
            if (broken) throw new Error(`${method} 的结果不符合合同：${broken}`);
            return {ok: true, value: value as StoryResult<M>};
        } catch (error) {
            if (!(error instanceof StoryError)) throw error;
            return {ok: false, error: {code: error.code, message: error.message, ...(error.candidates ? {candidates: error.candidates} : {})}};
        }
    }

    return {
        library,
        call: (method, params) => checked(method, params, input => dispatch(method, input)),
        async openBook(book) {
            const index = await openBookIndex(library, await library.resolveBookId(book));
            return {
                id: index.meta.id,
                generation: index.meta.generation,
                meta: index.meta,
                call: (method, params) =>
                    checked(method, params, input => {
                        if (!BOOK_HANDLERS[method]) throw new StoryError("invalid_params", `${method} 不是书级方法`);
                        return queryIndex(index, method, input);
                    }),
            };
        },
    };
}

