import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createFileScope, resolveFileAddress} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";

describe("统一File Scope与File Address", () => {
    const workspaceRoot = absoluteFsPath(path.resolve(".agent", "file-scope", "workspace"));
    const projectRoot = path.join(workspaceRoot, "alpha");

    it("Project-bound scope以当前Project Workspace为普通相对路径根", () => {
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot,
            projectPath: normalizeProjectPath("workspace/alpha"),
        });

        expect(scope).toMatchObject({
            kind: "managed-project",
            root: projectRoot,
            workspaceRoot,
            currentProjectPath: "workspace/alpha",
        });
        expect(resolveFileAddress(scope, "lorebook/hero/index.md")).toEqual({
            kind: "scope-relative",
            absolutePath: path.join(projectRoot, "lorebook", "hero", "index.md"),
            projectPath: "workspace/alpha",
            relativePath: "lorebook/hero/index.md",
        });
    });

    it("完整Project File Address可显式访问当前或其他Project", () => {
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot,
            projectPath: normalizeProjectPath("workspace/alpha"),
        });

        expect(resolveFileAddress(scope, "workspace/beta/manuscript/001.md")).toEqual({
            kind: "project-address",
            absolutePath: path.join(workspaceRoot, "beta", "manuscript", "001.md"),
            projectPath: "workspace/beta",
            relativePath: "manuscript/001.md",
        });
        expect(() => resolveFileAddress(scope, "workspace/beta"))
            .toThrow("完整Project File Address必须使用workspace/<project>/<relative-path>");
        expect(() => resolveFileAddress(scope, "workspace//beta/manuscript/001.md"))
            .toThrow("完整Project File Address必须使用workspace/<project>/<relative-path>");
        expect(() => resolveFileAddress(scope, "workspace/beta/."))
            .toThrow("必须指向Project Workspace内的文件或目录项");
        expect(resolveFileAddress(scope, "workspace/beta/lorebook/../manuscript/002.md")).toEqual({
            kind: "project-address",
            absolutePath: path.join(workspaceRoot, "beta", "manuscript", "002.md"),
            projectPath: "workspace/beta",
            relativePath: "manuscript/002.md",
        });
    });

    it("拒绝旧slug-relative路径与相对路径越界", () => {
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot,
            projectPath: normalizeProjectPath("workspace/alpha"),
        });

        expect(() => resolveFileAddress(scope, "alpha/lorebook/hero/index.md"))
            .toThrow("不要重复添加alpha/前缀");
        expect(() => resolveFileAddress(scope, "../beta/manuscript/001.md"))
            .toThrow("越过文件系统根");
        expect(() => resolveFileAddress(scope, "workspace/beta/../alpha/manuscript/001.md"))
            .toThrow("越过文件系统根");
    });

    it("Workspace与user-assets scope保留各自普通相对根", () => {
        const workspaceScope = createFileScope({kind: "workspace", workspaceRoot});
        expect(resolveFileAddress(workspaceScope, ".nbook/config.json")).toMatchObject({
            kind: "scope-relative",
            absolutePath: path.join(workspaceRoot, ".nbook", "config.json"),
        });
        expect(() => resolveFileAddress(workspaceScope, "workspace/alpha"))
            .toThrow("完整Project File Address必须使用workspace/<project>/<relative-path>");

        const userAssetsRoot = absoluteFsPath(path.join(workspaceRoot, ".nbook"));
        const userAssetsScope = createFileScope({kind: "user-assets", root: userAssetsRoot});
        expect(resolveFileAddress(userAssetsScope, "agent/profiles/writer/profile.ts")).toMatchObject({
            kind: "scope-relative",
            absolutePath: path.join(userAssetsRoot, "agent", "profiles", "writer", "profile.ts"),
        });
    });

    it("外部Project scope保持绝对根且拒绝managed Project命名空间", () => {
        const externalRoot = absoluteFsPath(path.resolve(".agent", "external-project"));
        const scope = createFileScope({kind: "external-project", root: externalRoot});

        expect(resolveFileAddress(scope, "manuscript/001.md")).toMatchObject({
            kind: "scope-relative",
            absolutePath: path.join(externalRoot, "manuscript", "001.md"),
            projectPath: externalRoot,
        });
        expect(() => resolveFileAddress(scope, "workspace/alpha/manuscript/001.md"))
            .toThrow("外部 File Scope");
    });

    it("绝对File Address不伪造relativePath", () => {
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot,
            projectPath: normalizeProjectPath("workspace/alpha"),
        });
        const outside = absoluteFsPath(path.resolve(".agent", "outside.md"));

        expect(resolveFileAddress(scope, outside)).toEqual({
            kind: "absolute",
            absolutePath: outside,
            projectPath: null,
        });
        const inside = absoluteFsPath(path.join(scope.root, "manuscript", "001.md"));
        expect(resolveFileAddress(scope, inside)).toEqual({
            kind: "absolute",
            absolutePath: inside,
            projectPath: normalizeProjectPath("workspace/alpha"),
            relativePath: "manuscript/001.md",
        });
    });

    it("普通相对地址接受安全dot segment但只输出canonical路径", () => {
        const scope = createFileScope({
            kind: "managed-project",
            workspaceRoot,
            projectPath: normalizeProjectPath("workspace/alpha"),
        });

        expect(resolveFileAddress(scope, "lorebook/../manuscript/003.md")).toEqual({
            kind: "scope-relative",
            absolutePath: path.join(projectRoot, "manuscript", "003.md"),
            projectPath: "workspace/alpha",
            relativePath: "manuscript/003.md",
        });
        expect(resolveFileAddress(scope, "..draft/notes.md")).toMatchObject({
            absolutePath: path.join(projectRoot, "..draft", "notes.md"),
            relativePath: "..draft/notes.md",
        });
    });
});
