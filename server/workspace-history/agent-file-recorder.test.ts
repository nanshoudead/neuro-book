import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {createFileScope, resolveFileAddress} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {recordAgentWorkspaceWrite} from "nbook/server/workspace-history/agent-file-recorder";
import {
    ensureProjectHistory,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    workspaceHistoryResourceOwner,
} from "nbook/server/workspace-history/project-history";

describe("recordAgentWorkspaceWrite 归因记账", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(workspaceHistoryResourceOwner);
        setHistoryEnabledOverrideForTest(true);
        tempRoot = join(os.tmpdir(), `neuro-book-agent-recorder-test-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    });

    afterEach(async () => {
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    it("写入归因 agent + String(sessionId)，删除记 before 快照，未 open 项目静默跳过", async () => {
        const projectPath = normalizeProjectPath("workspace/attribution");
        await writeProjectManifest(workspaceRoot, projectPath, {kind: "novel", title: "attribution", summary: ""});
        await openProjectForTest(projectPath);

        const scope = createFileScope({kind: "managed-project", workspaceRoot, projectPath});
        const address = resolveFileAddress(scope, "manuscript/ch1.md");
        await recordAgentWorkspaceWrite({sessionId: 42, workspaceRoot, address, before: null, after: "v1"});
        await recordAgentWorkspaceWrite({sessionId: 42, workspaceRoot, address, before: "v1", after: null});

        const history = (await ensureProjectHistory(resolveProjectWorkspaceRoot(workspaceRoot, projectPath), projectPath))!;
        const timeline = await history.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.delete"]);
        expect(timeline[0]!.entry.actor).toEqual({kind: "agent", sessionId: "42"});

        // 未 open 的项目：反推成功但 record 静默跳过（fail-open）
        await recordAgentWorkspaceWrite({
            sessionId: 42, workspaceRoot,
            address: resolveFileAddress(scope, "workspace/not-open/manuscript/x.md"),
            before: null, after: "x",
        });
        const notOpenProjectPath = normalizeProjectPath("workspace/not-open");
        expect(await ensureProjectHistory(resolveProjectWorkspaceRoot(workspaceRoot, notOpenProjectPath), notOpenProjectPath)).toBeNull();
    });

    it("显式跨Project地址直接按ResolvedFileAddress归入目标Project", async () => {
        const currentProjectPath = normalizeProjectPath("workspace/current");
        const targetProjectPath = normalizeProjectPath("workspace/target");
        await writeProjectManifest(workspaceRoot, currentProjectPath, {kind: "novel", title: "current", summary: ""});
        await writeProjectManifest(workspaceRoot, targetProjectPath, {kind: "novel", title: "target", summary: ""});
        await openProjectForTest(currentProjectPath);
        await openProjectForTest(targetProjectPath);
        const scope = createFileScope({kind: "managed-project", workspaceRoot, projectPath: currentProjectPath});
        const address = resolveFileAddress(scope, "workspace/target/lorebook/npc.md");

        await recordAgentWorkspaceWrite({sessionId: 7, workspaceRoot, address, before: null, after: "npc"});

        const targetHistory = (await ensureProjectHistory(
            resolveProjectWorkspaceRoot(workspaceRoot, targetProjectPath),
            targetProjectPath,
        ))!;
        expect((await targetHistory.timeline("lorebook/npc.md"))[0]?.entry.actor)
            .toEqual({kind: "agent", sessionId: "7"});
        const currentHistory = (await ensureProjectHistory(
            resolveProjectWorkspaceRoot(workspaceRoot, currentProjectPath),
            currentProjectPath,
        ))!;
        expect(await currentHistory.timeline("lorebook/npc.md")).toEqual([]);
    });
});
