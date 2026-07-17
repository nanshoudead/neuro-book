import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";
import {resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";

describe("Agent session File Scope Adapter", () => {
    it("Project session选择当前Project Workspace作为cwd", () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "session-scope", "workspace"));
        expect(resolveSessionFileScope({
            workspaceRootRef: "workspace",
            workspaceFsRoot: workspaceRoot,
            projectPath: "workspace/alpha",
        })).toEqual({
            kind: "managed-project",
            root: path.join(workspaceRoot, "alpha"),
            workspaceRoot,
            currentProjectPath: "workspace/alpha",
        });
    });

    it("user-assets与外部Project不伪造managed Workspace Root", () => {
        const userAssetsRoot = absoluteFsPath(path.resolve(".agent", "session-scope", "workspace", ".nbook"));
        expect(resolveSessionFileScope({
            workspaceRootRef: "workspace/.nbook",
            workspaceFsRoot: userAssetsRoot,
        }).workspaceRoot).toBeNull();

        const externalRoot = absoluteFsPath(path.resolve(".agent", "session-scope", "external"));
        expect(resolveSessionFileScope({
            workspaceRootRef: externalRoot as WorkspaceRootRef,
            workspaceFsRoot: externalRoot,
            projectPath: externalRoot,
        })).toEqual({
            kind: "external-project",
            root: externalRoot,
            workspaceRoot: null,
            currentProjectPath: externalRoot,
        });
    });

    it("拒绝互相矛盾的Workspace Root Reference与Project Path", () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "session-scope", "workspace"));
        const externalRoot = absoluteFsPath(path.resolve(".agent", "session-scope", "external"));

        expect(() => resolveSessionFileScope({
            workspaceRootRef: "workspace",
            workspaceFsRoot: workspaceRoot,
            projectPath: externalRoot,
        })).toThrow("不能绑定外部绝对Project Workspace");
        expect(() => resolveSessionFileScope({
            workspaceRootRef: externalRoot as WorkspaceRootRef,
            workspaceFsRoot: externalRoot,
            projectPath: "workspace/alpha",
        })).toThrow("引用与Project Path不一致");
    });
});
