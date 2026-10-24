/**
 * 合同的内容比较。插件宿主核对激活产出的合同时用它（`host.ts`）；只用到合同的类型，不依赖远程机制的实现。
 */

import type {RemoteContract} from "../remote/remote";

/**
 * 两份合同内容是否相同：键排序后的 JSON 相等。值为 undefined 的键与 `JSON.stringify` 一样略去；JSON 表达不了的值（BigInt、
 * 循环引用）让比较抛错，按不同处理。第三方入口产出的合同是插件自己打包的那一份，与宿主按清单还原的不是同一个对象，
 * 插件宿主用它判断两份是不是同一个合同（runtime/plugins.md）。
 */
export function sameContractContent(left: RemoteContract, right: RemoteContract): boolean {
    try {
        return canonicalJson(left) === canonicalJson(right);
    } catch {
        return false;
    }
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}
