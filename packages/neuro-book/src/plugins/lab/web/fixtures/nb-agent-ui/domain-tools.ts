/**
 * NeuroBook 与 nb-story 的工具在对话视图里的登记：主体记忆的检索与更新、查会话与 Agent、作答。它们不是通用的 harness 工具，
 * 不在 nb-agent-ui 的内置登记里；主应用以后有 Agent 插件时由它登记，现在放在 Lab 的宿主里，也当作“宿主登记领域工具”
 * 的示例（docs/specs/ui/agent-conversation-view.md“注册表”）。
 */

import {argString} from "@notnotype/nb-agent-ui";
import type {AgentViewContribution, ToolRendererEntry} from "@notnotype/nb-agent-ui";
import LabAnswerNode from "./LabAnswerNode.vue";

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
    // nb-story 交答案的收尾工具：常显的节点，宿主组件画结论与出处。
    {
        id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text",
        label: {"zh-CN": "作答", "en-US": "Answer"}, summary: (call) => argString(call, "conclusion"), presentation: "node", node: LabAnswerNode,
    },
];

export const labDomainToolsContribution: AgentViewContribution = {source: "lab:neurobook-tools", tools};
