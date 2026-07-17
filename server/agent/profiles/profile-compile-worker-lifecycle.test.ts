import {randomUUID} from "node:crypto";
import {cp, mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {ProfileCompileWorkerService} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile} from "nbook/server/agent/profiles/profile-compile-worker-runtime";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {withIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";

describe("profile compile worker Project lifecycle", () => {
    it("worker runtime 将 Project lifecycle error 返回为内部字段", async () => {
        await withWriterProfile(async (assets) => {
            const {projectPath, sessionId} = await createUnopenedProjectSession(assets);
            const fileName = "builtin/writer.profile.tsx";
            const source = await readFile(profilePath(assets, fileName), "utf8");

            const result = await runProfileCompile({
                fileName,
                source,
                dryRun: true,
                preview: true,
                sessionId: String(sessionId),
                userProfileRoot: assets.userProfileRoot,
            });

            expect(result.lifecycleError).toEqual({
                code: "PROJECT_NOT_OPEN",
                projectPath,
            });
            expect(result.issues).toEqual([]);
            await expect(readFile(join(
                assets.workspaceContainerRoot,
                projectPath.slice("workspace/".length),
                "agents",
                "writer",
                "home.json",
            ), "utf8")).rejects.toMatchObject({code: "ENOENT"});
        });
    }, 120_000);

    it("worker service 将 Project lifecycle error 重新抛为 ProjectNotOpenError", async () => {
        await withWriterProfile(async (assets) => {
            const {projectPath, sessionId} = await createUnopenedProjectSession(assets);
            const fileName = "builtin/writer.profile.tsx";
            const source = await readFile(profilePath(assets, fileName), "utf8");
            const worker = new ProfileCompileWorkerService("test-project-lifecycle-error", 1, undefined, assets.userProfileRoot);
            try {
                try {
                    await worker.compile({
                        fileName,
                        source,
                        dryRun: true,
                        preview: true,
                        sessionId: String(sessionId),
                    });
                    throw new Error("Expected ProjectNotOpenError");
                } catch (error) {
                    expect(error).toBeInstanceOf(ProjectNotOpenError);
                    expect(error).toMatchObject({projectPath});
                }
            } finally {
                worker.dispose();
            }
        });
    }, 120_000);
});

/** 使用隔离Workspace Root和单一Writer源码运行生命周期测试。 */
async function withWriterProfile(run: (assets: IsolatedWorkspaceAssets) => Promise<void>): Promise<void> {
    await withIsolatedWorkspaceAssets({seedUserAssets: false, useAsCwd: true}, async (assets) => {
        const fileName = "builtin/writer.profile.tsx";
        const target = resolve(assets.userProfileRoot, fileName);
        await mkdir(dirname(target), {recursive: true});
        await cp(resolve(assets.systemProfileRoot, fileName), target, {force: true});
        await run(assets);
    });
}

/** 创建未打开的Project-bound session。 */
async function createUnopenedProjectSession(assets: IsolatedWorkspaceAssets): Promise<{projectPath: string; sessionId: number}> {
    const slug = `profile-lifecycle-${randomUUID()}`;
    const projectPath = `workspace/${slug}`;
    const projectRoot = join(assets.workspaceContainerRoot, slug);
    await mkdir(projectRoot, {recursive: true});
    await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Profile Lifecycle\nsummary: ''\n", "utf8");
    const snapshot = await new JsonlSessionRepository(assets.workspaceContainerRoot).createSession({
        profileKey: "writer",
        initial: {},
        workspaceRoot: "workspace",
        projectPath,
    });
    return {projectPath, sessionId: snapshot.metadata.sessionId};
}

/** 返回隔离用户Profile的物理路径。 */
function profilePath(assets: IsolatedWorkspaceAssets, fileName: string): string {
    return resolve(assets.userProfileRoot, ...fileName.split("/"));
}
