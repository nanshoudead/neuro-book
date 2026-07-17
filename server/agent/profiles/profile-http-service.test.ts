import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Type} from "typebox";
import {afterEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const roots: string[] = [];
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

afterEach(async () => {
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Profile prepare preview物理Workspace Root", () => {
    it("managed、user-assets与external Project session使用各自真实物理root", async () => {
        const fixture = await fixtureRoot();
        const applicationRoot = absoluteFsPath(path.join(fixture, "application"));
        const stateRoot = absoluteFsPath(path.join(fixture, "state"));
        const runtimePaths = createRuntimePaths({applicationRoot, stateRoot});
        const externalProjectRoot = absoluteFsPath(path.join(fixture, "external-project"));
        await Promise.all([
            mkdir(applicationRoot, {recursive: true}),
            mkdir(runtimePaths.workspaceRoot, {recursive: true}),
            mkdir(externalProjectRoot, {recursive: true}),
        ]);
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;

        const repo = new JsonlSessionRepository(runtimePaths.workspaceRoot);
        const harness = new NeuroAgentHarness({
            runtimePaths,
            repo,
            profiles: new AgentProfileCatalog(
                path.join(fixture, "missing-system-profiles"),
                path.join(fixture, "missing-user-profiles"),
            ),
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.preview-path", name: "Preview Path"},
            initialSchema: Type.Object({}),
            tools: {},
            prepare({session}) {
                return {
                    systemPrompt: JSON.stringify({
                        workspaceRoot: session.workspaceRoot,
                        workspaceFsRoot: session.workspaceFsRoot,
                    }),
                };
            },
        }), false);

        try {
            const managed = await repo.createSession({
                profileKey: "test.preview-path",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "managed",
            });
            const userAssets = await repo.createSession({
                profileKey: "test.preview-path",
                initial: {},
                workspaceRoot: "workspace/.nbook",
                workspaceKey: "user-assets",
            });
            const external = await repo.createSession({
                profileKey: "test.preview-path",
                initial: {},
                workspaceRoot: externalProjectRoot,
                workspaceKey: "external",
                projectPath: externalProjectRoot,
            });

            await expectPreviewRoot(harness, managed.metadata.sessionId, "workspace", runtimePaths.workspaceRoot);
            await expectPreviewRoot(harness, userAssets.metadata.sessionId, "workspace/.nbook", runtimePaths.userNbookRoot);
            await expectPreviewRoot(harness, external.metadata.sessionId, externalProjectRoot, externalProjectRoot);
        } finally {
            await harness.dispose();
        }
    });
});

/** 断言prepare preview看到的逻辑引用与物理root。 */
async function expectPreviewRoot(
    harness: NeuroAgentHarness,
    sessionId: number,
    expectedRef: string,
    expectedFsRoot: string,
): Promise<void> {
    const preview = await previewAgentProfilePrepare(harness, {
        profileKey: "test.preview-path",
        sessionId: String(sessionId),
    });
    expect(preview.ok).toBe(true);
    const systemPrompt = preview.messages.find((message) => message.role === "systemPrompt");
    expect(JSON.parse(systemPrompt?.text ?? "null")).toEqual({
        workspaceRoot: expectedRef,
        workspaceFsRoot: expectedFsRoot,
    });
}

/** 创建隔离Runtime fixture。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-profile-preview-path-"));
    roots.push(root);
    return root;
}

/** 恢复单个运行时环境变量。 */
function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
