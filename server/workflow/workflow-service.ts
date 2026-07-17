import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {createError} from "h3";
import * as yaml from "yaml";
import {normalizeProjectPath, resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import type {WorkflowDefinitionDto, WorkflowListResponseDto, WorkflowRunDto, WorkflowRunListResponseDto, WorkflowRunStepDto, WorkflowRunRecordRequestDto, WorkflowSummaryDto} from "nbook/shared/dto/workflow.dto";
import {WorkflowDefinitionDtoSchema, WorkflowRunDtoSchema} from "nbook/shared/dto/workflow.dto";

const WORKFLOW_DEFINITION_DIR = ".nbook/workflows";
const WORKFLOW_RUN_DIR = ".nbook/workflow-runs";

/**
 * 列出当前 Project Workspace 中已安装的 workflow 定义。
 */
export async function listProjectWorkflows(projectPathInput: string): Promise<WorkflowListResponseDto> {
    const project = resolveWorkflowProject(projectPathInput);
    const definitionDir = path.join(project.root, WORKFLOW_DEFINITION_DIR);
    const entries = await fs.readdir(definitionDir, {withFileTypes: true}).catch((error: unknown) => {
        if (isNodeErrorCode(error, "ENOENT")) {
            return [];
        }
        throw error;
    });
    const workflows: WorkflowSummaryDto[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
            continue;
        }
        const filePath = path.join(definitionDir, entry.name);
        const [definition, stat] = await Promise.all([
            readWorkflowDefinitionFile(filePath),
            fs.stat(filePath),
        ]);
        workflows.push({
            id: definition.id,
            title: definition.title,
            description: definition.description,
            version: definition.version,
            stepCount: definition.steps.length,
            updatedAt: stat.mtime.toISOString(),
        });
    }
    workflows.sort((left, right) => left.title.localeCompare(right.title));
    return {projectPath: project.projectPath, workflows};
}

/**
 * 记录 workflow run 的 Agent 执行详情、工具调用快照和文件 diff 提案。
 */
export async function recordWorkflowRun(input: WorkflowRunRecordRequestDto): Promise<WorkflowRunDto> {
    const project = resolveWorkflowProject(input.projectPath);
    const workflowId = normalizeWorkflowId(input.workflowId);
    await readProjectWorkflow(project.projectPath, workflowId);
    const runPath = workflowRunFile(project.root, workflowId, normalizeRunId(input.runId));
    const run = await readWorkflowRunFile(runPath);
    const now = new Date().toISOString();

    if (input.agentSessionId !== undefined) run.agentSessionId = input.agentSessionId;
    if (input.targetFilePath !== undefined) run.targetFilePath = input.targetFilePath;
    if (input.targetFileTitle !== undefined) run.targetFileTitle = input.targetFileTitle;
    if (input.goal !== undefined) run.goal = input.goal;
    if (input.baselineContent !== undefined) run.baselineContent = input.baselineContent;
    if (input.agentStartedAt !== undefined) run.agentStartedAt = input.agentStartedAt;
    if (input.agentCompletedAt !== undefined) run.agentCompletedAt = input.agentCompletedAt;
    if (input.toolCalls !== undefined) run.toolCalls = input.toolCalls;
    if (input.fileProposal !== undefined) {
        const proposalIndex = run.fileProposals.findIndex((proposal) => proposal.id === input.fileProposal?.id);
        if (proposalIndex >= 0) {
            run.fileProposals[proposalIndex] = input.fileProposal;
        } else {
            run.fileProposals = [input.fileProposal, ...run.fileProposals];
        }
    }
    if (input.resolveFileProposal !== undefined) {
        run.fileProposals = run.fileProposals.map((proposal) => proposal.id === input.resolveFileProposal?.id
            ? {
                ...proposal,
                status: input.resolveFileProposal.status,
                resolvedAt: input.resolveFileProposal.resolvedAt,
            }
            : proposal);
    }

    run.updatedAt = now;
    await writeWorkflowRun(project.root, run);
    return run;
}

/**
 * 安装内置的章节写作 workflow；已有同名文件时直接返回现有定义。
 */
export async function createDefaultWorkflow(projectPathInput: string): Promise<WorkflowDefinitionDto> {
    const project = resolveWorkflowProject(projectPathInput);
    const definition = defaultWorkflowDefinition();
    const filePath = workflowDefinitionFile(project.root, definition.id);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, yaml.stringify(definition), "utf-8");
    return definition;
}

/**
 * 读取单个 workflow 定义，供 run 创建前校验引用。
 */
export async function readProjectWorkflow(projectPathInput: string, workflowIdInput: string): Promise<WorkflowDefinitionDto> {
    const project = resolveWorkflowProject(projectPathInput);
    return readWorkflowDefinitionFile(workflowDefinitionFile(project.root, normalizeWorkflowId(workflowIdInput)));
}

/**
 * 列出指定 workflow 的历史运行记录，最新的记录排在前面。
 */
export async function listWorkflowRuns(projectPathInput: string, workflowIdInput: string): Promise<WorkflowRunListResponseDto> {
    const project = resolveWorkflowProject(projectPathInput);
    const workflowId = normalizeWorkflowId(workflowIdInput);
    await readProjectWorkflow(project.projectPath, workflowId);
    const runDir = workflowRunDirectory(project.root, workflowId);
    const entries = await fs.readdir(runDir, {withFileTypes: true}).catch((error: unknown) => {
        if (isNodeErrorCode(error, "ENOENT")) {
            return [];
        }
        throw error;
    });
    const runs: WorkflowRunDto[] = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
            runs.push(await readWorkflowRunFile(path.join(runDir, entry.name)));
        }
    }
    runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {projectPath: project.projectPath, workflowId, runs};
}

/**
 * 基于当前 workflow 定义创建一次新的运行记录。
 */
export async function startWorkflowRun(projectPathInput: string, workflowIdInput: string): Promise<WorkflowRunDto> {
    const project = resolveWorkflowProject(projectPathInput);
    const definition = await readProjectWorkflow(project.projectPath, workflowIdInput);
    const now = new Date().toISOString();
    const steps: WorkflowRunStepDto[] = definition.steps.map((step, index) => ({
        stepId: step.id,
        title: step.title,
        description: step.description,
        prompt: step.prompt,
        status: index === 0 ? "active" : "pending",
        note: "",
        startedAt: index === 0 ? now : null,
        completedAt: null,
    }));
    const run: WorkflowRunDto = {
        id: randomUUID(),
        workflowId: definition.id,
        projectPath: project.projectPath,
        status: "active",
        createdAt: now,
        updatedAt: now,
        steps,
        agentSessionId: null,
        targetFilePath: "",
        targetFileTitle: "",
        goal: "",
        baselineContent: null,
        agentStartedAt: null,
        agentCompletedAt: null,
        toolCalls: [],
        fileProposals: [],
    };
    await writeWorkflowRun(project.root, run);
    return run;
}

/**
 * 修改 workflow 运行中的单个步骤状态，并自动推进下一个 pending 步骤。
 */
export async function updateWorkflowRunStep(input: {
    projectPath: string;
    workflowId: string;
    runId: string;
    stepId: string;
    action: "complete" | "skip" | "reopen";
    note?: string;
}): Promise<WorkflowRunDto> {
    const project = resolveWorkflowProject(input.projectPath);
    const workflowId = normalizeWorkflowId(input.workflowId);
    await readProjectWorkflow(project.projectPath, workflowId);
    const runPath = workflowRunFile(project.root, workflowId, normalizeRunId(input.runId));
    const run = await readWorkflowRunFile(runPath);
    const target = run.steps.find((step) => step.stepId === input.stepId);
    if (!target) {
        throw createError({statusCode: 404, message: "Workflow step 不存在"});
    }
    const now = new Date().toISOString();
    if (input.action === "reopen") {
        for (const step of run.steps) {
            if (step.status === "active") {
                step.status = "pending";
                step.startedAt = null;
            }
        }
        target.status = "active";
        target.note = input.note ?? target.note;
        target.startedAt = now;
        target.completedAt = null;
        run.status = "active";
    } else {
        target.status = input.action === "complete" ? "completed" : "skipped";
        target.note = input.note ?? target.note;
        target.completedAt = now;
        if (!run.steps.some((step) => step.status === "active")) {
            const next = run.steps.find((step) => step.status === "pending");
            if (next) {
                next.status = "active";
                next.startedAt = now;
            }
        }
        run.status = run.steps.every((step) => step.status === "completed" || step.status === "skipped") ? "completed" : "active";
    }
    run.updatedAt = now;
    await writeWorkflowRun(project.root, run);
    return run;
}

/**
 * 解析并守卫当前 workflow 所属 Project Workspace。
 */
function resolveWorkflowProject(projectPathInput: string): {projectPath: string; root: string} {
    const projectPath = normalizeProjectPath(projectPathInput);
    assertProjectOpen(projectPath);
    markProjectActivity(projectPath);
    return {
        projectPath,
        root: resolveProjectAbsolutePath(projectPath),
    };
}

/**
 * 读取并校验 workflow YAML 定义文件。
 */
async function readWorkflowDefinitionFile(filePath: string): Promise<WorkflowDefinitionDto> {
    try {
        const parsed = yaml.parse(await fs.readFile(filePath, "utf-8")) as unknown;
        return WorkflowDefinitionDtoSchema.parse(parsed);
    } catch (error) {
        if (isNodeErrorCode(error, "ENOENT")) {
            throw createError({statusCode: 404, message: "Workflow 不存在"});
        }
        throw error;
    }
}

/**
 * 读取并校验 workflow 运行记录。
 */
async function readWorkflowRunFile(filePath: string): Promise<WorkflowRunDto> {
    try {
        const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
        return WorkflowRunDtoSchema.parse(parsed);
    } catch (error) {
        if (isNodeErrorCode(error, "ENOENT")) {
            throw createError({statusCode: 404, message: "Workflow run 不存在"});
        }
        throw error;
    }
}

/**
 * 写入 workflow run JSON 文件。
 */
async function writeWorkflowRun(projectRoot: string, run: WorkflowRunDto): Promise<void> {
    const filePath = workflowRunFile(projectRoot, run.workflowId, run.id);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf-8");
}

/**
 * 归一化 workflow id，避免文件路径越界。
 */
function normalizeWorkflowId(input: string): string {
    const id = input.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
        throw createError({statusCode: 400, message: "workflowId 不合法"});
    }
    return id;
}

/**
 * 归一化 workflow run id，避免用户输入影响文件路径。
 */
function normalizeRunId(input: string): string {
    const id = input.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
        throw createError({statusCode: 400, message: "runId 不合法"});
    }
    return id;
}

/**
 * 返回 workflow 定义文件路径。
 */
function workflowDefinitionFile(projectRoot: string, workflowId: string): string {
    return path.join(projectRoot, WORKFLOW_DEFINITION_DIR, `${normalizeWorkflowId(workflowId)}.yaml`);
}

/**
 * 返回 workflow 运行记录目录。
 */
function workflowRunDirectory(projectRoot: string, workflowId: string): string {
    return path.join(projectRoot, WORKFLOW_RUN_DIR, normalizeWorkflowId(workflowId));
}

/**
 * 返回 workflow run 文件路径。
 */
function workflowRunFile(projectRoot: string, workflowId: string, runId: string): string {
    return path.join(workflowRunDirectory(projectRoot, workflowId), `${normalizeRunId(runId)}.json`);
}

/**
 * 检查文件或目录是否存在。
 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isNodeErrorCode(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

/**
 * 判断 Node 文件系统错误码。
 */
function isNodeErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * 内置的章节写作运行记录定义。`chapter-draft` 仅作为历史 run 路径的内部 id 保留。
 */
function defaultWorkflowDefinition(): WorkflowDefinitionDto {
    return {
        id: "chapter-draft",
        title: "Writing Run",
        description: "记录章节写作运行、Agent 工具调用和正文 diff 提案。",
        version: 1,
        steps: [
            {
                id: "run",
                title: "Writing Run",
                kind: "manual",
                description: "由章节写作运行器创建，用于保存本轮写作记录。",
                prompt: "执行章节写作运行器中的本轮目标。",
            },
        ],
    };
    return {
        id: "chapter-draft",
        title: "Removed Checklist",
        description: "从准备、起草到回读的章节写作检查流程。",
        version: 1,
        steps: [
            {
                id: "scope",
                title: "确认章节目标",
                kind: "manual",
                description: "明确本章的视角、剧情目标、角色变化和必须隐藏的信息。",
                prompt: "写下本章要推进的核心问题，以及读者在章末应该知道什么。",
            },
            {
                id: "context",
                title: "检查上下文",
                kind: "manual",
                description: "确认剧情、世界状态、角色状态和上一章结尾没有冲突。",
                prompt: "检查 Plot、World Engine、Lorebook 和 Manuscript 当前章节前后的连续性。",
            },
            {
                id: "draft",
                title: "完成初稿",
                kind: "manual",
                description: "围绕章节目标写出完整初稿，先完成叙事闭环。",
                prompt: "记录初稿文件路径和本轮主要改动。",
            },
            {
                id: "review",
                title: "回读与修正",
                kind: "manual",
                description: "回读节奏、人物动机、伏笔兑现和信息泄露边界。",
                prompt: "列出需要继续修的点，或确认本章可以进入下一轮。",
            },
        ],
    };
}
