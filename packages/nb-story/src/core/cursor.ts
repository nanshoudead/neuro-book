/**
 * 分页游标：绑定书的一代、数据版本（抽取进度）与一组参数（docs/specs/story/queries.md 的“时序与寿命”第 4 条）。
 *
 * 游标只由数据与参数决定，不含进程状态，所以跨进程、跨服务重启都能继续用。查询结果是一代、版本与参数的纯函数，
 * 同一代、同一版本、同一参数的第 n 页总是同样的内容，偏移量就够了。下面的 `generation` 是“代号:版本”。
 */

import {createHash} from "node:crypto";

import {StoryError} from "./errors";

interface CursorBody {
    /** 书的一代与数据版本（“代号:版本”）。 */
    g: string;
    /** 参数摘要。 */
    h: string;
    /** 下一页从第几条开始。 */
    o: number;
}

export const DEFAULT_LIMIT = 50;

/** 去掉 cursor、limit 之后按键排序的参数摘要：参数相同（与书写顺序无关）摘要就相同。 */
export function paramsDigest(method: string, params: Record<string, unknown>): string {
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical);
        if (typeof value === "object" && value !== null) {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
        }
        return value;
    };
    const {cursor: _cursor, limit: _limit, ...rest} = params;
    return createHash("sha256").update(JSON.stringify([method, canonical(rest)])).digest("base64url").slice(0, 16);
}

export function encodeCursor(generation: string, digest: string, offset: number): string {
    const body: CursorBody = {g: generation, h: digest, o: offset};
    return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** 游标里记的一代（书已删除时用来判定 cursor_invalid）；游标写坏了为 null。 */
export function decodeCursor(cursor: string): CursorBody | null {
    try {
        const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
        if (typeof value === "object" && value !== null && "g" in value && "h" in value && "o" in value) {
            const {g, h, o} = value;
            if (typeof g === "string" && typeof h === "string" && typeof o === "number" && Number.isInteger(o) && o >= 0) return {g, h, o};
        }
    } catch {
        // 写坏的游标与换代的游标一样处理：调用方从第一页重新取。
    }
    return null;
}

export interface PageRequest {
    generation: string;
    digest: string;
    cursor: string | undefined;
    limit: number | undefined;
}

/** 取一页；游标不属于这一代或这组参数时报 `cursor_invalid`。 */
export function paginate<T>(items: readonly T[], request: PageRequest): {items: T[]; total: number; next: string | null} {
    let offset = 0;
    if (request.cursor !== undefined) {
        const body = decodeCursor(request.cursor);
        if (!body || body.g !== request.generation || body.h !== request.digest || body.o > items.length) {
            throw new StoryError("cursor_invalid", "分页游标已失效（书被删除、换了一代、抽取进度变了或参数不同），请从第一页重新取");
        }
        offset = body.o;
    }
    const limit = request.limit ?? DEFAULT_LIMIT;
    const end = Math.min(items.length, offset + limit);
    return {items: items.slice(offset, end), total: items.length, next: end < items.length ? encodeCursor(request.generation, request.digest, end) : null};
}
