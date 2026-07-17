import {Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";

describe("GET /api/workspace-files/download", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("只按 projectPath 解析 Project Workspace，忽略 root 查询参数", async () => {
        const target = {
            kind: "project-workspace" as const,
            root: absoluteFsPath("C:/test/workspace/novel-1"),
            projectPath: normalizeProjectPath("workspace/novel-1"),
        };
        const resolveWorkspaceFileTarget = vi.fn(async () => target);
        const createWorkspaceZipStream = vi.fn(async () => ({
            root: target.root,
            filename: "novel-1.zip",
            stream: Readable.from([]),
        }));

        vi.stubGlobal("getQuery", () => ({
            projectPath: "workspace/novel-1",
            root: "server",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn((_event, stream) => stream),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget,
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
        }));
        vi.doMock("nbook/server/runtime/paths/runtime-paths", () => ({runtimePathsFromEnv: vi.fn(() => ({}))}));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createWorkspaceZipStream,
        }));
        vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
            assertProjectOpenForTarget: vi.fn(),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await handler({} as never);

        expect(resolveWorkspaceFileTarget).toHaveBeenCalledWith(expect.anything(), {
            projectPath: "workspace/novel-1",
            workspaceKind: undefined,
        });
        expect(createWorkspaceZipStream).toHaveBeenCalledWith(target.root);
    });

    it("缺少 projectPath 时拒绝下载", async () => {
        vi.stubGlobal("getQuery", () => ({
            root: "workspace/novel-1",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn(),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceFileTarget: vi.fn(),
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
        }));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createWorkspaceZipStream: vi.fn(),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "projectPath 不能为空",
        });
    });
});
