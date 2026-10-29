/**
 * `nbstory revisions`：对图的修订（docs/specs/story/revisions.md 输出 13）。动作与方法一一对应，参数写法见下表；
 * 先把动作和位置参数检查完（用法错误退出码 2，不随书库里有几本书而变），再调核心库。
 */

import {createStoryApi} from "../core/api";
import {coordinatedLibrary} from "../ingest/coordinator";
import type {StoryMethod} from "../contract/contract";
import {parsePositionText} from "../core/position";
import {formatResult} from "./format";
import {NEXT_STEP, type CliIo} from "./main";

const USAGE = [
    "用法：",
    "  nbstory revisions list [--state pending|adopted|rejected|closed|stale] [--source …]",
    "  nbstory revisions confirm <说法 id>       确认候选身份说法",
    "  nbstory revisions reject <说法 id> [--reason 理由]",
    "  nbstory revisions link <甲> <乙> --evidence 章.段 [--certainty candidate|certain]",
    "  nbstory revisions kind <对象> <种类> --evidence 章.段",
    "  nbstory revisions move-name <称呼> <从> <到> --evidence 章.段",
    "  nbstory revisions undo <修订编号>",
    "  nbstory revisions evidence <对象> [--text 称呼] [--at 章.段]    列出可作依据的段（list 与 evidence 才有 --at；写入的修订用 --evidence）",
].join("\n");

interface Call {
    method: StoryMethod;
    params: Record<string, unknown>;
}

/** 动作与参数 → 方法调用；用法不对为 null。 */
function callOf(params: Record<string, unknown>): Call | null {
    const {action, first, second, third} = params as {action: string; first?: string; second?: string; third?: string};
    const base: Record<string, unknown> = {};
    for (const key of ["book", "at", "limit", "cursor", "state", "source"] as const) if (params[key] !== undefined) base[key] = params[key];
    const evidence = params.evidence as string | undefined;
    const writeBase = params.book === undefined ? {} : {book: params.book};
    // 写入的修订按依据位置生效、不带阅读位置：--at 不会被悄悄丢掉，直接算用法错误。
    if (params.at !== undefined && !["list", "evidence"].includes(action)) return null;
    const needEvidence = (text: string | undefined): string | null => (text !== undefined && /^\d+\.\d+$/u.test(text) && parsePositionText(text) !== null ? text : null);
    switch (action) {
        case "list":
            return first === undefined ? {method: "revisions.list", params: base} : null;
        case "confirm":
            return first !== undefined && second === undefined ? {method: "revisions.confirm", params: {...writeBase, statement: first}} : null;
        case "reject":
            return first !== undefined && second === undefined ? {method: "revisions.reject", params: {...writeBase, statement: first, ...(params.reason === undefined ? {} : {reason: params.reason})}} : null;
        case "link": {
            const at = needEvidence(evidence);
            const certainty = params.certainty ?? "candidate";
            return first !== undefined && second !== undefined && third === undefined && at !== null && (certainty === "candidate" || certainty === "certain") ? {method: "revisions.link", params: {...writeBase, a: first, b: second, evidence: at, certainty}} : null;
        }
        case "kind": {
            const at = needEvidence(evidence);
            return first !== undefined && second !== undefined && third === undefined && at !== null ? {method: "revisions.kind", params: {...writeBase, entity: first, kind: second, evidence: at}} : null;
        }
        case "move-name": {
            const at = needEvidence(evidence);
            return first !== undefined && second !== undefined && third !== undefined && at !== null ? {method: "revisions.moveName", params: {...writeBase, text: first, from: second, to: third, evidence: at}} : null;
        }
        case "undo":
            return first !== undefined && second === undefined ? {method: "revisions.undo", params: {...writeBase, revision: first}} : null;
        case "evidence":
            return first !== undefined && second === undefined ? {method: "revisions.evidence", params: {...base, entity: first, ...(params.text === undefined ? {} : {text: params.text})}} : null;
        default:
            return null;
    }
}

export async function revisionsCommand(options: {library: string | undefined; params: Record<string, unknown>; json: boolean}, io: CliIo): Promise<number> {
    const call = callOf(options.params);
    if (call === null) {
        io.stderr(USAGE);
        return 2;
    }
    const api = createStoryApi({library: coordinatedLibrary(options.library)});
    const outcome = await api.call(call.method, call.params);
    if (options.json) {
        io.stdout(JSON.stringify(outcome.ok ? {ok: true, data: outcome.value} : {ok: false, error: outcome.error}));
        return outcome.ok ? 0 : 1;
    }
    if (!outcome.ok) {
        const next = NEXT_STEP[outcome.error.code];
        io.stderr(`错误（${outcome.error.code}）：${outcome.error.message}${next ? `\n下一步：${next}` : ""}`);
        return 1;
    }
    io.stdout(formatResult(call.method, outcome.value as never, "option"));
    return 0;
}
