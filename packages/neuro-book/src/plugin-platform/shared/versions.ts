/**
 * 版本写法与兼容判断按 npm semver（docs/specs/runtime/plugin-manifest.md 的输入表与 `pluginVersions`、plugin-install.md 的兼容检查）。
 * 放在 shared：服务端、项目实例与窗口的插件宿主都要同一个范围判断。
 *
 * 用 `semver` 包而不是 `Bun.semver`：后者把写错的范围当成匹配一切（`satisfies("0.1.0", "not a range")` 为 true），
 * 也没有写法校验；清单校验与兼容判断要用同一套语义。
 */

import type {VersionSyntax} from "@notnotype/nb-runtime/plugin-manifest";
import semver from "semver";

/**
 * 版本只接受规范写法：`semver.valid` 也接受 `v1.0.0` 与带首尾空白的写法并把它们规范成 `1.0.0`，而版本会当安装目录名、
 * 按字符串比较是否已安装，同一个版本有两种写法就会装成两个目录。规范写法带上构建元数据（`semver.valid` 会去掉它）。
 */
export function isCanonicalVersion(value: string): boolean {
    const parsed = semver.parse(value);
    return parsed !== null && `${parsed.version}${parsed.build.length > 0 ? `+${parsed.build.join(".")}` : ""}` === value;
}

export const npmVersions: VersionSyntax = {
    isVersion: isCanonicalVersion,
    isRange: (value) => semver.validRange(value) !== null,
};

/** 产品版本是否在插件声明的 `engines.<引擎键>` 范围内；范围已由清单校验过写法。 */
export function engineAccepts(productVersion: string, range: string): boolean {
    return semver.satisfies(productVersion, range);
}

/**
 * 插件版本是否满足另一个插件 `pluginVersions` 里的范围。三处宿主注入内核（`satisfies`）与插件页的升级预览都用它，
 * 预览的结论才与重启后实际受阻的一致（plugin-install.md 输出 8.1）。预发布版本按 semver 的缺省规则：范围里没写预发布时不匹配。
 */
export function pluginVersionSatisfies(version: string, range: string): boolean {
    return semver.satisfies(version, range);
}

/**
 * 两个合法版本的先后：大于 0 表示 `left` 更新。semver 的优先级不看构建元数据（`1.0.0+abc` 与 `1.0.0` 相等），这里再按
 * 构建元数据排出先后，两个不同的版本总有先后，不会把同优先级的另一个构建当成降级。
 */
export function compareVersions(left: string, right: string): number {
    return semver.compareBuild(left, right);
}
