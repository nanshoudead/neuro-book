/**
 * `nbstory` 的命令表：一条查询命令对应一个查询方法（docs/specs/story/cli-skill.md 的“输入与前置条件”）。
 *
 * 每个位置参数与选项声明自己的解码器，把命令行的文字解码成合同的参数形状；解码后的参数再由 api.call 按同一份
 * schema 校验，所以这里只管“文字 → 值”，不重复合同里的规则。
 */

import {resolve} from "node:path";

import type {StoryMethod} from "../contract/contract";
import {parsePositionText} from "../core/position";
import type {PositionInput} from "../core/position";

/** 解码失败：命令行用法错误，退出码 2。 */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

type Decoder = (text: string, name: string) => unknown;

const text: Decoder = value => value;
const integer: Decoder = (value, name) => {
    if (!/^-?\d+$/u.test(value)) throw new UsageError(`${name} 要写整数：${value}`);
    return Number(value);
};
const position: Decoder = (value, name) => {
    const parsed = parsePositionText(value);
    if (!parsed) throw new UsageError(`${name} 要写“章”或“章.段”，例如 38 或 38.57：${value}`);
    return parsed;
};
const list: Decoder = value =>
    value
        .split(",")
        .map(item => item.trim())
        .filter(item => item !== "");

/** `read` 的范围：`38`、`38.48`、`38.48-81`（同一章到第 81 段）或 `38.48-39.3`。 */
export function decodeRange(value: string): {from: PositionInput; to?: PositionInput} {
    const parts = value.split("-");
    if (parts.length > 2) throw new UsageError(`范围只能有一个终点，例如 38.48-81：${value}`);
    const [start, end] = parts;
    const from = start === undefined ? null : parsePositionText(start);
    if (!from) throw new UsageError(`范围要写“章.段[-段]”，例如 38.48-81：${value}`);
    if (end === undefined) return {from};
    if (from.paragraph === undefined) throw new UsageError(`带终点的范围起点要写到段：${value}`);
    const to = end.includes(".") ? parsePositionText(end) : /^\d+$/u.test(end) ? {chapter: from.chapter, paragraph: Number(end)} : null;
    if (!to) throw new UsageError(`范围的终点要写“段”或“章.段”：${value}`);
    return {from, to};
}

/** 一个位置参数：解码成方法参数里的一个或几个字段。 */
interface Positional {
    name: string;
    decode: (value: string) => Record<string, unknown>;
}

interface OptionSpec {
    /** 方法参数名；不给时用选项名的驼峰写法。 */
    param?: string;
    decode: Decoder;
}

export interface CommandSpec {
    name: string;
    method: StoryMethod | null;
    summary: string;
    positionals: Positional[];
    options: Record<string, OptionSpec>;
    /** 是书级命令（接受 --book、--at）。 */
    book: boolean;
    /** 分页的命令接受 --limit、--cursor。 */
    paged: boolean;
}

const BOOK_OPTIONS: Record<string, OptionSpec> = {
    book: {decode: text},
    at: {decode: position},
};
const PAGE_OPTIONS: Record<string, OptionSpec> = {
    limit: {decode: integer},
    cursor: {decode: text},
};

function command(spec: Omit<CommandSpec, "options" | "positionals"> & {positionals?: Positional[]; options?: Record<string, OptionSpec>}): CommandSpec {
    return {
        ...spec,
        positionals: spec.positionals ?? [],
        options: {...(spec.book ? BOOK_OPTIONS : {}), ...(spec.paged ? PAGE_OPTIONS : {}), ...(spec.options ?? {})},
    };
}

const entityArg: Positional = {name: "对象", decode: value => ({entity: value})};
const query = {query: {decode: text}};

export const COMMANDS: readonly CommandSpec[] = [
    command({name: "books", method: "books.list", summary: "列出书库里的书", book: false, paged: false}),
    command({
        name: "import",
        method: "book.import",
        summary: "把 V9 记忆图收进书库",
        book: false,
        paged: false,
        positionals: [{name: "文件", decode: value => ({file: resolve(value)})}],
        options: {title: {decode: text}, id: {decode: text}},
    }),
    command({name: "remove", method: "book.remove", summary: "从书库删除一本书", book: false, paged: false, positionals: [{name: "书", decode: value => ({book: value})}]}),
    command({name: "info", method: "book.info", summary: "书的信息与目录", book: true, paged: false}),
    command({name: "stats", method: "book.stats", summary: "可见记录数与全书抽取统计", book: true, paged: false}),
    command({name: "chapter", method: "chapter.digest", summary: "这一章的变化", book: true, paged: false, positionals: [{name: "章", decode: value => ({chapter: integer(value, "章")})}]}),
    command({
        name: "find",
        method: "entities.list",
        summary: "找对象：全部称呼、身份、出场次数",
        book: true,
        paged: true,
        positionals: [{name: "名字或称呼", decode: value => ({query: value})}],
        options: {kind: {decode: text}, perspective: {decode: text}},
    }),
    command({name: "card", method: "entity.card", summary: "人物卡", book: true, paged: false, positionals: [entityArg], options: {perspective: {decode: text}}}),
    command({name: "knowledge", method: "entity.knowledge", summary: "他知道的事", book: true, paged: true, positionals: [entityArg], options: {state: {decode: text}, ...query}}),
    command({name: "statements", method: "entity.statements", summary: "关于他的说法", book: true, paged: true, positionals: [entityArg], options: query}),
    command({name: "appearances", method: "entity.episodes", summary: "他参与的情节", book: true, paged: true, positionals: [entityArg], options: query}),
    command({name: "ties", method: "entity.relations", summary: "他和每个对象的关系：关系词、身份连接、一句说明", book: true, paged: false, positionals: [entityArg], options: {perspective: {decode: text}}}),
    command({
        name: "between",
        method: "entity.relation",
        summary: "两个对象之间的全部说法、一起出场的情节、互相知道的事",
        book: true,
        paged: false,
        positionals: [entityArg, {name: "另一个", decode: value => ({other: value})}],
        options: {perspective: {decode: text}},
    }),
    command({name: "knows", method: "secrets.matrix", summary: "谁知道什么（秘密矩阵）", book: true, paged: false}),
    command({
        name: "relations",
        method: "graph.relations",
        summary: "人物之间的关系、同场、认知与身份连接",
        book: true,
        paged: false,
        options: {perspective: {decode: text}, kinds: {decode: list}, "min-together": {decode: integer}},
    }),
    command({name: "ledger", method: "ledger.tracks", summary: "各项数值与任务的当前值", book: true, paged: false}),
    command({name: "track", method: "ledger.track", summary: "某一项的流水与对账差额", book: true, paged: false, positionals: [{name: "数值", decode: value => ({track: value})}], options: {owner: {decode: text}}}),
    command({name: "questions", method: "questions.list", summary: "悬念与进展", book: true, paged: true, options: {state: {decode: text}, sort: {decode: text}, ...query}}),
    command({name: "timeline", method: "timeline", summary: "时间线", book: true, paged: false, options: {order: {decode: text}}}),
    command({name: "episodes", method: "episodes.list", summary: "情节", book: true, paged: true, options: {arc: {decode: text}, ...query}}),
    command({name: "arcs", method: "arcs.list", summary: "当前这一批主线", book: true, paged: false}),
    command({name: "search", method: "search", summary: "搜名字、说法、原文", book: true, paged: true, positionals: [{name: "文字", decode: value => ({query: value})}], options: {kinds: {decode: list}}}),
    command({name: "read", method: "source.read", summary: "读原文", book: true, paged: false, positionals: [{name: "章.段[-段]", decode: decodeRange}]}),
    command({
        name: "para",
        method: "source.records",
        summary: "引用某一段的记录",
        book: true,
        paged: false,
        positionals: [
            {
                name: "章.段",
                decode: value => {
                    const parsed = parsePositionText(value);
                    if (!parsed || parsed.paragraph === undefined) throw new UsageError(`要写“章.段”，例如 38.57：${value}`);
                    return {chapter: parsed.chapter, paragraph: parsed.paragraph};
                },
            },
        ],
    }),
    command({name: "serve", method: null, summary: "启动查看器的独立服务", book: false, paged: false, options: {port: {decode: integer}}}),
];

/** 所有命令都接受的选项（不进方法参数）。 */
export const GLOBAL_OPTIONS = new Set(["library", "json", "help"]);
/** 不带值的开关。 */
export const FLAGS = new Set(["json", "help", "open"]);

export function camelCase(name: string): string {
    return name.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
}

/** 按命令表把命令行参数解码成方法参数。 */
export function decodeArguments(spec: CommandSpec, positionals: readonly string[], options: ReadonlyMap<string, string>): Record<string, unknown> {
    if (positionals.length !== spec.positionals.length) {
        throw new UsageError(`${spec.name} 要 ${spec.positionals.length} 个参数（${spec.positionals.map(item => `<${item.name}>`).join(" ") || "无"}），给了 ${positionals.length} 个`);
    }
    const params: Record<string, unknown> = {};
    spec.positionals.forEach((positional, index) => Object.assign(params, positional.decode(positionals[index]!)));
    for (const [name, value] of options) {
        if (GLOBAL_OPTIONS.has(name) || (name === "open" && spec.name === "serve")) continue;
        const option = spec.options[name];
        if (!option) throw new UsageError(`${spec.name} 没有选项 --${name}`);
        params[option.param ?? camelCase(name)] = option.decode(value, `--${name}`);
    }
    return params;
}

export function usage(): string {
    const width = Math.max(...COMMANDS.map(spec => spec.name.length));
    const lines = COMMANDS.map(spec => {
        const args = spec.positionals.map(item => `<${item.name}>`).join(" ");
        return `  ${spec.name.padEnd(width)}  ${spec.summary}${args ? `  ${args}` : ""}`;
    });
    return [
        "用法：nbstory <命令> [参数] [选项]",
        "",
        "命令：",
        ...lines,
        "",
        "通用选项：--library <目录>、--json；书级命令另有 --book <书>、--at <章或章.段>；列表命令另有 --limit、--cursor。",
    ].join("\n");
}
