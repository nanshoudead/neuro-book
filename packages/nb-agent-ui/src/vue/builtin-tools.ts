/**
 * 内置工具渲染器的组件部分：数据在核心的 `builtin-tools.ts`，这里按 id 挂上详情与节点组件。
 */
import type {Component} from "vue";
import type {AgentViewContribution, ToolRendererEntry} from "../registry";
import {builtinToolRenderers} from "../builtin-tools";
import AgentCommandDetail from "./tools/AgentCommandDetail.vue";
import AgentFileContentDetail from "./tools/AgentFileContentDetail.vue";
import AgentTaskListNode from "./tools/AgentTaskListNode.vue";

const DETAIL: Partial<Record<string, Component>> = {read: AgentFileContentDetail, bash: AgentCommandDetail, execute_sql: AgentCommandDetail};
const NODE: Partial<Record<string, Component>> = {task: AgentTaskListNode};

function withComponents(entry: ToolRendererEntry): ToolRendererEntry {
    const detail = DETAIL[entry.id];
    const node = NODE[entry.id];
    return {...entry, ...(detail === undefined ? {} : {detail}), ...(node === undefined ? {} : {node})};
}

export const builtinToolsContribution: AgentViewContribution = {source: "builtin:tools", tools: builtinToolRenderers.map(withComponents)};
