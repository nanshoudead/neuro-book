import {getQuery} from "h3";
import {listNovels} from "nbook/server/utils/novel-chapter";

/**
 * 查询 Project Workspace 列表。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const limit = typeof query.limit === "string" && /^\d+$/.test(query.limit) ? Number.parseInt(query.limit, 10) : undefined;
    return listNovels({
        limit: limit && Number.isSafeInteger(limit) ? limit : undefined,
        includeProjectPaths: queryStringList(query.includeProjectPath),
        excludeProjectPathPrefixes: queryStringList(query.excludeProjectPathPrefix),
    });
});

/**
 * 将 h3 query 的单值 / 多值参数转成字符串数组。
 */
function queryStringList(value: unknown): string[] | undefined {
    if (typeof value === "string") {
        return value ? [value] : undefined;
    }
    if (Array.isArray(value)) {
        const list = value.filter((item): item is string => typeof item === "string" && Boolean(item));
        return list.length ? list : undefined;
    }
    return undefined;
}
