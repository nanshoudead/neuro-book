import {isAbsolute} from "node:path";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import {recordProjectDelete, recordProjectWrite} from "nbook/server/workspace-history/project-history";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/**
 * Agent 文件工具（write / edit / apply_patch）的文件历史归因记账（Task 95 S5）。
 *
 * 项目归属直接消费统一 File Address Resolver 的结构化结果。Project-bound
 * File Scope 通过显式 `workspace/<其他slug>/...` 跨项目写文件时，解析结果
 * 已携带目标 Project Path；历史层不得再从物理路径反推领域身份。
 * 非 managed Project 地址与未 open 项目一律静默跳过；
 * 记账本身 fail-open（record* 内部保证），绝不影响工具主流程。
 */

/** 归一 before/after 入参：string 按 UTF-8 编码为字节。 */
function toRecordBytes(content: string | Uint8Array | null): Uint8Array | null {
    if (content === null) {
        return null;
    }
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * 记一次 agent 工具写入。after = null 表示删除（此时 before 必须有内容才有账可记）。
 * before = null 表示写前文件不存在（file.create 语义）。
 */
export async function recordAgentWorkspaceWrite(input: {
    sessionId: number;
    workspaceRoot: AbsoluteFsPath;
    address: ResolvedFileAddress;
    before: string | Uint8Array | null;
    after: string | Uint8Array | null;
}): Promise<void> {
    const projectPath = input.address.projectPath;
    const relativePath = "relativePath" in input.address ? input.address.relativePath : null;
    if (!projectPath || isAbsolute(projectPath) || !relativePath || relativePath === ".") {
        return;
    }
    // N5：sessionId number→string 集中在此转换，模块侧 actor 恒为 string
    const actor = {kind: "agent" as const, sessionId: String(input.sessionId)};
    const after = toRecordBytes(input.after);
    if (after === null) {
        const before = toRecordBytes(input.before);
        if (before === null) {
            return;
        }
        await recordProjectDelete({
            projectRoot: resolveProjectWorkspaceRoot(input.workspaceRoot, normalizeProjectPath(projectPath)),
            projectPath,
            relativePath,
            actor,
            before,
        });
        return;
    }
    await recordProjectWrite({
        projectRoot: resolveProjectWorkspaceRoot(input.workspaceRoot, normalizeProjectPath(projectPath)),
        projectPath,
        relativePath,
        actor,
        before: toRecordBytes(input.before),
        after,
    });
}
