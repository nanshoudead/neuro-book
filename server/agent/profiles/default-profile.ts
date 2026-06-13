import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {LeaderDefaultInputSchema, LeaderDefaultOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {defineProfileTools, tools} from "nbook/server/agent/profiles/profile-tools";

/**
 * 最小内置 profile。真实 builtin profile 从 assets/workspace/.nbook 迁移。
 */
export const defaultAgentProfile = defineAgentProfile({
    manifest: {
        key: "leader.default",
        name: "Default Leader",
        description: "最小 leader profile，用于 harness 闭环和测试。",
    },
    inputSchema: LeaderDefaultInputSchema,
    outputSchema: LeaderDefaultOutputSchema,
    tools: defineProfileTools({
        read: tools.read(),
        write: tools.write(),
        edit: tools.edit(),
        apply_patch: tools.applyPatch(),
        bash: tools.bash(),
        request_user_input: tools.requestUserInput(),
        enter_plan_mode: tools.enterPlanMode(),
        exit_plan_mode: tools.exitPlanMode(),
        create_agent: tools.createAgent(),
        invoke_agent: tools.invokeAgent(),
        get_agent: tools.getAgent(),
        get_agent_profile: tools.getAgentProfile(),
        get_session: tools.getSession(),
        detach_agent: tools.detachAgent(),
    }),
    compaction: {},
    prepare() {
        return {
            systemPrompt: "You are Neuro Book Agent.",
        };
    },
});
