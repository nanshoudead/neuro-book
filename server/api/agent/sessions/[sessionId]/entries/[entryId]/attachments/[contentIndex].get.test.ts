import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/agent/sessions/:sessionId/entries/:entryId/attachments/:contentIndex", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("If-None-Match 命中时在 locator 授权后返回 304，且不读取 blob", async () => {
        const attachmentId = `sha256:${"a".repeat(64)}` as const;
        const resolveSessionAttachment = vi.fn(async () => ({
            ref: {id: attachmentId, mimeType: "image/png", bytes: 8},
            name: "cover.png",
        }));
        const load = vi.fn(async () => new Uint8Array());
        const setResponseHeader = vi.fn();
        const setResponseStatus = vi.fn();
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getRequestHeader: vi.fn(() => `"${attachmentId}"`),
            getRouterParam: vi.fn((_event: unknown, key: string) => key === "entryId" ? "entry-1" : "1"),
            setResponseHeader,
            setResponseStatus,
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            requireAgentSessionId: vi.fn(() => 12),
            useAgentHarness: vi.fn(() => ({
                resolveSessionAttachment,
                attachmentStore: {load},
            })),
        }));

        const event = {};
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;

        await expect(handler(event as never)).resolves.toBeNull();
        expect(resolveSessionAttachment).toHaveBeenCalledWith(12, "entry-1", 1);
        expect(load).not.toHaveBeenCalled();
        expect(setResponseStatus).toHaveBeenCalledWith(event, 304);
        expect(setResponseHeader).toHaveBeenCalledWith(event, "ETag", `"${attachmentId}"`);
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Cache-Control", "private, max-age=31536000, immutable");
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Server-Timing", expect.stringContaining("attachment_locator"));
    });

    it("经魔数验证的 raster 图片以内联响应返回", async () => {
        const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const setResponseHeader = vi.fn();
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getRequestHeader: vi.fn(() => undefined),
            getRouterParam: vi.fn((_event: unknown, key: string) => key === "entryId" ? "entry-image" : "2"),
            setResponseHeader,
            setResponseStatus: vi.fn(),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            requireAgentSessionId: vi.fn(() => 12),
            useAgentHarness: vi.fn(() => ({
                resolveSessionAttachment: vi.fn(async () => ({
                    ref: {id: `sha256:${"b".repeat(64)}`, mimeType: "image/png", bytes: bytes.byteLength},
                    name: "封面 图.png",
                })),
                attachmentStore: {load: vi.fn(async () => bytes)},
            })),
        }));

        const event = {};
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;
        const result = await handler(event as never);

        expect(Buffer.isBuffer(result)).toBe(true);
        expect(Buffer.from(result as Uint8Array)).toEqual(Buffer.from(bytes));
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Content-Type", "image/png");
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Content-Length", bytes.byteLength);
        expect(setResponseHeader).toHaveBeenCalledWith(event, "X-Content-Type-Options", "nosniff");
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Server-Timing", expect.stringContaining("attachment_blob"));
        expect(setResponseHeader).toHaveBeenCalledWith(
            event,
            "Content-Disposition",
            "inline; filename*=UTF-8''%E5%B0%81%E9%9D%A2%20%E5%9B%BE.png",
        );
    });

    it("非 raster MIME 强制使用 attachment disposition", async () => {
        const bytes = Buffer.from("<script>alert(1)</script>", "utf8");
        const setResponseHeader = vi.fn();
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getRequestHeader: vi.fn(() => undefined),
            getRouterParam: vi.fn((_event: unknown, key: string) => key === "entryId" ? "entry-text" : "0"),
            setResponseHeader,
            setResponseStatus: vi.fn(),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            requireAgentSessionId: vi.fn(() => 12),
            useAgentHarness: vi.fn(() => ({
                resolveSessionAttachment: vi.fn(async () => ({
                    ref: {id: `sha256:${"c".repeat(64)}`, mimeType: "text/html", bytes: bytes.byteLength},
                    name: "unsafe.html",
                })),
                attachmentStore: {load: vi.fn(async () => bytes)},
            })),
        }));

        const event = {};
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;
        await expect(handler(event as never)).resolves.toEqual(bytes);

        expect(setResponseHeader).toHaveBeenCalledWith(event, "Content-Type", "text/html");
        expect(setResponseHeader).toHaveBeenCalledWith(
            event,
            "Content-Disposition",
            "attachment; filename*=UTF-8''unsafe.html",
        );
    });

    it("无效 locator 返回 400 且禁止缓存错误", async () => {
        const setResponseHeader = vi.fn();
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getRouterParam: vi.fn((_event: unknown, key: string) => key === "entryId" ? "" : "-1"),
            setResponseHeader,
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            requireAgentSessionId: vi.fn(() => 12),
            useAgentHarness: vi.fn(),
        }));

        const event = {};
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;

        await expect(handler(event as never)).rejects.toMatchObject({statusCode: 400, data: {code: "INVALID_ATTACHMENT_LOCATOR"}});
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Cache-Control", "no-store");
    });

    it("blob 不可用返回 410 且禁止缓存错误", async () => {
        const setResponseHeader = vi.fn();
        vi.doMock("h3", async (importOriginal) => ({
            ...(await importOriginal<typeof import("h3")>()),
            getRequestHeader: vi.fn(() => undefined),
            getRouterParam: vi.fn((_event: unknown, key: string) => key === "entryId" ? "entry-image" : "0"),
            setResponseHeader,
            setResponseStatus: vi.fn(),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            requireAgentSessionId: vi.fn(() => 12),
            useAgentHarness: vi.fn(() => ({
                resolveSessionAttachment: vi.fn(async () => ({
                    ref: {id: `sha256:${"d".repeat(64)}`, mimeType: "image/png", bytes: 8},
                })),
                attachmentStore: {load: vi.fn(async () => { throw new Error("missing"); })},
            })),
        }));

        const event = {};
        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get")).default;

        await expect(handler(event as never)).rejects.toMatchObject({statusCode: 410, data: {code: "ATTACHMENT_UNAVAILABLE"}});
        expect(setResponseHeader).toHaveBeenCalledWith(event, "Cache-Control", "no-store");
    });
});
