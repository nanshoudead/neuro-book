import {createError, getRequestHeader, getRouterParam, setResponseHeader, setResponseStatus} from "h3";
import {canonicalImageMime, imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {requireAgentSessionId, useAgentHarness} from "nbook/server/agent/http";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 按公开 Chat Flow locator 返回完整 Attachment；hash 本身不构成授权。 */
export default defineEventHandler(async (event) => withProjectNotOpenHttpError(async () => {
    const startedAt = performance.now();
    const sessionId = requireAgentSessionId(event);
    const entryId = getRouterParam(event, "entryId");
    const contentIndex = Number(getRouterParam(event, "contentIndex"));
    if (!entryId || !Number.isSafeInteger(contentIndex) || contentIndex < 0 || contentIndex > 1024) {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 400, message: "Attachment locator 无效", data: {code: "INVALID_ATTACHMENT_LOCATOR"}});
    }

    const harness = useAgentHarness();
    let locator: Awaited<ReturnType<typeof harness.resolveSessionAttachment>>;
    try {
        locator = await harness.resolveSessionAttachment(sessionId, entryId, contentIndex);
    } catch {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 404, message: "Attachment 不存在", data: {code: "ATTACHMENT_NOT_FOUND"}});
    }

    const etag = `"${locator.ref.id}"`;
    const locatorMs = performance.now() - startedAt;
    setResponseHeader(event, "ETag", etag);
    setResponseHeader(event, "Cache-Control", "private, max-age=31536000, immutable");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    if (getRequestHeader(event, "if-none-match") === etag) {
        setResponseHeader(event, "Server-Timing", `attachment_locator;dur=${locatorMs.toFixed(2)}, attachment_total;dur=${(performance.now() - startedAt).toFixed(2)}`);
        setResponseStatus(event, 304);
        return null;
    }

    let bytes: Uint8Array;
    try {
        bytes = await harness.attachmentStore.load(locator.ref);
    } catch {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 410, message: "Attachment 已损坏或不可用", data: {code: "ATTACHMENT_UNAVAILABLE"}});
    }
    const declaredImageMime = canonicalImageMime(locator.ref.mimeType);
    if (declaredImageMime && imageMimeType(bytes) !== declaredImageMime) {
        setResponseHeader(event, "Cache-Control", "no-store");
        throw createError({statusCode: 410, message: "Attachment 图片类型已损坏", data: {code: "ATTACHMENT_CORRUPT"}});
    }
    const inline = declaredImageMime !== null;
    const name = locator.name ?? "attachment";
    setResponseHeader(event, "Content-Type", locator.ref.mimeType);
    setResponseHeader(event, "Content-Length", bytes.byteLength);
    setResponseHeader(event, "Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`);
    setResponseHeader(event, "Server-Timing", `attachment_locator;dur=${locatorMs.toFixed(2)}, attachment_blob;dur=${(performance.now() - startedAt - locatorMs).toFixed(2)}, attachment_total;dur=${(performance.now() - startedAt).toFixed(2)}`);
    return Buffer.from(bytes);
}));
