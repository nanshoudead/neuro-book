/**
 * 版本写法与兼容判断按 npm semver（docs/specs/runtime/plugin-manifest.md 的输入表、plugin-install.md 的兼容检查）。
 *
 * 用 `semver` 包而不是 `Bun.semver`：后者把写错的范围当成匹配一切（`satisfies("0.1.0", "not a range")` 为 true），
 * 也没有写法校验；清单校验与兼容判断要用同一套语义。
 */

import type {VersionSyntax} from "@notnotype/nb-runtime/plugin-manifest";
import semver from "semver";

export const npmVersions: VersionSyntax = {
    isVersion: (value) => semver.valid(value) !== null,
    isRange: (value) => semver.validRange(value) !== null,
};

/** 产品版本是否在插件声明的 `engines.neurobook` 范围内；范围已由清单校验过写法。 */
export function engineAccepts(productVersion: string, range: string): boolean {
    return semver.satisfies(productVersion, range);
}
