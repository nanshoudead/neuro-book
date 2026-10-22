/**
 * 改文件工具的参数格式：Codex 的 apply_patch 补丁，与 nb-harness 内置 edit 的 `input`（补丁或 hashline）。
 * 只给内置渲染器用，按工具名分开的知识都在 `builtin-tools.ts` 的各登记项里。
 */
import type {ToolCallView} from "./types";
import type {FileChangeView} from "./registry";
import type {CodeLine} from "./tool-detail-lines";
import {argString, objectString} from "./tool-args";

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

/** 补丁的一行：按行首符号着色，文件头与块头淡色。 */
export function patchLine(line: string): CodeLine {
    // unified diff 的文件头（`--- 路径`、`+++ 路径`）不是增删行。
    if (line.startsWith("***") || line.startsWith("@@") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        return {text: line, tone: "muted"};
    }
    if (line.startsWith("+")) {
        return {text: line.slice(1), tone: "added"};
    }
    if (line.startsWith("-")) {
        return {text: line.slice(1), tone: "removed"};
    }
    return {text: line.startsWith(" ") ? line.slice(1) : line};
}
