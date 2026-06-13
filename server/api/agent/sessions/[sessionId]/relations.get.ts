import {getAgentSessionRelations, requireAgentSessionId} from "nbook/server/agent/http";

/**
 * 读取 Agent session 的关联 Agent 关系。
 */
export default defineEventHandler(async (event) => {
    return getAgentSessionRelations(requireAgentSessionId(event));
});
