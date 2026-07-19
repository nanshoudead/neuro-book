import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {authorizeFileOperation, authorizeProcessCwd} from "nbook/server/workspace-files/authorized-file-operation";
import {createFileScope} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {closeProject, openProject, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";

describe("Authorized File Operation", () => {
    const roots: string[] = [];
    const openedProjects = new Set<string>();

    afterEach(async () => {
        for (const projectPath of openedProjects) {
            await closeProject(projectPath, "shutdown").catch(() => undefined);
        }
        openedProjects.clear();
        for (const root of roots.splice(0)) {
            await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
        }
    });

    it("read/write/edit 共用真实路径 containment，拒绝父目录 junction 逃逸", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = join(root, "workspace");
        const outsideRoot = join(root, "outside");
        await mkdir(workspaceRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await writeFile(join(outsideRoot, "secret.md"), "secret", "utf8");
        await symlink(outsideRoot, join(workspaceRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
        const scope = createFileScope({kind: "workspace", workspaceRoot: absoluteFsPath(workspaceRoot)});

        for (const operation of ["read", "write", "edit"] as const) {
            await expect(authorizeFileOperation(scope, "escape/secret.md", operation))
                .rejects.toThrow("真实路径越过文件系统根");
        }
    });

    it("managed Project 数据面未 open 时失败，open 后允许文件与 bash cwd", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = join(root, "workspace");
        const projectPath = normalizeProjectPath("workspace/novel");
        await mkdir(join(workspaceRoot, "novel"), {recursive: true});
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot: absoluteFsPath(workspaceRoot),
            projectPath,
        });

        await expect(authorizeFileOperation(scope, "manuscript/chapter.md", "write"))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
        await openProject(absoluteFsPath(workspaceRoot), projectPath, {kind: "job", source: "authorized-file-operation-test"});
        openedProjects.add(projectPath);

        await expect(authorizeFileOperation(scope, "manuscript/chapter.md", "write")).resolves.toMatchObject({
            address: {projectPath, relativePath: "manuscript/chapter.md"},
        });
        await expect(authorizeProcessCwd(scope)).resolves.toMatchObject({root: join(workspaceRoot, "novel")});
    });

    it("跨 Project File Address 要求当前和目标 Project 都已 open", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = join(root, "workspace");
        await mkdir(join(workspaceRoot, "alpha"), {recursive: true});
        await mkdir(join(workspaceRoot, "beta"), {recursive: true});
        const alpha = normalizeProjectPath("workspace/alpha");
        const beta = normalizeProjectPath("workspace/beta");
        const scope = createFileScope({kind: "managed-project", workspaceRoot: absoluteFsPath(workspaceRoot), projectPath: alpha});
        await openProject(absoluteFsPath(workspaceRoot), alpha, {kind: "job", source: "authorized-file-operation-test"});
        openedProjects.add(alpha);

        await expect(authorizeFileOperation(scope, "workspace/beta/lorebook/index.md", "read"))
            .rejects.toMatchObject({projectPath: beta});
        await openProject(absoluteFsPath(workspaceRoot), beta, {kind: "job", source: "authorized-file-operation-test"});
        openedProjects.add(beta);
        await expect(authorizeFileOperation(scope, "workspace/beta/lorebook/index.md", "write"))
            .resolves.toMatchObject({address: {projectPath: beta, relativePath: "lorebook/index.md"}});
    });

    it("managed Project拒绝用绝对路径或真实路径链接绕过跨Project地址", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = join(root, "workspace");
        const alphaRoot = join(workspaceRoot, "alpha");
        const betaRoot = join(workspaceRoot, "beta");
        await mkdir(alphaRoot, {recursive: true});
        await mkdir(join(betaRoot, "lorebook"), {recursive: true});
        await writeFile(join(betaRoot, "lorebook", "index.md"), "beta", "utf8");
        await symlink(betaRoot, join(alphaRoot, "linked-beta"), process.platform === "win32" ? "junction" : "dir");
        const alpha = normalizeProjectPath("workspace/alpha");
        const beta = normalizeProjectPath("workspace/beta");
        const scope = createFileScope({kind: "managed-project", workspaceRoot: absoluteFsPath(workspaceRoot), projectPath: alpha});
        await openProject(absoluteFsPath(workspaceRoot), alpha, {kind: "job", source: "authorized-file-operation-test"});
        await openProject(absoluteFsPath(workspaceRoot), beta, {kind: "job", source: "authorized-file-operation-test"});
        openedProjects.add(alpha);
        openedProjects.add(beta);

        await expect(authorizeFileOperation(scope, join(betaRoot, "lorebook", "index.md"), "read"))
            .rejects.toThrow("绝对路径只能指向当前Project Workspace");
        await expect(authorizeFileOperation(scope, "linked-beta/lorebook/index.md", "read"))
            .rejects.toThrow("真实路径越过文件系统根");
    });

    async function temporaryRoot(): Promise<string> {
        const root = await mkdtemp(join(tmpdir(), "nbook-authorized-file-operation-"));
        roots.push(root);
        return root;
    }
});
