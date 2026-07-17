import {beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";

describe("GET /api/workspace-files/read", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("getQuery", () => ({
            projectPath: "workspace/not-open",
            path: "note.md",
        }));
    });

    it("Project root 未 open 时返回 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(async () => ({
                kind: "project-workspace",
                root: absoluteFsPath("C:/test/workspace/not-open"),
                projectPath: normalizeProjectPath("workspace/not-open"),
            })),
        }));

        const handler = (await import("nbook/server/api/workspace-files/read.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/not-open",
            },
        });
    });
});
