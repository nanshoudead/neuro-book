import {describe, expect, it} from "vitest";
import {projectQueuedMessage, projectQueuedMessages} from "nbook/server/agent/events/public-queue-projection";

describe("public queue projection", () => {
    it("图片 base64 和大 payload 不进入公开 queue item", () => {
        const data = Buffer.alloc(10 * 1024 * 1024, 7).toString("base64");
        const projected = projectQueuedMessage({
            id: "queue-1",
            kind: "steer",
            message: {text: "x".repeat(100_000), images: [{type: "image", mimeType: "image/png", data}]},
            input: {nested: "y".repeat(100_000)},
            createdAt: 1,
        });

        expect(projected.images).toEqual([{mimeType: "image/png", dataBytes: 10 * 1024 * 1024, dataOmitted: true}]);
        expect(projected.text?.omitted).toBe(true);
        expect(JSON.stringify(projected)).not.toContain(data);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(32 * 1024);
    });

    it("recovery queue 只公开最早 64 项", () => {
        const projected = projectQueuedMessages(Array.from({length: 100}, (_, index) => ({
            id: `queue-${String(index)}`,
            kind: "followup" as const,
            message: {text: `message-${String(index)}`},
            createdAt: index,
        })));

        expect(projected.items).toHaveLength(64);
        expect(projected.items[0]?.id).toBe("queue-0");
        expect(projected.items.at(-1)?.id).toBe("queue-63");
        expect(projected.omittedItems).toBe(36);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });
});
