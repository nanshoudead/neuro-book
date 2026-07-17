import {
    CreateNovelRequestDtoSchema,
    type CreateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {invalidateNovelListCache, toNovelResponse, validateBody} from "nbook/server/utils/novel-chapter";
import {buildWorkspaceSlugBase, copyNovelDirectoryTemplate} from "nbook/server/workspace-files/novel-workspace";
import {initProjectDatabase, listProjectWorkspaces, projectWorkspaceDirectoryExists, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";

/**
 * 新建 Project Workspace。
 */
export default defineEventHandler(async (event) => {
    const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
    const body = await validateBody<CreateNovelRequestDto>(event, CreateNovelRequestDtoSchema);
    const projectPath = await allocateProjectPath(workspaceRoot, body.title);
    const now = new Date().toISOString();

    await writeProjectManifest(workspaceRoot, projectPath, {
        kind: "novel",
        title: body.title,
        summary: body.summary ?? "",
    });
    await copyNovelDirectoryTemplate(resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath)));
    await initProjectDatabase(workspaceRoot, projectPath);
    invalidateNovelListCache();

    return toNovelResponse({
        projectPath,
        title: body.title,
        summary: body.summary ?? "",
        updatedAt: now,
    });
});

async function allocateProjectPath(workspaceRoot: AbsoluteFsPath, title: string): Promise<string> {
    const base = buildWorkspaceSlugBase(title);
    const existing = new Set((await listProjectWorkspaces(workspaceRoot)).map((project) => project.projectPath));
    let suffix = 0;
    while (true) {
        const slug = suffix === 0 ? base : `${base}-${String(suffix + 1)}`;
        const projectPath = `workspace/${slug}`;
        if (!existing.has(projectPath) && !(await projectWorkspaceDirectoryExists(workspaceRoot, projectPath))) {
            return projectPath;
        }
        suffix += 1;
    }
}
