/**
 * NeuroBook 的平台档案（docs/specs/runtime/plugin-manifest.md 的平台档案）：内核与通用插件管理里凡是“这是哪个应用”的事实
 * 都从这里取。只含常量与纯函数，服务端、窗口、构建预设与作者命令都能导入它，不连带加载 SDK 的实现。
 */

import {createManifestFormat} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginPlatform} from "@notnotype/nb-runtime/plugin-manifest";

import {npmVersions} from "./plugin-platform/shared/versions";

export const NEUROBOOK_PLATFORM: PluginPlatform = {engine: "neurobook", reservedPublishers: ["nbook"]};

/** 清单格式：读、生成清单与内置判断只有这一份。 */
export const manifestFormat = createManifestFormat(NEUROBOOK_PLATFORM, npmVersions);
