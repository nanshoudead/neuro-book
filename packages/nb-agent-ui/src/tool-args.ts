/**
 * 读取工具参数的小工具。参数是工具自己的 JSON，流式生成中可能缺字段，所以一律容忍缺失与类型不符。
 */
import type {JsonValue, ToolCallView} from "./types";
import type {FileChangeView} from "./registry";

export function argString(call: ToolCallView, key: string): string {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return "";
    }
    const value = args[key];
    return typeof value === "string" ? value : "";
}

export function argArray(call: ToolCallView, key: string): JsonValue[] {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return [];
    }
    const value = args[key];
    return Array.isArray(value) ? value : [];
}

export function countLines(text: string): number {
    if (text === "") {
        return 0;
    }
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

export function objectString(value: JsonValue, key: string): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const field = value[key];
    return typeof field === "string" ? field : null;
}

export function argNumber(call: ToolCallView, key: string): number | null {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return null;
    }
    const value = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const PATCH_FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/u;

/** 解析 Codex apply_patch 文本，按文件统计 `+`/`-` 行。 */
export function parsePatchChanges(patch: string): FileChangeView[] {
    const changes: FileChangeView[] = [];
    let current: {path: string; added: number; removed: number} | null = null;
    for (const line of patch.split("\n")) {
        const header = PATCH_FILE_HEADER.exec(line);
        if (header !== null) {
            current = {path: header[2]!.trim(), added: 0, removed: 0};
            changes.push(current);
            continue;
        }
        if (current === null || line.startsWith("***")) {
            continue;
        }
        if (line.startsWith("+")) {
            current.added += 1;
        } else if (line.startsWith("-")) {
            current.removed += 1;
        }
    }
    return changes;
}

const HASHLINE_FILE = /^\[([^\]#]+)#[^\]]*\]/u;

/**
 * nb-harness 内置 edit 的参数是一段 `input` 文本：补丁格式（`*** Update File: 路径`），或 hashline 格式（每个文件以
 * `[路径#标记]` 开头，后面是行锚操作）。工具跑完后 `result.details.files` 列出真正改到的文件，以它为准；还没有结果时
 * 从 input 里认。hashline 的行锚操作不展开，增删行数未知（null）。旧工具的 `{path, edits}` 写法另由调用方处理。
 */
export function editInputChanges(call: ToolCallView): FileChangeView[] {
    const input = argString(call, "input");
    const fromPatch = parsePatchChanges(input);
    const details = call.result?.details;
    const files = details !== null && typeof details === "object" && !Array.isArray(details) && Array.isArray(details.files) ? details.files : null;
    if (files !== null) {
        return files.flatMap((file) => {
            const path = objectString(file, "path");
            if (path === null) return [];
            const counted = fromPatch.find((change) => change.path === path);
            return [counted ?? {path, added: null, removed: null}];
        });
    }
    if (fromPatch.length > 0) return fromPatch;
    const paths = new Set<string>();
    for (const line of input.split("\n")) {
        const header = HASHLINE_FILE.exec(line.trim());
        if (header !== null) paths.add(header[1]!.trim());
    }
    return [...paths].map((path) => ({path, added: null, removed: null}));
}
