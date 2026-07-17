import {describe, expect, it} from "vitest";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";

describe("agent attachment locator", () => {
    it("使用 session、entry 与原始 content index 构造读取地址", () => {
        expect(agentAttachmentUrl(12, "entry/含空格", 3)).toBe(
            "/api/agent/sessions/12/entries/entry%2F%E5%90%AB%E7%A9%BA%E6%A0%BC/attachments/3",
        );
    });

    it("缺少 durable locator 时不生成可猜测地址", () => {
        expect(agentAttachmentUrl(null, "entry-1", 0)).toBeNull();
        expect(agentAttachmentUrl(1, "", 0)).toBeNull();
        expect(agentAttachmentUrl(1, "entry-1", -1)).toBeNull();
    });
});
