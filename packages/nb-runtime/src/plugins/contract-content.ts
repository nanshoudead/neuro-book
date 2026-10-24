/**
 * 合同的内容比较。插件宿主核对激活产出的合同时用它（`host.ts`）；只用到合同的类型，不依赖远程机制的实现。
 */

import type {RemoteContract} from "../remote/remote";

/**
 * 两份合同内容是否相同：键排序后的 JSON 相等。值为 undefined 的键与 `JSON.stringify` 一样略去；JSON 表达不了的值（BigInt、
 * 循环引用）让比较抛错，按不同处理。第三方入口产出的合同是插件自己打包的那一份，与宿主按清单还原的不是同一个对象，
 * 插件宿主用它判断两份是不是同一个合同（runtime/plugins.md）。
 *
 * 不可枚举的键不进比较：TypeBox 在每个 schema 上放的元数据（`~kind`、`~optional`）是不可枚举的，按清单还原的 JSON 没有它们。
 * 但任何位置（含不可枚举的键）带函数的合同按不同处理：`Type.Refine`、`Type.Codec` 把校验与转换函数放在不可枚举的键上，
 * 它们表达不进 JSON，两份合同的校验语义可能不同，只看 JSON 会把产出那份的校验丢掉。
 */
export function sameContractContent(left: RemoteContract, right: RemoteContract): boolean {
    try {
        return canonicalJson(left) === canonicalJson(right);
    } catch {
        return false;
    }
}

function canonicalJson(value: unknown): string {
    if (typeof value === "function") throw new TypeError("合同里有函数，表达不进 JSON");
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        for (const key of Object.getOwnPropertyNames(record)) {
            if (!Object.prototype.propertyIsEnumerable.call(record, key)) assertNoFunction(record[key]);
        }
        return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

/** 不可枚举的值里有没有函数（只读，不进比较结果）。 */
function assertNoFunction(value: unknown, seen: Set<object> = new Set()): void {
    if (typeof value === "function") throw new TypeError("合同里有函数，表达不进 JSON");
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) assertNoFunction((value as Record<string, unknown>)[key], seen);
}
