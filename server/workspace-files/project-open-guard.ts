import {createError} from "h3";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {assertManagedProjectDataPlaneOpen} from "nbook/server/workspace-files/project-data-plane-guard";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";

/**
 * 路由层Project open守卫：只有明确的Project Workspace目标需要显式open。
 */
export function assertProjectOpenForTarget(target: WorkspaceFileTarget): void {
    try {
        if (target.kind === "project-workspace") {
            assertManagedProjectDataPlaneOpen(target.projectPath);
        }
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}
/**
 * 将 ProjectSession typed error 映射为稳定 HTTP 409，供 Nitro route handler 返回给前端。
 */
export function createProjectNotOpenHttpError(error: ProjectNotOpenError): Error {
    return createError({
        statusCode: 409,
        statusMessage: "Project not open",
        message: error.message,
        data: {
            code: "PROJECT_NOT_OPEN",
            projectPath: error.projectPath,
        },
    });
}

/**
 * 路由层 typed error wrapper：业务层只抛 ProjectNotOpenError，HTTP 层统一映射为稳定 409。
 */
export async function withProjectNotOpenHttpError<T>(handler: () => Promise<T> | T): Promise<T> {
    try {
        return await handler();
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}
