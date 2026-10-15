/**
 * `nbstory` 命令行（docs/specs/story/cli-skill.md）。查询命令直接调核心库，不经 HTTP；只有 `serve` 才加载服务端代码。
 *
 * 退出码：0 成功；1 查询失败；2 用法错误；3 `serve` 启动失败。`--json` 时标准输出只有一个 JSON。
 */

import type {StoryMethod} from "../contract/contract";
import {createStoryApi} from "../core/api";
import type {StoryApi} from "../core/api";
import type {StoryErrorCode} from "../core/errors";
import {COMMANDS, decodeArguments, FLAGS, usage, UsageError} from "./commands";
import type {CommandSpec} from "./commands";
import {formatResult} from "./format";
import {liveRegistration} from "./registration";

export interface CliIo {
    stdout(text: string): void;
    stderr(text: string): void;
}

const processIo: CliIo = {
    stdout: text => process.stdout.write(`${text}\n`),
    stderr: text => process.stderr.write(`${text}\n`),
};

/** 失败时给人读的下一步。 */
const NEXT_STEP: Partial<Record<StoryErrorCode, string>> = {
    book_not_found: "用 nbstory books 查看书库里的书",
    book_ambiguous: "用 --book 指定书",
    book_exists: "换书名或用 --id 指定新 id",
    entity_not_found: "用 nbstory find 或 nbstory search 查",
    entity_ambiguous: "从上面的候选里改用 id",
    beyond_position: "把 --at 往后拨",
    cursor_invalid: "去掉 --cursor 从第一页重新取",
    position_out_of_range: "改正 --at",
};

/** 命令 → 查看器的页面与页签（docs/specs/story/viewer.md 的“边界与兼容”）。 */
const VIEWER_PAGE: Record<string, {page: string; tab?: string}> = {
    info: {page: "overview"},
    chapter: {page: "overview"},
    stats: {page: "stats"},
    find: {page: "roster"},
    card: {page: "roster", tab: "summary"},
    knowledge: {page: "roster", tab: "records"},
    statements: {page: "roster", tab: "records"},
    appearances: {page: "roster", tab: "episodes"},
    knows: {page: "secrets"},
    relations: {page: "relations"},
    ledger: {page: "ledger"},
    track: {page: "ledger"},
    questions: {page: "questions"},
    timeline: {page: "timeline"},
    episodes: {page: "episodes"},
    arcs: {page: "episodes"},
    search: {page: "overview"},
    read: {page: "source"},
    para: {page: "source"},
};

interface Parsed {
    command: string | null;
    positionals: string[];
    options: Map<string, string>;
}

function parse(argv: readonly string[]): Parsed {
    const options = new Map<string, string>();
    const positionals: string[] = [];
    let command: string | null = null;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index]!;
        if (token.startsWith("--")) {
            const [rawName, inline] = token.slice(2).split(/=(.*)/su, 2) as [string, string | undefined];
            if (FLAGS.has(rawName)) {
                options.set(rawName, "true");
                continue;
            }
            const value = inline ?? argv[index + 1];
            if (value === undefined) throw new UsageError(`选项 --${rawName} 缺少值`);
            if (inline === undefined) index += 1;
            options.set(rawName, value);
        } else if (command === null) {
            command = token;
        } else {
            positionals.push(token);
        }
    }
    return {command, positionals, options};
}

function formatAt(at: unknown): string | null {
    if (typeof at !== "object" || at === null || !("chapter" in at)) return null;
    const {chapter, paragraph} = at as {chapter: number; paragraph?: number};
    return paragraph === undefined ? String(chapter) : `${chapter}.${paragraph}`;
}

/** 有有效的服务登记时，给出查看器里对应画面的地址；地址里不含登录口令。 */
async function viewerUrl(api: StoryApi, spec: CommandSpec, params: Record<string, unknown>, result: unknown): Promise<string | null> {
    const target = VIEWER_PAGE[spec.name];
    if (!target) return null;
    const registration = await liveRegistration(api.library.root);
    if (!registration) return null;
    const bookId = await api.library.resolveBookId(params.book as string | undefined);
    const query = new URLSearchParams();
    // 地址总带上这次查询实际用的阅读位置：不带 --at 时是全书已抽取到的位置。地址省略的部分查看器会用存下的阅读
    // 状态补齐（viewer 输出 4），省略就打开不了与命令同一个位置的画面。
    let at = formatAt(params.at);
    if (!at) {
        const info = await api.call("book.info", {book: bookId});
        if (info.ok) at = `${info.value.at.chapter}.${info.value.at.paragraph}`;
    }
    if (at) query.set("at", at);
    if (typeof params.perspective === "string") query.set("perspective", params.perspective);
    let entity: string | null = null;
    if (spec.name === "card") entity = (result as {id: string}).id;
    else if (typeof params.entity === "string") {
        const card = await api.call("entity.card", {entity: params.entity, ...(params.at ? {at: params.at} : {}), ...(params.book ? {book: params.book} : {})});
        if (card.ok) entity = card.value.id;
    }
    if (entity) query.set("entity", entity);
    if (target.tab && entity) query.set("tab", target.tab);
    const search = query.toString();
    return `${registration.url}/book/${encodeURIComponent(bookId)}/${target.page}${search ? `?${search}` : ""}`;
}

export async function main(argv: readonly string[], io: CliIo = processIo): Promise<number> {
    let parsed: Parsed;
    let spec: CommandSpec | undefined;
    let params: Record<string, unknown>;
    try {
        parsed = parse(argv);
        if (parsed.options.has("help") || parsed.command === null) {
            io.stdout(usage());
            return parsed.command === null && !parsed.options.has("help") ? 2 : 0;
        }
        spec = COMMANDS.find(item => item.name === parsed.command);
        if (!spec) throw new UsageError(`没有命令 ${parsed.command}`);
        params = decodeArguments(spec, parsed.positionals, parsed.options);
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        io.stderr(`${error.message}\n\n${usage()}`);
        return 2;
    }

    const library = parsed.options.get("library");
    if (spec.method === null) {
        const {serveCommand} = await import("../server/serve");
        return serveCommand({library, port: params.port as number | undefined, open: parsed.options.has("open"), json: parsed.options.has("json")}, io);
    }

    const json = parsed.options.has("json");
    const api = createStoryApi(library === undefined ? {} : {library});
    const method: StoryMethod = spec.method;
    const outcome = await api.call(method, params);
    if (json) {
        io.stdout(JSON.stringify(outcome.ok ? {ok: true, data: outcome.value} : {ok: false, error: outcome.error}));
        return outcome.ok ? 0 : 1;
    }
    if (!outcome.ok) {
        const next = NEXT_STEP[outcome.error.code];
        io.stderr(`错误（${outcome.error.code}）：${outcome.error.message}${next ? `\n下一步：${next}` : ""}`);
        return 1;
    }
    const lines = [formatResult(method, outcome.value)];
    const url = await viewerUrl(api, spec, params, outcome.value);
    if (url) lines.push("", `查看器：${url}`);
    io.stdout(lines.join("\n"));
    return 0;
}
