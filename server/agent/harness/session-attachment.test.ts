import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntryDraft} from "nbook/server/agent/session/types";
import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("NeuroAgentHarness session attachment locator", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;
    let harness: NeuroAgentHarness;

    beforeEach(() => {
        root = absoluteFsPath(resolve(".agent", "session-attachment-test", randomUUID()));
        repo = new JsonlSessionRepository(root);
        harness = new NeuroAgentHarness({
            repo,
            profiles: new AgentProfileCatalog(join(root, "system-profiles"), join(root, "user-profiles")),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        await harness.dispose();
        await rm(root, {recursive: true, force: true});
    });

    it("解析 projector 实际公开的 durable user attachment locator", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const attachment = attachmentRef("a", "image/png", 8);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            message: {
                role: "user",
                content: [
                    {type: "text", text: "参考图"},
                    {type: "attachment", attachment, name: "参考图.png"},
                ],
                timestamp: 100,
            },
        } as unknown as SessionEntryDraft);

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 1)).resolves.toEqual({
            ref: attachment,
            name: "参考图.png",
        });
    });

    it("附件 locator lookup 不构造完整 SessionSnapshot", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const attachment = attachmentRef("d", "image/png", 8);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "prompt",
            message: {
                role: "user",
                content: [{type: "attachment", attachment}],
                timestamp: 100,
            },
        } as unknown as SessionEntryDraft);
        const readSession = vi.spyOn(repo, "readSession").mockRejectedValue(new Error("full snapshot lookup is forbidden"));

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 0)).resolves.toMatchObject({ref: attachment});
        expect(readSession).not.toHaveBeenCalled();
    });

    it("解析 projector 实际公开的 durable tool result attachment locator", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const attachment = attachmentRef("b", "image/webp", 12);
        const entry = await repo.appendEntry(session.metadata.sessionId, {
            type: "message",
            origin: "ingest",
            message: {
                role: "toolResult",
                toolCallId: "read-image",
                toolName: "read",
                content: [
                    {type: "text", text: "Read image file [image/webp]"},
                    {type: "attachment", attachment, name: "scene.webp"},
                ],
                isError: false,
                timestamp: 101,
            },
        } as unknown as SessionEntryDraft);

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, entry.id, 1)).resolves.toEqual({
            ref: attachment,
            name: "scene.webp",
        });
    });

    it("拒绝 internal custom message 与 follow-up queue 中的 attachment", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const attachment = attachmentRef("c", "image/png", 8);
        const customMessage = await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            visibleToModel: true,
            message: {
                role: "user",
                content: [{type: "attachment", attachment, name: "internal.png"}],
                timestamp: 102,
            },
        } as unknown as SessionEntryDraft);
        const followUpQueue = await repo.appendEntry(session.metadata.sessionId, {
            type: "custom",
            key: "agent.followup_queue",
            value: {
                items: [{
                    id: "followup-1",
                    kind: "followup",
                    createdAt: 103,
                    message: {
                        text: "内部队列",
                        attachments: [{type: "attachment", attachment, name: "queued.png"}],
                    },
                }],
            },
        });

        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, customMessage.id, 0))
            .rejects.toThrow("Attachment entry 不存在或不可公开");
        await expect(harness.resolveSessionAttachment(session.metadata.sessionId, followUpQueue.id, 0))
            .rejects.toThrow("Attachment entry 不存在或不可公开");
    });
});

/** 创建语义清晰的 content-addressed attachment fixture。 */
function attachmentRef(hashCharacter: string, mimeType: string, bytes: number): AttachmentRef {
    return {
        id: `sha256:${hashCharacter.repeat(64)}`,
        mimeType,
        bytes,
    };
}
