/**
 * NeuroBook 自己的工具在对话视图里的登记：主体记忆的检索与更新、查会话与 Agent。它们不是通用的 harness 工具，
 * 不在 nb-agent-ui 的内置登记里；主应用以后有 Agent 插件时由它登记，现在放在 Lab 的宿主里，也当作“宿主登记领域工具”
 * 的示例（docs/specs/ui/agent-conversation-view.md“注册表”）。
 */

import type {AgentViewContribution, ToolCallView, ToolRendererEntry} from "@notnotype/nb-agent-ui";

function argString(call: ToolCallView, key: string): string {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) return "";
    const value = args[key];
    return typeof value === "string" ? value : "";
}

const tools: ToolRendererEntry[] = [
    {
        id: "subject_rag_search", toolNames: ["subject_rag_search"], category: "explore", icon: "i-lucide-brain",
        label: {"zh-CN": "检索记忆", "en-US": "Search memory"}, summary: (call) => argString(call, "query"),
        groupPhrase: (count) => ({key: "toolGroup.search", params: {count}}), presentation: "line",
    },
    {
        id: "agent_lookup", toolNames: ["get_session", "get_agent", "get_agent_profile"], category: "explore", icon: "i-lucide-bot",
        label: {"zh-CN": "查询 Agent", "en-US": "Look up agent"}, summary: (call) => call.name,
        groupPhrase: (count) => ({key: "toolGroup.lookup", params: {count}}), presentation: "line",
    },
    {
        id: "subject_memory", toolNames: ["subject_memory_update", "subject_event_append"], category: "mutate", icon: "i-lucide-notebook-pen",
        label: {"zh-CN": "更新记忆", "en-US": "Update memory"}, summary: (call) => argString(call, "subjectPath"), presentation: "line",
    },
];

export const labDomainToolsContribution: AgentViewContribution = {source: "lab:neurobook-tools", tools};
