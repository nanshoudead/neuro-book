import type {Node as PMNode} from "@tiptap/pm/model";
import type {PromptAttachmentCard, PromptEditorAttachment, PromptEditorAttachmentKind} from "./prompt-editor.types";
import {pendingLocalIds} from "./prompt-editor-extensions";
import {numberKey, PROMPT_PENDING_NODE, PROMPT_TOKEN_NODE, type PromptPendingAttrs} from "./prompt-text";

export type PromptAttachmentExcerpt = {preview: string; lines: number};

type CardMeta = {size: number | null; excerpt: PromptAttachmentExcerpt | null};

export interface PromptAttachmentEvents {
    add(localId: string, kind: PromptEditorAttachmentKind, file: File): void;
    remove(localId: string): void;
}

/**
 * PromptEditor 的附件簿记：哪些附件发给了宿主、文件本体（撤销带回时重新登记要用）、本地缩略图与卡片信息。
 *
 * 节点里的 localId 一般就是发给宿主的 localId；撤销带回已移除的附件时，节点保持原 id，
 * 另起一个新 id 发给宿主，`alias` 记录两者的对应，宿主不必记住已移除的附件。
 */
export class PromptAttachmentTracker {
    private readonly files = new Map<string, File>();
    private readonly alias = new Map<string, string>();
    /** 发出过 attachment-add、还没移除也没就绪的宿主 id。 */
    private readonly live = new Set<string>();
    /** 已就绪的节点 id → 附件目标；重做带回待上传节点时据此再次转换。 */
    private readonly resolved = new Map<string, string>();
    private readonly previews = new Map<string, string>();
    private readonly previewByTarget = new Map<string, string>();
    private readonly metaById = new Map<string, CardMeta>();
    private readonly metaByTarget = new Map<string, CardMeta>();
    private pendingIds = new Set<string>();

    constructor(private readonly events: PromptAttachmentEvents, private readonly nextId: () => string) {}

    hostId(nodeId: string): string {
        return this.alias.get(nodeId) ?? nodeId;
    }

    resolvedTarget(nodeId: string): string | null {
        return this.resolved.get(nodeId) ?? null;
    }

    /** 登记一个新附件并返回它的 localId；节点插进正文之后再调用 `announce` 通知宿主。 */
    register(file: File, kind: PromptEditorAttachmentKind, excerpt: PromptAttachmentExcerpt | null): string {
        const localId = this.nextId();
        this.files.set(localId, file);
        this.live.add(localId);
        this.metaById.set(localId, {size: file.size, excerpt});
        if (kind === "image") {
            this.createPreview(localId, file);
        }
        return localId;
    }

    announce(localId: string, kind: PromptEditorAttachmentKind): void {
        const file = this.files.get(localId);
        if (file) {
            this.events.add(localId, kind, file);
        }
    }

    /** 宿主报告就绪：节点随后换成标签，这里只记账，不发 attachment-remove。 */
    resolve(nodeId: string, target: string): void {
        const id = this.hostId(nodeId);
        this.resolved.set(nodeId, target);
        this.live.delete(id);
        const preview = this.previews.get(id);
        if (preview) {
            this.previews.delete(id);
            this.previewByTarget.set(target, preview);
        }
        const meta = this.metaById.get(nodeId);
        if (meta) {
            this.metaByTarget.set(target, meta);
        }
    }

    /** 每次改动后比较待上传节点：消失的通知宿主移除，撤销带回来的换新 id 重新登记。 */
    sync(doc: PMNode): void {
        const now = pendingLocalIds(doc);
        for (const nodeId of this.pendingIds) {
            if (!now.has(nodeId) && !this.resolved.has(nodeId)) {
                this.release(nodeId);
            }
        }
        for (const nodeId of now) {
            if (this.pendingIds.has(nodeId) || this.live.has(this.hostId(nodeId))) {
                continue;
            }
            const file = this.files.get(this.hostId(nodeId));
            if (!file) {
                continue;
            }
            const fresh = this.nextId();
            const kind: PromptEditorAttachmentKind = file.type.startsWith("image/") ? "image" : "file";
            this.alias.set(nodeId, fresh);
            this.files.set(fresh, file);
            this.live.add(fresh);
            if (kind === "image") {
                this.createPreview(fresh, file);
            }
            this.events.add(fresh, kind, file);
        }
        this.pendingIds = now;
    }

    /** 宿主换了草稿版本：正文里未就绪的附件都通知移除，撤销历史随之清空，簿记从头开始。 */
    reset(doc: PMNode): void {
        for (const nodeId of pendingLocalIds(doc)) {
            this.release(nodeId);
        }
        this.pendingIds = new Set();
        this.files.clear();
        this.alias.clear();
        this.resolved.clear();
        this.metaById.clear();
    }

    dispose(): void {
        for (const url of [...this.previews.values(), ...this.previewByTarget.values()]) {
            URL.revokeObjectURL(url);
        }
        this.previews.clear();
        this.previewByTarget.clear();
    }

    /** 附件条的卡片，按在正文里出现的顺序；卡片 id 是节点位置，删除时据此找回节点。 */
    cards(
        doc: PMNode,
        states: ReadonlyMap<string, PromptEditorAttachment>,
        resolveThumbnail: (target: string) => string | null,
    ): PromptAttachmentCard[] {
        const result: PromptAttachmentCard[] = [];
        doc.descendants((node, pos) => {
            if (node.type.name === PROMPT_PENDING_NODE) {
                const attrs = node.attrs as PromptPendingAttrs;
                const state = states.get(this.hostId(attrs.localId));
                const meta = this.metaById.get(attrs.localId);
                result.push({
                    id: `pos:${pos}`,
                    hoverKey: numberKey(attrs.kind, attrs.number),
                    kind: attrs.kind,
                    number: attrs.number,
                    name: attrs.name,
                    state: state?.state === "failed" ? "failed" : "uploading",
                    ...(state?.state === "failed" ? {error: state.error} : {}),
                    thumbnail: this.previews.get(this.hostId(attrs.localId)) ?? null,
                    size: meta?.size ?? null,
                    excerpt: meta?.excerpt ?? null,
                });
            }
            else if (node.type.name === PROMPT_TOKEN_NODE && (node.attrs.kind === "image" || node.attrs.kind === "file")) {
                const kind = node.attrs.kind as PromptEditorAttachmentKind;
                const number = Number(node.attrs.number);
                const target = String(node.attrs.target);
                const meta = this.metaByTarget.get(target);
                result.push({
                    id: `pos:${pos}`,
                    hoverKey: numberKey(kind, number),
                    kind,
                    number,
                    name: String(node.attrs.label),
                    state: "ready",
                    thumbnail: kind === "image" ? resolveThumbnail(target) ?? this.previewByTarget.get(target) ?? null : null,
                    size: meta?.size ?? null,
                    excerpt: meta?.excerpt ?? null,
                });
            }
        });
        return result;
    }

    private release(nodeId: string): void {
        const id = this.hostId(nodeId);
        if (!this.live.delete(id)) {
            return;
        }
        const preview = this.previews.get(id);
        if (preview) {
            URL.revokeObjectURL(preview);
            this.previews.delete(id);
        }
        this.events.remove(id);
    }

    private createPreview(id: string, file: File): void {
        if (typeof URL.createObjectURL === "function") {
            this.previews.set(id, URL.createObjectURL(file));
        }
    }
}
