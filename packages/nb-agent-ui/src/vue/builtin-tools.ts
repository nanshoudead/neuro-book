/**
 * 内置工具的渲染器登记。类别划分见 Spec「内置工具的类别」；未登记的工具由通用渲染器兜底。
 *
 * 常用工具登记了展开后的适配组件（文件内容、diff、命令输出）；其余工具展开后显示原始参数与结果。
 * 只登记通用的 harness 工具；领域工具（例如 NeuroBook 的主体记忆、nb-story 的问答工具）由宿主另行登记。
 */
import type {ToolCallView} from "../types";
import type {AgentViewContribution, ToolEffects, ToolRendererEntry} from "../registry";
import AgentCommandDetail from "./tools/AgentCommandDetail.vue";
import AgentFileContentDetail from "./tools/AgentFileContentDetail.vue";
import AgentFileDiffDetail from "./tools/AgentFileDiffDetail.vue";
import AgentTaskListNode from "./tools/AgentTaskListNode.vue";
import {TASK_TOOL_NAMES} from "../task-list";
import {argArray, argString, countLines, objectString, parsePatchChanges} from "../tool-args";

const noEffects = (): ToolEffects => ({read: [], changed: []});

function readEffects(call: ToolCallView): ToolEffects {
    const path = argString(call, "path");
    return {read: path === "" ? [] : [path], changed: []};
}

function writeEffects(call: ToolCallView): ToolEffects {
    const path = argString(call, "path");
    if (path === "") {
        return noEffects();
    }
    // 整文件覆盖时拿不到旧内容，删除行数未知。
    return {read: [], changed: [{path, added: countLines(argString(call, "content")), removed: null}]};
}

/**
 * 按替换片段的行数近似统计：oldText 计为删除、newText 计为新增。
 * 片段内未变的行也会被计入，所以数字偏大；精确 diff 需要文件原文，视图拿不到。
 */
function editEffects(call: ToolCallView): ToolEffects {
    const path = argString(call, "path");
    if (path === "") {
        return noEffects();
    }
    let added = 0;
    let removed = 0;
    for (const edit of argArray(call, "edits")) {
        added += countLines(objectString(edit, "newText") ?? "");
        removed += countLines(objectString(edit, "oldText") ?? "");
    }
    return {read: [], changed: [{path, added, removed}]};
}

function applyPatchEffects(call: ToolCallView): ToolEffects {
    return {read: [], changed: parsePatchChanges(argString(call, "patch"))};
}

function firstQuestion(call: ToolCallView): string {
    const first = argArray(call, "questions")[0];
    return first === undefined ? "" : objectString(first, "question") ?? "";
}

const tools: ToolRendererEntry[] = [
    // explore
    {
        id: "read", toolNames: ["read"], category: "explore", icon: "i-lucide-file-text",
        label: {key: "tool.read"}, summary: (call) => argString(call, "path"),
        groupPhrase: (count) => ({key: "toolGroup.read", params: {count}}),
        effects: readEffects, presentation: "line", detail: AgentFileContentDetail,
    },
    {
        id: "web_search", toolNames: ["web_search"], category: "explore", icon: "i-lucide-search",
        label: {key: "tool.webSearch"}, summary: (call) => argString(call, "query"),
        groupPhrase: (count) => ({key: "toolGroup.search", params: {count}}), presentation: "line",
    },
    {
        id: "web_fetch", toolNames: ["web_fetch"], category: "explore", icon: "i-lucide-globe",
        label: {key: "tool.webFetch"}, summary: (call) => argString(call, "url"),
        groupPhrase: (count) => ({key: "toolGroup.fetch", params: {count}}), presentation: "line",
    },
    {
        id: "list", toolNamePrefix: "list_", category: "explore", icon: "i-lucide-list",
        label: {key: "tool.list"}, summary: (call) => call.name,
        groupPhrase: (count) => ({key: "toolGroup.lookup", params: {count}}), presentation: "line",
    },
    // mutate
    {
        id: "write", toolNames: ["write"], category: "mutate", icon: "i-lucide-file-plus",
        label: {key: "tool.write"}, summary: (call) => argString(call, "path"),
        effects: writeEffects, presentation: "line", detail: AgentFileDiffDetail,
    },
    {
        id: "edit", toolNames: ["edit"], category: "mutate", icon: "i-lucide-file-pen",
        label: {key: "tool.edit"}, summary: (call) => argString(call, "path"),
        effects: editEffects, presentation: "line", detail: AgentFileDiffDetail,
    },
    {
        id: "apply_patch", toolNames: ["apply_patch"], category: "mutate", icon: "i-lucide-file-diff",
        label: {key: "tool.applyPatch"},
        summary: (call) => parsePatchChanges(argString(call, "patch")).map((change) => change.path).join(", "),
        effects: applyPatchEffects, presentation: "line", detail: AgentFileDiffDetail,
    },
    // interact
    {
        id: "request_user_input", toolNames: ["request_user_input"], category: "interact", icon: "i-lucide-message-circle-question",
        label: {key: "tool.requestUserInput"}, summary: firstQuestion, presentation: "node",
    },
    {
        id: "switch_mode", toolNames: ["switch_mode"], category: "interact", icon: "i-lucide-toggle-right",
        label: {key: "tool.switchMode"}, summary: (call) => argString(call, "targetMode"), presentation: "node",
    },
    // other
    {
        id: "task", toolNames: TASK_TOOL_NAMES, category: "other", icon: "i-lucide-list-checks",
        label: {key: "tool.task"}, summary: (call) => argString(call, "title"), presentation: "node", node: AgentTaskListNode,
    },
    {
        id: "run_workflow", toolNames: ["run_workflow"], category: "other", icon: "i-lucide-workflow",
        label: {key: "tool.runWorkflow"}, summary: (call) => argString(call, "workflowKey"), presentation: "node",
    },
    {
        id: "bash", toolNames: ["bash"], category: "other", icon: "i-lucide-terminal",
        label: {key: "tool.bash"}, summary: (call) => argString(call, "command"), presentation: "card", detail: AgentCommandDetail,
    },
    {
        id: "execute_sql", toolNames: ["execute_sql"], category: "other", icon: "i-lucide-database",
        label: {key: "tool.sql"}, summary: (call) => argString(call, "sql"), presentation: "card", detail: AgentCommandDetail,
    },
    {
        id: "agent_collaboration", toolNames: ["create_agent", "invoke_agent", "detach_agent", "report_result"], category: "other", icon: "i-lucide-users",
        label: {key: "tool.agentCollaboration"}, summary: (call) => call.name, presentation: "card",
    },
];

export const builtinToolsContribution: AgentViewContribution = {source: "builtin:tools", tools};
