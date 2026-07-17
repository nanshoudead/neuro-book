import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    InvalidProjectPathError,
    normalizeProjectPath,
    projectSlug,
    resolveProjectWorkspaceInput,
    resolveProjectWorkspaceRoot,
} from "nbook/server/workspace-files/project-path";

describe("Project Path Module", () => {
    it("规范化公开Project Path并解析Project Slug", () => {
        const projectPath = normalizeProjectPath("workspace\\alpha");

        expect(projectPath).toBe("workspace/alpha");
        expect(projectSlug(projectPath)).toBe("alpha");
    });

    it("拒绝Workspace Root、嵌套目录、空segment和路径越界", () => {
        for (const input of [
            "workspace",
            "workspace/alpha/",
            "workspace//alpha",
            "workspace/alpha/manuscript",
            "workspace/../outside",
            "../workspace/alpha",
            "workspace/name\nbad",
        ]) {
            expect(() => normalizeProjectPath(input)).toThrow(InvalidProjectPathError);
        }
        try {
            normalizeProjectPath("workspace");
        } catch (error) {
            expect(error).toMatchObject({statusCode: 400});
        }
    });

    it("使用Windows与POSIX一致的可落盘slug规则", () => {
        expect(normalizeProjectPath("workspace/foo..bar")).toBe("workspace/foo..bar");
        expect(normalizeProjectPath("workspace/My Project")).toBe("workspace/My Project");

        for (const input of [
            "workspace/.",
            "workspace/..",
            "workspace/CON",
            "workspace/con.txt",
            "workspace/LPT1.log",
            "workspace/name.",
            "workspace/name ",
            "workspace/name<bad",
            "workspace/name|bad",
            "workspace/name\u0000bad",
        ]) {
            expect(() => normalizeProjectPath(input)).toThrow(InvalidProjectPathError);
        }
    });

    it("只相对显式Workspace Root解析物理Project Workspace", () => {
        const workspaceRoot = absoluteFsPath(path.resolve(".agent", "project-path", "workspace"));
        const projectPath = normalizeProjectPath("workspace/alpha");

        expect(resolveProjectWorkspaceRoot(workspaceRoot, projectPath))
            .toBe(path.join(workspaceRoot, "alpha"));
        expect(resolveProjectWorkspaceInput(workspaceRoot, "workspace/alpha"))
            .toBe(path.join(workspaceRoot, "alpha"));
        const externalRoot = path.resolve(".agent", "external-project");
        expect(resolveProjectWorkspaceInput(workspaceRoot, externalRoot)).toBe(externalRoot);
    });
});
