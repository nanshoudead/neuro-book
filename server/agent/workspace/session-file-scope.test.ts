import path from "node:path";
import {mkdtemp, mkdir, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";
import {assertSessionFileScope, resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";

describe("Agent session File Scope Adapter", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

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

    it("持久化前拒绝managed Project根链接并允许明确外部Project", async () => {
        const fixture = await mkdtemp(path.join(tmpdir(), "nbook-session-scope-"));
        roots.push(fixture);
        const workspaceRoot = absoluteFsPath(path.join(fixture, "workspace"));
        const projectRoot = path.join(workspaceRoot, "alpha");
        const externalRoot = absoluteFsPath(path.join(fixture, "external"));
        await Promise.all([
            mkdir(workspaceRoot, {recursive: true}),
            mkdir(projectRoot, {recursive: true}),
            mkdir(externalRoot, {recursive: true}),
        ]);

        await expect(assertSessionFileScope({
            workspaceRootRef: "workspace",
            workspaceFsRoot: workspaceRoot,
            projectPath: "workspace/alpha",
        })).resolves.toMatchObject({kind: "managed-project", root: projectRoot});

        await rm(projectRoot, {recursive: true});
        await symlink(externalRoot, projectRoot, process.platform === "win32" ? "junction" : "dir");
        await expect(assertSessionFileScope({
            workspaceRootRef: "workspace",
            workspaceFsRoot: workspaceRoot,
            projectPath: "workspace/alpha",
        })).rejects.toThrow("不能是symlink或junction");

        await expect(assertSessionFileScope({
            workspaceRootRef: externalRoot as WorkspaceRootRef,
            workspaceFsRoot: externalRoot,
            projectPath: externalRoot,
        })).resolves.toMatchObject({kind: "external-project", root: externalRoot});
    });
});
