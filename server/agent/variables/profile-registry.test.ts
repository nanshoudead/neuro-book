import path from "node:path";
import {Type} from "typebox";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const loadCompiledVariableDefinitions = vi.hoisted(() => vi.fn(async () => ({definitions: [], issues: []})));

vi.mock("nbook/server/agent/variables/definition-artifact", () => ({
    loadCompiledVariableDefinitions,
}));

import {createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";

const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

afterEach(() => {
    loadCompiledVariableDefinitions.mockClear();
    if (originalStateRoot === undefined) {
        delete process.env.NEURO_BOOK_STATE_ROOT;
    } else {
        process.env.NEURO_BOOK_STATE_ROOT = originalStateRoot;
    }
});

describe("Session Variable Registry路径", () => {
    it("Global与managed Project定义共用调用方注入的Runtime Workspace Root", async () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "variable-registry-runtime", "workspace"));
        process.env.NEURO_BOOK_STATE_ROOT = path.resolve(".agent", "unrelated-state-root");
        const profile = defineAgentProfile({
            manifest: {key: "test.variable-registry", name: "Variable Registry"},
            initialSchema: Type.Object({}),
            tools: {},
            prepare() {
                return {};
            },
        });

        await createVariableRegistryForSession({
            profile,
            globalWorkspaceRoot: workspaceRoot,
            currentProjectWorkspace: "workspace/project-a",
        });

        expect(loadCompiledVariableDefinitions).toHaveBeenNthCalledWith(1, {
            definitionRoot: path.join(workspaceRoot, ".nbook", "agent", "variables"),
            namespace: "global",
        });
        expect(loadCompiledVariableDefinitions).toHaveBeenNthCalledWith(2, {
            definitionRoot: path.join(workspaceRoot, "project-a", ".nbook", "agent", "variables"),
            namespace: "project",
        });
    });
});
