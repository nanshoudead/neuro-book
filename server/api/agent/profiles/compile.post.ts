import {validateBody} from "nbook/server/utils/novel-chapter";
import {useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {AgentProfileCompileRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";

/**
 * 手动编译用户 profile 源码。真实 TSX loader 在后台 worker 中执行。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileCompileRequestDtoSchema);
    const result = await useProfileCompileWorker().compile(body);
    useAgentHarness().profiles.invalidate();
    return result;
});
