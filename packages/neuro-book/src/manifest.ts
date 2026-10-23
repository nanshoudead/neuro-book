/**
 * 产品清单：本应用加载哪些插件，唯一入口。
 *
 * 这里只引用各插件的描述（`plugins/<插件>/plugin.ts`），不引用任何一侧的实现；后端与前端宿主
 * 各自按清单装配本侧入口，清单里写了某个运行位置、宿主却没有对应实现时装配直接失败。
 */

import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import {definitionOf, descriptorOf} from "@notnotype/nb-runtime/plugin-manifest";
import type {ManifestEntry, PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {ActivationContext, ActivationOutput, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";

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
import {PluginCodeError} from "./shared/plugin-code-error";

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
    // 版本只用于核对别的插件写的 `pluginVersions`（plugin-manifest.md 输出 8），从描述并入，各位置的定义不另写。
    if (!descriptor.locations.includes(location)) return {id: descriptor.id, version: descriptor.version, entries: [], contributions};
    if (definition === undefined) throw new Error(`清单中的插件 ${descriptor.id} 没有 ${location} 入口定义`);
    if (definition.id !== descriptor.id) throw new Error(`${location} 入口定义的插件 id ${definition.id} 与清单 ${descriptor.id} 不一致`);
    return {...definition, version: descriptor.version, ...(contributions.length === 0 ? {} : {contributions: [...(definition.contributions ?? []), ...contributions]})};
}

/**
 * 第三方插件在本位置登记的定义。入口代码的装载（docs/specs/runtime/plugin-code-loading.md）实现之前，只登记描述里的
 * 顶层声明式贡献，不论描述写了哪些运行位置；集合按 `pluginsAt` 取。
 */
export function thirdPartyDefinition(descriptor: PluginDescriptor): PluginDefinition {
    return {id: descriptor.id, version: descriptor.version, entries: [], contributions: descriptor.contributions ?? []};
}

/** 第三方插件一个入口这一次激活用的 `activate`：装载器取回并执行入口代码（浏览器与服务端各有一个）。 */
export type EntryLoader = (entry: ManifestEntry, context: ActivationContext) => Promise<PluginEntryDefinition["activate"]>;

/**
 * 第三方插件在本位置登记的定义（docs/specs/runtime/plugin-manifest.md 输出 11，plugin-code-loading.md 输出 1、2）：按清单
 * 登记本位置的入口与顶层声明式贡献，入口激活时经 `load` 取回代码。三处宿主（服务端、项目实例、窗口）共用。
 *
 * 远程合同：清单里的合同由 `definitionOf` 还原，内核要求激活产出的合同与声明的是同一个对象，而插件代码产出的是它自己打包
 * 的那一份。两份的规范化 JSON 相同时换成登记的那份；不同时原样交给内核，由它以 `remote-contract-mismatch` 拒绝。这里不自己
 * 抛错：已经取得的激活产出带着释放责任，抛错会让内核拿不到它、释放不执行。
 */
export function thirdPartyDefinitionAt(location: RuntimeLocation, manifest: PluginManifest, options: {readonly load: EntryLoader; readonly contractOf?: (id: string) => RemoteContract}): PluginDefinition {
    const definition = definitionOf(manifest, location, options.contractOf === undefined ? {} : {contractOf: options.contractOf});
    const entries = definition.entries.map((entry): PluginEntryDefinition => {
        const declared = manifest.entries.find((item) => item.id === entry.id && item.location === location);
        if (declared === undefined) throw new Error(`插件 ${manifest.id} 的入口 ${entry.id} 不在清单里`);
        return {
            ...entry,
            activate: async (context) => {
                const activate = await options.load(declared, context);
                const output: unknown = await activate(context);
                // 插件代码忘了 return 时给出能指到作者代码的原因，而不是读产出字段时引擎抛的 TypeError。
                if (typeof output !== "object" || output === null) throw new PluginCodeError("code-shape", {plugin: manifest.id, entry: entry.id, url: declared.main, detail: "的 activate 没有返回激活产出（对象）"});
                return settleContracts(output as ActivationOutput, entry.remoteProvides ?? []);
            },
        };
    });
    return definitionAt(location, descriptorOf(manifest), {...definition, entries});
}

/**
 * 键排序后的 JSON：两份合同内容相同、键的先后不同时也相等。值为 undefined 的键与 `JSON.stringify` 一样略去：登记的那份经过
 * JSON，代码里的那份可能带着 `errors: undefined` 这类键。
 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

/** 两份合同内容是否相同。JSON 表达不了的值（BigInt、循环引用）让比较抛错，按不同处理：登记的那份不会有这样的值。 */
function sameContract(left: RemoteContract, right: RemoteContract): boolean {
    try {
        return canonical(left) === canonical(right);
    } catch {
        return false;
    }
}

function settleContracts(output: ActivationOutput, registered: ReadonlyArray<RemoteContract>): ActivationOutput {
    if (output.remote === undefined || registered.length === 0) return output;
    return {
        ...output,
        remote: output.remote.map((item) => {
            const own = registered.find((contract) => contract.id === item.contract.id);
            return own !== undefined && own !== item.contract && sameContract(own, item.contract) ? {...item, contract: own} : item;
        }),
    };
}
