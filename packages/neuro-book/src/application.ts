/**
 * 应用的装配入口：内核的 `createApplication` 带上 NeuroBook 的平台档案。应用里装配运行实例一律经这里（`architecture.test.ts`
 * 检查），漏传平台档案时内置插件不在自己 id 之下的贡献（例如 `nbook.projects` 的设置分区 `nbook.works`）会被拒，界面少东西
 * 却没有类型错误。
 */

import {createApplication as createKernelApplication} from "@notnotype/nb-runtime/application";
import type {Application, ApplicationManifest, HostContext} from "@notnotype/nb-runtime/application";

import {NEUROBOOK_PLATFORM} from "./plugin-platform-profile";

export function createApplication(host: HostContext, manifest: ApplicationManifest): Application {
    return createKernelApplication(host, {platform: NEUROBOOK_PLATFORM, ...manifest});
}
