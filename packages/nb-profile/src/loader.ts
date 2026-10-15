import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {isProfileDefinition, ProfileError, type ProfileDefinition} from "./define.js";

export interface LoadedProfile {
    readonly path: string;
    readonly profile: ProfileDefinition;
}

/** 从模块导出里取默认导出并校验是 `defineProfile` 的结果；`path` 只用于错误信息与返回值。 */
export function profileFromModule(mod: unknown, path?: string): LoadedProfile {
    const label = path ?? "<memory>";
    const candidate = typeof mod === "object" && mod !== null ? (mod as {readonly default?: unknown}).default : undefined;
    if (candidate === undefined) {
        throw new ProfileError("profile_invalid", `profile 模块没有默认导出：${label}`);
    }
    if (!isProfileDefinition(candidate)) {
        throw new ProfileError("profile_invalid", `profile 默认导出不是 defineProfile 的结果：${label}`);
    }
    return {path: label, profile: candidate};
}

/** 加载一个 `.profile.tsx`（Bun 直接执行 TSX）；失败抛错并带上绝对路径。 */
export async function loadProfile(path: string): Promise<LoadedProfile> {
    const absolute = resolve(path);
    const mod: unknown = await import(pathToFileURL(absolute).href);
    return profileFromModule(mod, absolute);
}
