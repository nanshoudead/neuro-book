/**
 * 清单还原成插件描述与各运行位置的插件定义。与平台无关：哪些合同是内置的由调用方经 `contractOf` 给出。
 */

import type {TSchema} from "typebox";

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import type {RemoteContract} from "../remote/remote";
import {defineServiceKey} from "../services/services";

import type {ContributionDeclaration, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "../plugins/plugins";

import {restoreContract} from "./schema";
import type {ManifestEntry, PluginManifest} from "./schema";

/** 清单对应的插件描述：有入口的运行位置与只有声明、不需要实现的顶层贡献。 */
export function descriptorOf(manifest: PluginManifest): PluginDescriptor {
    return {
        id: manifest.id,
        version: manifest.version,
        locations: manifest.locations,
        ...(manifest.contributes.length === 0 ? {} : {contributions: manifest.contributes.map((contribution): ContributionDeclaration => ({...contribution}))}),
    };
}

export interface DefinitionOptions {
    /** 入口的激活实现；代码装载未接入时缺省，激活会明确失败。 */
    readonly activateFor?: (entry: ManifestEntry) => PluginEntryDefinition["activate"];
    /**
     * 不在清单 `contracts` 里的合同 id（内置插件的合同）映射成合同对象；缺省时引用了它们的入口在映射时失败。清单里的
     * 合同由 `definitionOf` 自己还原，同一次调用里同一 id 得到同一个对象。
     */
    readonly contractOf?: (id: string) => NonNullable<PluginEntryDefinition["remoteProvides"]>[number];
}

/**
 * 某个运行位置的插件定义：本位置的入口，加上本插件拥有的激活事件前缀与贡献点。
 *
 * 顶层声明式贡献由插件描述携带，宿主经 `definitionAt` 并进定义（runtime/plugin-manifest.md 输出 11），这里不重复。
 */
export function definitionOf(manifest: PluginManifest, location: RuntimeLocation, options: DefinitionOptions = {}): PluginDefinition {
    // 同一位置的定义里，同一 id 只还原一次：入口声明的与提供方查询拿到的是同一个合同对象。
    const restored = new Map<string, RemoteContract>();
    const contractOf = (id: string): NonNullable<PluginEntryDefinition["remoteProvides"]>[number] => {
        const own = manifest.contracts[id];
        if (own !== undefined) {
            const known = restored.get(id) ?? restoreContract(own);
            restored.set(id, known);
            return known;
        }
        if (options.contractOf === undefined) throw new Error(`插件 ${manifest.id} 声明了远程服务或代理 ${id}，但没有提供合同映射`);
        return options.contractOf(id);
    };
    const entries: PluginEntryDefinition[] = [];
    for (const entry of manifest.entries) {
        if (entry.location !== location) continue;
        const remoteProvides = entry.remoteProvides.map(contractOf);
        const remoteDelegates = entry.remoteDelegates.map(contractOf);
        const dependencies = [
            ...entry.requires.map((serviceId) => ({key: defineServiceKey(serviceId)})),
            ...entry.optional.map((serviceId) => ({key: defineServiceKey(serviceId), required: false})),
        ];
        entries.push({
            id: entry.id,
            location,
            ...(entry.activationEvents.length === 0 ? {} : {activationEvents: entry.activationEvents}),
            ...(dependencies.length === 0 ? {} : {dependencies}),
            ...(entry.provides.length === 0 ? {} : {provides: entry.provides.map((serviceId) => defineServiceKey(serviceId))}),
            ...(entry.receives.length === 0 ? {} : {receives: entry.receives}),
            ...(remoteProvides.length === 0 ? {} : {remoteProvides}),
            ...(remoteDelegates.length === 0 ? {} : {remoteDelegates}),
            ...(entry.contributes.length === 0 ? {} : {contributions: entry.contributes.map((contribution): ContributionDeclaration => ({...contribution}))}),
            activate: options.activateFor?.(entry) ?? (() => {
                throw new Error(`插件 ${manifest.id} 的入口 ${entry.id} 还没有装载代码（runtime.plugin-code-loading）`);
            }),
        });
    }
    return {
        id: manifest.id,
        version: manifest.version,
        ...(Object.keys(manifest.pluginVersions).length === 0 ? {} : {pluginVersions: manifest.pluginVersions}),
        entries,
        ...(manifest.activationEventPrefixes.length === 0 ? {} : {activationEventPrefixes: manifest.activationEventPrefixes}),
        ...(manifest.contributionPoints.length === 0
            ? {}
            : {contributionPoints: manifest.contributionPoints.map(({id, implementation, schema, idPrefix}) => ({id, implementation, ...(schema === undefined ? {} : {schema: schema as TSchema}), ...(idPrefix === undefined ? {} : {idPrefix})}))}),
    };
}
