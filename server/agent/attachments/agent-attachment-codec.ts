import type {ImageContent, Message, Model, TextContent} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage, StoredAttachmentContent, StoredContent} from "nbook/server/agent/messages/stored-types";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {attachmentMarker, storedMessagesForText} from "nbook/server/agent/messages/stored-message-presentation";
import {AGENT_IMAGE_POLICY} from "nbook/server/agent/attachments/agent-attachment-policy";

export {attachmentMarker, storedMessagesForText} from "nbook/server/agent/messages/stored-message-presentation";

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type StoredImageMimeType = typeof IMAGE_MIME_TYPES[number];

/** Agent 消息与通用 Attachment Store 之间的图片领域 Codec。 */
export class AgentAttachmentCodec {
    constructor(private readonly store: AttachmentStore) {}

    /** 保存已经读取的图片 bytes，并生成 stored attachment block。 */
    async saveImage(input: {bytes: Uint8Array; mimeType?: string; name?: string}): Promise<StoredAttachmentContent> {
        if (input.bytes.byteLength > AGENT_IMAGE_POLICY.maxImageBytes) {
            throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
        }
        const mimeType = imageMimeType(input.bytes);
        if (!mimeType || (input.mimeType && canonicalImageMime(input.mimeType) !== mimeType)) {
            throw new AttachmentError("invalid_input", "图片 MIME 与文件内容不一致。");
        }
        const attachment = await this.store.save({bytes: input.bytes, mimeType});
        return {
            type: "attachment",
            attachment,
            ...(input.name ? {name: input.name} : {}),
        };
    }

    /** 严格解析 HTTP 图片 base64/data URL，并立即转为 stored attachment。 */
    async saveImageData(input: {data: string; mimeType?: string; name?: string}): Promise<StoredAttachmentContent> {
        const parsed = parseImageData(input.data, input.mimeType);
        const bytes = Buffer.from(parsed.encoded, "base64");
        return this.saveImage({bytes, mimeType: parsed.mimeType, name: input.name});
    }

    /**
     * 整批图片先完成无分配预检，再以固定并发解码和保存；任一预检失败时 Store 不会产生孤儿。
     */
    async saveImageInputs(inputs: readonly ImageContent[], names?: readonly (string | undefined)[]): Promise<StoredAttachmentContent[]> {
        if (inputs.length > AGENT_IMAGE_POLICY.maxInputImages) {
            throw new AttachmentError("limit_exceeded", "图片数量超过允许上限。");
        }
        const parsed = inputs.map((input) => parseImageData(input.data, input.mimeType));
        const totalBytes = parsed.reduce((total, item) => total + item.bytes, 0);
        if (totalBytes > AGENT_IMAGE_POLICY.maxInputBytes) {
            throw new AttachmentError("limit_exceeded", "图片总大小超过允许上限。");
        }
        const result = new Array<StoredAttachmentContent>(parsed.length);
        let nextIndex = 0;
        const workers = Array.from({length: Math.min(AGENT_IMAGE_POLICY.saveConcurrency, parsed.length)}, async () => {
            for (;;) {
                const index = nextIndex;
                nextIndex += 1;
                const item = parsed[index];
                if (!item) {
                    return;
                }
                const bytes = Buffer.from(item.encoded, "base64");
                if (bytes.byteLength !== item.bytes) {
                    throw new AttachmentError("invalid_input", "图片 base64 长度无效。");
                }
                result[index] = await this.saveImage({bytes, mimeType: item.mimeType, name: names?.[index]});
            }
        });
        await Promise.all(workers);
        return result;
    }

    /**
     * 在单次 Provider 调用前临时 hydrate stored messages。
     * 同一 attachment ID 在本次调用内只读取和编码一次。
     */
    async hydrateForProvider(messages: readonly StoredAgentMessage[], model: Model<any>): Promise<Message[]> {
        const supportsImage = model.input.includes("image");
        if (!supportsImage) {
            return storedMessagesForText(messages);
        }
        const attachmentBlocks = messages.flatMap((message) => message.role !== "assistant" && Array.isArray(message.content)
            ? message.content.filter((block): block is StoredAttachmentContent => block.type === "attachment")
            : []);
        const providerBytes = attachmentBlocks.reduce((total, block) => total + block.attachment.bytes, 0);
        if (attachmentBlocks.length > AGENT_IMAGE_POLICY.maxProviderBlocks
            || providerBytes > AGENT_IMAGE_POLICY.maxProviderSourceBytes) {
            throw new AttachmentError("limit_exceeded", "Provider 图片上下文超过允许预算。");
        }
        const images = new Map<string, ImageContent>();
        const result: Message[] = [];
        for (const message of messages) {
            if (message.role === "assistant") {
                result.push(message);
                continue;
            }
            if (typeof message.content === "string") {
                result.push(message as Message);
                continue;
            }
            const content: Array<TextContent | ImageContent> = [];
            for (const block of message.content) {
                if (block.type === "text") {
                    content.push(block);
                    continue;
                }
                const mimeType = canonicalImageMime(block.attachment.mimeType);
                if (!supportsImage || !mimeType) {
                    content.push({type: "text", text: attachmentMarker(block)});
                    continue;
                }
                let image = images.get(block.attachment.id);
                if (!image) {
                    const bytes = await this.store.load(block.attachment);
                    const detected = imageMimeType(bytes);
                    if (detected !== mimeType) {
                        throw new AttachmentError("corrupt", "Attachment 图片 MIME 与内容不一致。");
                    }
                    image = {type: "image", mimeType, data: Buffer.from(bytes).toString("base64")};
                    images.set(block.attachment.id, image);
                }
                content.push(image);
            }
            result.push({...message, content} as Message);
        }
        return result;
    }
}

/** 判断 stored content 是否包含 attachment。 */
export function hasStoredAttachment(messages: readonly StoredAgentMessage[]): boolean {
    return messages.some((message) => (message.role === "user" || message.role === "toolResult")
        && Array.isArray(message.content)
        && message.content.some((block: StoredContent) => block.type === "attachment"));
}

/** 严格识别第一版允许 inline/provider hydration 的 raster image MIME。 */
export function canonicalImageMime(value: string): StoredImageMimeType | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === "image/jpg") {
        return "image/jpeg";
    }
    return IMAGE_MIME_TYPES.find((mimeType) => mimeType === normalized) ?? null;
}

/** 使用魔数识别 PNG/JPEG/GIF/WebP，不信任文件扩展名。 */
export function imageMimeType(bytes: Uint8Array): StoredImageMimeType | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 6) {
        const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
        if (header === "GIF87a" || header === "GIF89a") {
            return "image/gif";
        }
    }
    if (bytes.length >= 12
        && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
        && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return null;
}

/** 严格解码 raw base64 或 image data URL。 */
function parseImageData(data: string, declaredMimeType?: string): {encoded: string; bytes: number; mimeType?: string} {
    const value = data.trim();
    const parsed = splitImageData(value);
    const encoded = parsed.encoded;
    if (encoded.length > AGENT_IMAGE_POLICY.maxImageEncodedChars) {
        throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
    }
    if (!isStrictBase64(encoded)) {
        throw new AttachmentError("invalid_input", "图片 base64 格式无效。");
    }
    const dataUrlMime = parsed.mimeType;
    if (dataUrlMime && declaredMimeType && canonicalImageMime(dataUrlMime) !== canonicalImageMime(declaredMimeType)) {
        throw new AttachmentError("invalid_input", "图片 data URL MIME 与声明不一致。");
    }
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = (encoded.length / 4) * 3 - padding;
    if (bytes > AGENT_IMAGE_POLICY.maxImageBytes) {
        throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
    }
    return {encoded, bytes, mimeType: dataUrlMime ?? declaredMimeType};
}

/** data URL 只解析短 header，避免对数十 MiB 正文执行捕获正则。 */
function splitImageData(value: string): {encoded: string; mimeType?: string} {
    if (!value.startsWith("data:")) {
        return {encoded: value};
    }
    const comma = value.indexOf(",");
    if (comma <= "data:".length) {
        return {encoded: ""};
    }
    const header = value.slice("data:".length, comma);
    if (!header.endsWith(";base64") || header.includes(",")) {
        return {encoded: ""};
    }
    const mimeType = header.slice(0, -";base64".length);
    if (!mimeType) {
        return {encoded: ""};
    }
    return {
        encoded: value.slice(comma + 1),
        mimeType,
    };
}

/** 线性校验 base64 字符与尾部 padding；大图片不能使用可能栈溢出的整串 RegExp。 */
function isStrictBase64(value: string): boolean {
    if (!value || value.length % 4 !== 0) {
        return false;
    }
    const firstPadding = value.indexOf("=");
    const contentEnd = firstPadding < 0 ? value.length : firstPadding;
    if (firstPadding >= 0) {
        const padding = value.length - firstPadding;
        if ((padding !== 1 && padding !== 2) || !value.slice(firstPadding).split("").every((char) => char === "=")) {
            return false;
        }
    }
    for (let index = 0; index < contentEnd; index += 1) {
        const code = value.charCodeAt(index);
        const valid = (code >= 0x41 && code <= 0x5a)
            || (code >= 0x61 && code <= 0x7a)
            || (code >= 0x30 && code <= 0x39)
            || code === 0x2b
            || code === 0x2f;
        if (!valid) {
            return false;
        }
    }
    return true;
}
