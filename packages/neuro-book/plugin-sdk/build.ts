/**
 * NeuroBook 的构建预设：通用的构建预设（`src/plugin-platform/build/build-plugin.ts`）绑定 NeuroBook 的平台档案。作者命令、
 * 示例构建与 SDK 包的 `./build` 子路径都用这一层。
 */

import {buildPlugin as buildWithProfile, isPreviousBuild as isPreviousBuildFor} from "../src/plugin-platform/build/build-plugin";
import type {BuildPluginOptions, BuildPluginResult} from "../src/plugin-platform/build/build-plugin";
import {NEUROBOOK_PROFILE} from "../src/plugin-platform-profile";

export {devVersion, PluginBuildError} from "../src/plugin-platform/build/build-plugin";
export type {BuildAlias, BuildPluginOptions, BuildPluginResult} from "../src/plugin-platform/build/build-plugin";

export function buildPlugin(options: BuildPluginOptions): Promise<BuildPluginResult> {
    return buildWithProfile(NEUROBOOK_PROFILE, options);
}

export function isPreviousBuild(root: string, outDir: string): Promise<boolean> {
    return isPreviousBuildFor(NEUROBOOK_PROFILE, root, outDir);
}
