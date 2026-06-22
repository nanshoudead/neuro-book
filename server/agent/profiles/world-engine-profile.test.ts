import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import worldEngineProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("world.engine profile", () => {
    it("catalog 可以加载 world.engine runtime artifact", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("world.engine");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("世界引擎");
        expect(snapshot.profiles.find((item) => item.key === "world.engine")).toEqual(expect.objectContaining({
            key: "world.engine",
            loadStatus: "loaded",
        }));
    }, 60_000);

    it("只暴露 World Engine 维护所需工具，并注入第一版边界", async () => {
        const prepared = await worldEngineProfile.prepare!({
            session: testSession({
                profileKey: "world.engine",
                workspaceRoot: resolve("workspace"),
                projectPath: "workspace/world-engine-demo",
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            }),
            initial: {},
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        const historyText = (prepared.historyInitMessages ?? []).map((message) => messageText(message as never)).join("\n");
        const modelContextText = (prepared.modelContextMessages ?? []).map((message) => messageText(message as never)).join("\n");

        expect(worldEngineProfile.rootToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "apply_patch",
            "get_agent_profile",
            "get_session",
            "get_world_state",
            "list_world_slices",
            "write_world_slice",
            "edit_world_slice",
            "delete_world_slice",
            "create_world_subject",
            "get_world_schema",
            "list_world_subjects",
        ]);
        expect(worldEngineProfile.rootToolKeys).not.toContain("subject_rag_search");
        expect(worldEngineProfile.rootToolKeys).not.toContain("get_plot_tree");
        expect(worldEngineProfile.rootToolKeys).not.toContain("invoke_agent");
        expect(systemPrompt).toContain("世界引擎验证与维护 agent");
        expect(systemPrompt).toContain("旧 simulation/ workflow 暂不接入");
        expect(systemPrompt).toContain("写入前优先调用 get_world_schema");
        expect(systemPrompt).toContain("只有 schema default 非空时才会写入 init slice");
        expect(systemPrompt).toContain("时间必须是项目日历字符串，不要传 raw instant");
        expect(systemPrompt).toContain("回退 / 删错切面用 delete_world_slice");
        expect(systemPrompt).toContain("issues");
        expect(historyText).toContain("```docs/tasks/56-world-engine/README.md");
        expect(historyText).toContain("```docs/tasks/56-world-engine/agent-tools.md");
        expect(modelContextText).toContain("projectPath: workspace/world-engine-demo");
        expect(modelContextText).toContain("rawInstant: forbidden for Agent tools");
    });
});

function testSession(input: Partial<NeuroSessionContext>): RuntimeSessionFacade {
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        workspaceRoot: "workspace",
        customState: {},
        linkedAgents: [],
        archived: false,
        planModeActive: false,
        ...input,
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: session.profileKey,
                        initial: {},
                        workspaceRoot: session.workspaceRoot,
                        workspaceKey: "test",
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return session;
}
