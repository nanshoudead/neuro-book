import {describe, expect, it, vi} from "vitest";
import {AgentAttachmentCodec, attachmentMarker} from "nbook/server/agent/attachments/agent-attachment-codec";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function memoryAdapter(): AttachmentBlobAdapter {
    const values = new Map<string, Uint8Array>();
    return {
        async put(key, bytes) { values.set(key, bytes.slice()); },
        async get(key) { return values.get(key)?.slice() ?? null; },
    };
}

describe("AgentAttachmentCodec", () => {
    it("批量图片任一项无效时不会提前写入 Store", async () => {
        const adapter = memoryAdapter();
        const put = vi.spyOn(adapter, "put");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));

        await expect(codec.saveImageInputs([
            {type: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64")},
            {type: "image", mimeType: "image/png", data: "invalid"},
        ])).rejects.toMatchObject({code: "invalid_input"});
        expect(put).not.toHaveBeenCalled();
    });

    it("批量图片数量超限时不会写入 Store", async () => {
        const adapter = memoryAdapter();
        const put = vi.spyOn(adapter, "put");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const image = {type: "image" as const, mimeType: "image/png", data: Buffer.from(png).toString("base64")};

        await expect(codec.saveImageInputs(Array.from({length: 9}, () => image))).rejects.toMatchObject({code: "limit_exceeded"});
        expect(put).not.toHaveBeenCalled();
    });

    it("单图和整批预算在超限一字节时预检失败且不写 Store", async () => {
        const adapter = memoryAdapter();
        const put = vi.spyOn(adapter, "put");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));

        await expect(codec.saveImageInputs([{
            type: "image",
            mimeType: "image/png",
            data: base64ForBytes(16 * 1024 * 1024 + 1),
        }])).rejects.toMatchObject({code: "limit_exceeded"});
        await expect(codec.saveImageInputs([
            {type: "image", mimeType: "image/png", data: base64ForBytes(10 * 1024 * 1024)},
            {type: "image", mimeType: "image/png", data: base64ForBytes(11 * 1024 * 1024)},
            {type: "image", mimeType: "image/png", data: base64ForBytes(11 * 1024 * 1024 + 1)},
        ])).rejects.toMatchObject({code: "limit_exceeded"});
        expect(put).not.toHaveBeenCalled();
    });

    it("批量保存最多并发 2 且保持输入顺序", async () => {
        let active = 0;
        let maxActive = 0;
        const adapter = memoryAdapter();
        adapter.put = vi.fn(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
        });
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const image = {type: "image" as const, mimeType: "image/png", data: Buffer.from(png).toString("base64")};

        const result = await codec.saveImageInputs(Array.from({length: 5}, () => image), ["0.png", "1.png", "2.png", "3.png", "4.png"]);

        expect(maxActive).toBe(2);
        expect(result.map((item) => item.name)).toEqual(["0.png", "1.png", "2.png", "3.png", "4.png"]);
    });

    it("Provider 预算按 attachment 出现次数计算且超限前不读取 blob", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = {
            type: "attachment" as const,
            attachment: {id: `sha256:${"a".repeat(64)}` as const, mimeType: "image/png", bytes: 40 * 1024 * 1024},
        };

        await expect(codec.hydrateForProvider([
            {role: "user", content: [block, block], timestamp: 1},
        ], model(["text", "image"]))).rejects.toMatchObject({code: "limit_exceeded"});
        expect(get).not.toHaveBeenCalled();
    });

    it("图片只在视觉 Provider 请求期间 hydrate", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = await codec.saveImage({bytes: png, mimeType: "image/png", name: "a.png"});
        const messages: StoredAgentMessage[] = [{role: "user", content: [block], timestamp: 1}];

        const textOnly = await codec.hydrateForProvider(messages, model(["text"]));
        expect(get).not.toHaveBeenCalled();
        expect(textOnly[0]?.content).toEqual([{type: "text", text: attachmentMarker(block)}]);

        const vision = await codec.hydrateForProvider(messages, model(["text", "image"]));
        expect(get).toHaveBeenCalledTimes(1);
        expect(vision[0]?.content).toEqual([{type: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64")}]);
        expect(messages[0]?.content).toEqual([block]);
    });

    it("同一 Provider 请求按 attachment id 去重读取", async () => {
        const adapter = memoryAdapter();
        const get = vi.spyOn(adapter, "get");
        const codec = new AgentAttachmentCodec(new AttachmentStore(adapter));
        const block = await codec.saveImage({bytes: png, mimeType: "image/png"});
        await codec.hydrateForProvider([
            {role: "user", content: [block], timestamp: 1},
            {role: "toolResult", toolCallId: "1", toolName: "read", content: [block], isError: false, timestamp: 2},
        ], model(["text", "image"]));
        expect(get).toHaveBeenCalledTimes(1);
    });

    it("严格校验 data URL MIME 与魔数", async () => {
        const codec = new AgentAttachmentCodec(new AttachmentStore(memoryAdapter()));
        const data = Buffer.from(png).toString("base64");
        await expect(codec.saveImageData({data: `data:image/jpeg;base64,${data}`, mimeType: "image/jpeg"})).rejects.toThrow("MIME 与文件内容不一致");
        await expect(codec.saveImageData({data: "not base64", mimeType: "image/png"})).rejects.toThrow("base64 格式无效");
    });
});

function model(input: Array<"text" | "image">) {
    return {
        id: "test",
        name: "test",
        api: "openai-completions" as const,
        provider: "openai" as const,
        baseUrl: "http://localhost",
        reasoning: false,
        input,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 1000,
        maxTokens: 100,
    };
}

function base64ForBytes(bytes: number): string {
    const completeGroups = Math.floor(bytes / 3);
    const remainder = bytes % 3;
    return `${"A".repeat(completeGroups * 4)}${remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : ""}`;
}
