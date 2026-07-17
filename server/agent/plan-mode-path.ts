import {join, normalize, relative} from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";
import {resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";

/**
 * Project Workspace 内 Plan Mode 计划目录的固定相对路径。
 */
export const PLAN_MODE_DIRECTORY = ".agent/plan";

export type PlanModeLocationInput = {
    workspaceRootRef: WorkspaceRootRef;
    workspaceFsRoot: AbsoluteFsPath;
    /** 为空表示当前session没有绑定Project Workspace，回退到物理Workspace Root。 */
    projectPath?: string;
};

/**
 * 返回当前 Project Workspace 的 Plan Mode 计划目录。
 */
export function planModeDirectory(input: PlanModeLocationInput): string {
    return join(planModeProjectRoot(input), ".agent", "plan");
}

/**
 * 返回 Agent 文件工具可使用的 Plan Mode 目录路径。
 */
export function planModeToolDirectory(input: PlanModeLocationInput): string {
    return PLAN_MODE_DIRECTORY;
}

/**
 * 将计划文件路径解析为 Project Workspace 内的安全 Markdown 文件。
 */
export function resolvePlanModeFile(input: PlanModeLocationInput & {planFilePath: string}): {
    displayPath: string;
    absolutePath: string;
} {
    const normalizedInput = input.planFilePath.trim().replace(/\\/g, "/");
    if (!normalizedInput) {
        throw new Error("switch_mode planFilePath cannot be empty.");
    }
    if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
        throw new Error("switch_mode planFilePath must be relative to the Project Workspace.");
    }
    if (normalizedInput.split("/").includes("..")) {
        throw new Error("switch_mode planFilePath cannot contain '..'.");
    }
    if (!normalizedInput.toLowerCase().endsWith(".md")) {
        throw new Error("switch_mode planFilePath must point to a Markdown .md file.");
    }

    const projectRoot = planModeProjectRoot(input);
    const planRoot = normalize(planModeDirectory(input));
    const absolutePath = normalize(join(projectRoot, normalizedInput));
    const relativeToPlanRoot = relative(planRoot, absolutePath);
    if (relativeToPlanRoot.startsWith("..") || relativeToPlanRoot === "" || relativeToPlanRoot.startsWith("/") || /^[A-Za-z]:/.test(relativeToPlanRoot)) {
        throw new Error(`switch_mode planFilePath must stay inside ${PLAN_MODE_DIRECTORY}/.`);
    }

    return {
        displayPath: normalizedInput,
        absolutePath,
    };
}

function planModeProjectRoot(input: PlanModeLocationInput): string {
    return resolveSessionFileScope(input).root;
}
