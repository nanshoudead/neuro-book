/**
 * 产品清单：本应用加载哪些插件，唯一入口。
 *
 * 这里只引用各插件的描述（`plugins/<插件>/plugin.ts`），不引用任何一侧的实现；后端与前端宿主
 * 各自按清单装配本侧入口，清单里写了某个运行位置、宿主却没有对应实现时装配直接失败。
 */

import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition, PluginDescriptor} from "@notnotype/nb-runtime/plugins";

import {descriptor as commands} from "./plugins/commands/plugin";
import {descriptor as diagnostics} from "./plugins/diagnostics/plugin";
import {descriptor as editor} from "./plugins/editor/plugin";
import {descriptor as explorer} from "./plugins/explorer/plugin";
import {descriptor as files} from "./plugins/files/plugin";
import {descriptor as htmlPreview} from "./plugins/html-preview/plugin";
import {descriptor as http} from "./plugins/http/plugin";
import {descriptor as imageViewer} from "./plugins/image-viewer/plugin";
import {descriptor as markdown} from "./plugins/markdown/plugin";
import {descriptor as plugins} from "./plugins/plugins/plugin";
import {descriptor as projects} from "./plugins/projects/plugin";
import {descriptor as settings} from "./plugins/settings/plugin";
import {descriptor as state} from "./plugins/state/plugin";
import {descriptor as storage} from "./plugins/storage/plugin";
import {descriptor as workbench} from "./plugins/workbench/plugin";

/**
 * 插件描述的类型归内核。浏览器入口随前端构建：窗口按 id 与版本核对后端引导返回的集合，不一致即提示刷新。
 * 各插件与宿主经本模块引用它。
 */
export type {PluginDescriptor};

export const productPlugins: ReadonlyArray<PluginDescriptor> = [diagnostics, http, state, settings, commands, storage, plugins, workbench, projects, files, explorer, markdown, editor, imageViewer, htmlPreview];

/**
 * 在某个运行位置登记的插件：本位置有入口的，加上描述里有顶层声明式贡献的（runtime/plugin-manifest.md 输出 11）。
 * 只有浏览器入口的工作台声明的设置项，服务端也要知道，才能校验用户的设置文件。三个宿主的装配与浏览器引导都按它取集合。
 */
export function pluginsAt(location: RuntimeLocation, descriptors: ReadonlyArray<PluginDescriptor>): PluginDescriptor[] {
    return descriptors.filter((descriptor) => descriptor.locations.includes(location) || (descriptor.contributions ?? []).length > 0);
}

/**
 * 一个插件在本位置登记的定义：描述写了本位置时必须有定义（`definition`），并上描述的顶层贡献；没写时只登记顶层
 * 贡献（`entries` 为空）。描述写了本位置却没有定义、或定义的 id 不符，直接失败，不静默少装。
 */
export function definitionAt(location: RuntimeLocation, descriptor: PluginDescriptor, definition: PluginDefinition | undefined): PluginDefinition {
    const contributions = descriptor.contributions ?? [];
    if (!descriptor.locations.includes(location)) return {id: descriptor.id, entries: [], contributions};
    if (definition === undefined) throw new Error(`清单中的插件 ${descriptor.id} 没有 ${location} 入口定义`);
    if (definition.id !== descriptor.id) throw new Error(`${location} 入口定义的插件 id ${definition.id} 与清单 ${descriptor.id} 不一致`);
    return contributions.length === 0 ? definition : {...definition, contributions: [...(definition.contributions ?? []), ...contributions]};
}

/**
 * 第三方插件在本位置登记的定义。入口代码的装载（docs/specs/runtime/plugin-code-loading.md）实现之前，只登记描述里的
 * 顶层声明式贡献，不论描述写了哪些运行位置；集合按 `pluginsAt` 取。
 */
export function thirdPartyDefinition(descriptor: PluginDescriptor): PluginDefinition {
    return {id: descriptor.id, entries: [], contributions: descriptor.contributions ?? []};
}
