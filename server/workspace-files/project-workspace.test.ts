import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";

describe("assertProjectWorkspaceDirectory", () => {
    it("旧链接指向已不存在 Project 时返回稳定 404", async () => {
        const projectPath = `workspace/missing-${randomUUID()}`;

        await expect(assertProjectWorkspaceDirectory(projectPath)).rejects.toMatchObject({
            statusCode: 404,
            message: "Project Workspace 不存在",
        });
    });
});
