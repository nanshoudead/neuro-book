import {afterEach, describe, expect, it, vi} from "vitest";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";

describe("useAgentSessionApi", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("getSessionRelations 请求轻量关联关系接口", async () => {
        const relations = {
            sessionId: 12,
            linkedAgents: [],
            linkedByAgents: [],
        };
        const fetchMock = vi.fn(async () => relations);
        vi.stubGlobal("$fetch", fetchMock);

        const api = useAgentSessionApi();

        await expect(api.getSessionRelations(12)).resolves.toEqual(relations);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/12/relations");
    });
});
