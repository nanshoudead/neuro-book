import type {TSchema} from "typebox";
import type {ProfileTools, ReportResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";

export type {ProfileTools, ReportResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";
export {defineAgentTool} from "nbook/server/agent/tools/types";
export type {AgentToolDefinition} from "nbook/server/agent/tools/types";

/**
 * 保留 profile tools 对象的字面量 key 类型，方便 mainRunToolKeys / sidecar.toolKeys 做子集约束。
 */
export function defineProfileTools<const TTools extends ProfileTools>(tools: TTools): TTools {
    return tools;
}

/**
 * 受控工具绑定工厂。这里不暴露 execute，profile 作者只能声明当前 profile 如何绑定已有工具。
 */
export const tools = {
    read: () => registeredTool("read"),
    write: () => registeredTool("write"),
    edit: () => registeredTool("edit"),
    applyPatch: () => registeredTool("apply_patch"),
    bash: () => registeredTool("bash"),
    createAgent: () => registeredTool("create_agent"),
    invokeAgent: () => registeredTool("invoke_agent"),
    getAgent: () => registeredTool("get_agent"),
    getAgentProfile: () => registeredTool("get_agent_profile"),
    getSession: () => registeredTool("get_session"),
    detachAgent: () => registeredTool("detach_agent"),
    requestUserInput: () => registeredTool("request_user_input"),
    enterPlanMode: () => registeredTool("enter_plan_mode"),
    exitPlanMode: () => registeredTool("exit_plan_mode"),
    taskCreate: () => registeredTool("task_create"),
    taskSetStatus: () => registeredTool("task_set_status"),
    getPlotTree: () => registeredTool("get_plot_tree"),
    getStoryThread: () => registeredTool("get_story_thread"),
    getStorySceneContext: () => registeredTool("get_story_scene_context"),
    getChapterPlot: () => registeredTool("get_chapter_plot"),
    createStoryThread: () => registeredTool("create_story_thread"),
    updateStoryThread: () => registeredTool("update_story_thread"),
    createStoryScene: () => registeredTool("create_story_scene"),
    updateStoryScene: () => registeredTool("update_story_scene"),
    createStoryPlot: () => registeredTool("create_story_plot"),
    createStoryPlots: () => registeredTool("create_story_plots"),
    updateStoryPlot: () => registeredTool("update_story_plot"),
    executeSql: () => registeredTool("execute_sql"),
    variableSchema: () => registeredTool("variable_schema"),
    variableRead: () => registeredTool("variable_read"),
    variablePatch: () => registeredTool("variable_patch"),
    subjectRagSearch: () => registeredTool("subject_rag_search"),
    subjectEventAppend: () => registeredTool("subject_event_append"),
    subjectMemoryUpdate: () => registeredTool("subject_memory_update"),
    webSearch: () => registeredTool("web_search"),
    webFetch: () => registeredTool("web_fetch"),
    reportResult: (options: {dataSchema?: TSchema} = {}): ReportResultToolBinding => ({
        key: "report_result",
        dataSchema: options.dataSchema,
    }),
    registered: <const TKey extends string>(key: TKey) => registeredTool(key),
};

/**
 * 构造一个已注册全局工具绑定。它只引用 registry，不携带 execute。
 */
function registeredTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return {
        key,
    };
}
