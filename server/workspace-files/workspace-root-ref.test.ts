import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    normalizeWorkspaceRootRef,
    resolveWorkspaceRootRef,
} from "nbook/server/workspace-files/workspace-root-ref";

describe("Workspace Root Reference", () => {
    it("规范化managed引用和当前Project Path", () => {
        expect(normalizeWorkspaceRootRef(undefined)).toBe("workspace");
        expect(normalizeWorkspaceRootRef("workspace")).toBe("workspace");
        expect(normalizeWorkspaceRootRef("workspace/demo", "workspace/demo")).toBe("workspace");
        expect(normalizeWorkspaceRootRef("workspace/.nbook")).toBe("workspace/.nbook");
    });

    it("保留外部绝对根并拒绝未知相对路径", () => {
        const externalRoot = resolve(".agent", "external-project");
        expect(normalizeWorkspaceRootRef(externalRoot)).toBe(externalRoot);
        expect(normalizeWorkspaceRootRef(externalRoot, externalRoot)).toBe(externalRoot);
        expect(normalizeWorkspaceRootRef(undefined, externalRoot)).toBe(externalRoot);
        expect(() => normalizeWorkspaceRootRef("relative/project")).toThrow("只支持workspace");
    });

    it("只按调用方给出的managed Workspace Root解析物理根", () => {
        const workspaceRoot = absoluteFsPath(resolve(".agent", "workspace-root-ref", "data", "workspace"));
        expect(resolveWorkspaceRootRef("workspace", workspaceRoot)).toBe(workspaceRoot);
        expect(resolveWorkspaceRootRef("workspace/.nbook", workspaceRoot)).toBe(resolve(workspaceRoot, ".nbook"));
        const externalRoot = normalizeWorkspaceRootRef(resolve(".agent", "external-project"));
        expect(resolveWorkspaceRootRef(externalRoot, workspaceRoot)).toBe(externalRoot);
    });
});
