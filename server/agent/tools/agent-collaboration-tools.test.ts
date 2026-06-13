import {describe, expect, it} from "vitest";
import {agentCollaborationTools, createBuiltinTools} from "nbook/server/agent/tools/index";

const collaborationEntries = Object.entries(agentCollaborationTools).map(([name, definition]) => ({
    name,
    definition,
}));

describe("agent collaboration tool definitions", () => {
    it.each(collaborationEntries)("$name 必须通过 executeWithContext 执行", async ({definition}) => {
        const runtime = definition.runtime();

        expect(runtime.executeWithContext).toBeTypeOf("function");
        await expect(runtime.execute("direct-call", {})).rejects.toThrow("必须在 agent session context 内执行");
    });

    it("createBuiltinTools 无需 harness 参数并聚合协作、控制与领域工具", () => {
        const toolKeys = createBuiltinTools().map((tool) => tool.key);

        expect(toolKeys).toEqual(expect.arrayContaining([
            "read",
            "report_result",
            "request_user_input",
            "create_agent",
            "invoke_agent",
            "get_agent_profile",
        ]));
    });
});
