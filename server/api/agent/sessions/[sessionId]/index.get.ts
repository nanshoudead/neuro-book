import {getAgentSessionSnapshot, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取 Agent session snapshot。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    const sessionId = requireAgentSessionId(event);
    const query = getQuery(event);
    const rawLimit = query.entriesLimit;
    const entriesLimit = rawLimit === "full" || rawLimit === "0"
        ? null
        : Math.max(20, Math.min(200, Number(rawLimit ?? 100) || 100));
    return getAgentSessionSnapshot(sessionId, undefined, timing, {entriesLimit});
});
