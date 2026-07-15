import {isDeepStrictEqual} from "node:util";
import type {Api} from "@earendil-works/pi-ai";
import type {Model} from "nbook/server/agent/messages/types";

/** 将外部 Pi Model 归一化为与 JSONL round-trip 一致的普通可序列化对象。 */
export function canonicalSessionModel(model: Model<Api> | null): Model<Api> | null {
    return model === null ? null : normalizeJson(model) as Model<Api>;
}

/** 比较 session 已持久化模型与当前 resolved model 的真实可序列化差异。 */
export function sessionModelsEqual(left: Model<Api> | null, right: Model<Api> | null): boolean {
    return isDeepStrictEqual(canonicalSessionModel(left), canonicalSessionModel(right));
}

/**
 * Pi Model 来自外部包，运行时形状可能包含 undefined；这里只接受 JSON 可表达的数据并删除 undefined。
 */
function normalizeJson(input: unknown): unknown {
    if (input === undefined) {
        return undefined;
    }
    if (input === null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
        return input;
    }
    if (Array.isArray(input)) {
        return input.map((item) => normalizeJson(item) ?? null);
    }
    if (typeof input === "object") {
        return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
            const normalized = normalizeJson(value);
            return normalized === undefined ? [] : [[key, normalized]];
        }));
    }
    throw new Error(`Session model 包含不可序列化值：${typeof input}`);
}
