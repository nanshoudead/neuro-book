import type {WorkflowDefinitionDto, WorkflowListResponseDto, WorkflowRunDto, WorkflowRunListResponseDto, WorkflowRunRecordRequestDto} from "nbook/shared/dto/workflow.dto";

/**
 * Workflow HTTP API 的前端封装。
 */
export function useWorkflowApi() {
    /**
     * 列出 Project Workspace 内的 workflow 定义。
     */
    async function list(projectPath: string): Promise<WorkflowListResponseDto> {
        return await $fetch("/api/workflows", {
            query: {projectPath},
        });
    }

    /**
     * 安装内置默认 workflow。
     */
    async function createDefault(projectPath: string): Promise<WorkflowDefinitionDto> {
        return await $fetch("/api/workflows/default", {
            method: "POST",
            body: {projectPath},
        });
    }

    /**
     * 列出指定 workflow 的运行记录。
     */
    async function listRuns(projectPath: string, workflowId: string): Promise<WorkflowRunListResponseDto> {
        return await $fetch("/api/workflows/runs", {
            query: {projectPath, workflowId},
        });
    }

    /**
     * 启动一次新的 workflow run。
     */
    async function startRun(projectPath: string, workflowId: string): Promise<WorkflowRunDto> {
        return await $fetch("/api/workflows/runs", {
            method: "POST",
            body: {projectPath, workflowId},
        });
    }

    /**
     * 更新 workflow run 的单个步骤状态。
     */
    async function updateStep(input: {
        projectPath: string;
        workflowId: string;
        runId: string;
        stepId: string;
        action: "complete" | "skip" | "reopen";
        note?: string;
    }): Promise<WorkflowRunDto> {
        return await $fetch("/api/workflows/runs/step", {
            method: "PATCH",
            body: input,
        });
    }

    /**
     * 记录 workflow run 的 Agent 执行详情。
     */
    async function recordRun(input: WorkflowRunRecordRequestDto): Promise<WorkflowRunDto> {
        return await $fetch("/api/workflows/runs/record", {
            method: "PATCH",
            body: input,
        });
    }

    return {
        createDefault,
        list,
        listRuns,
        recordRun,
        startRun,
        updateStep,
    };
}
