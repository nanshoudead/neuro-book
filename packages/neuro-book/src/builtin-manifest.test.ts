/**
 * 内置插件的代码定义就是它的清单（runtime/plugin-manifest.md 的“输入与前置条件”）：每个内置插件的描述与各运行位置的
 * 定义转成 `package.json` 形式，经第三方插件同一个 `readPluginManifest` 校验，再用 `descriptorOf`、`definitionOf` 转回，
 * 与原定义相同。这样第三方插件能写出内置插件写得出的一切，两种载体不会各自漂移（ADR 0027）。
 *
 * 不比较的只有运行期钩子：入口的 `activate` 与贡献点的 `validate`。服务键按 id、合同按合同 id 比较；依赖不计先后，
 * 激活顺序只由依赖图决定。贡献点与激活事件前缀按插件汇总：内置插件可以只在部分运行位置定义它们（例如项目实例
 * 只有 `nbook.markdown` 的方言贡献点、没有入口），清单把它们写在插件一级。宿主适配器（诊断、HTTP）是宿主的一部分，
 * 不在对齐范围。
 */

import {describe, expect, it} from "bun:test";

import {definitionOf, descriptorOf, readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {ContributionPointDefinition, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";

import {productPlugins} from "nbook/manifest";
import {projectPluginDefinitions} from "nbook/project/plugins";
import {serverPluginDefinitions} from "nbook/server/plugins";
import {PRODUCT_VERSION} from "nbook/shared/product";
import {browserPluginDefinitions} from "nbook/web/plugins";

const HOST_ADAPTERS = new Set(["nbook.diagnostics", "nbook.http"]);

const definitionTables: Readonly<Record<string, Readonly<Record<string, PluginDefinition>>>> = {
    server: serverPluginDefinitions,
    project: projectPluginDefinitions,
    browser: browserPluginDefinitions,
};

interface Located {
    readonly location: string;
    readonly definition: PluginDefinition;
    /** 后端定义同时含服务端与项目入口：只取本位置的。 */
    readonly entries: ReadonlyArray<PluginEntryDefinition>;
}

function locatedDefinitions(descriptor: PluginDescriptor): Located[] {
    return descriptor.locations.map((location) => {
        const definition = definitionTables[location]?.[descriptor.id];
        if (definition === undefined) throw new Error(`${descriptor.id} 写了 ${location}，定义表里没有`);
        return {location, definition, entries: definition.entries.filter((entry) => entry.location === location)};
    });
}

/** 去掉校验函数的贡献点，按插件汇总；同一 id 在两个位置的 `implementation` 必须相同。 */
function pointsOf(located: ReadonlyArray<Located>): Array<{id: string; implementation: "required" | "none"}> {
    const points = new Map<string, "required" | "none">();
    for (const {definition} of located) {
        for (const point of definition.contributionPoints ?? []) {
            const known = points.get(point.id);
            if (known !== undefined && known !== point.implementation) throw new Error(`贡献点 ${point.id} 在两个运行位置的 implementation 不同`);
            points.set(point.id, point.implementation);
        }
    }
    return [...points].map(([id, implementation]) => ({id, implementation}));
}

function prefixesOf(located: ReadonlyArray<Located>): string[] {
    return [...new Set(located.flatMap(({definition}) => definition.activationEventPrefixes ?? []))];
}

/** 代码定义写成 `package.json` 的形式。 */
function manifestJson(descriptor: PluginDescriptor, located: ReadonlyArray<Located>): Record<string, unknown> {
    const dot = descriptor.id.indexOf(".");
    const entries: Record<string, unknown> = {};
    for (const {entries: own} of located) {
        for (const entry of own) {
            if (Object.hasOwn(entries, entry.id)) throw new Error(`${descriptor.id} 的入口 id ${entry.id} 在两个运行位置重复，清单表达不了`);
            const dependencies = entry.dependencies ?? [];
            entries[entry.id] = {
                location: entry.location,
                // 内置插件的代码随产品打包，入口文件只为满足清单格式。
                main: `${entry.id}.js`,
                requires: dependencies.filter((dependency) => dependency.required !== false).map((dependency) => dependency.key.name),
                optional: dependencies.filter((dependency) => dependency.required === false).map((dependency) => dependency.key.name),
                provides: (entry.provides ?? []).map((key) => key.name),
                receives: entry.receives ?? [],
                activationEvents: entry.activationEvents ?? [],
                remoteProvides: (entry.remoteProvides ?? []).map((contract) => contract.id),
                remoteDelegates: (entry.remoteDelegates ?? []).map((contract) => contract.id),
                contributes: entry.contributions ?? [],
            };
        }
    }
    return {
        publisher: descriptor.id.slice(0, dot),
        name: descriptor.id.slice(dot + 1),
        version: descriptor.version,
        engines: {neurobook: PRODUCT_VERSION},
        entries,
        contributes: descriptor.contributions ?? [],
        contributionPoints: pointsOf(located),
        activationEventPrefixes: prefixesOf(located),
    };
}

/** 去掉运行期钩子后可比较的入口形状。 */
function comparableEntry(entry: PluginEntryDefinition): unknown {
    return {
        id: entry.id,
        location: entry.location,
        activationEvents: entry.activationEvents ?? [],
        dependencies: (entry.dependencies ?? [])
            .map((dependency) => ({key: dependency.key.name, required: dependency.required !== false}))
            .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
        provides: (entry.provides ?? []).map((key) => key.name),
        receives: entry.receives ?? [],
        remoteProvides: (entry.remoteProvides ?? []).map((contract) => contract.id),
        remoteDelegates: (entry.remoteDelegates ?? []).map((contract) => contract.id),
        contributions: entry.contributions ?? [],
    };
}

function comparablePoints(points: ReadonlyArray<ContributionPointDefinition> | undefined): unknown {
    return (points ?? []).map((point) => ({id: point.id, implementation: point.implementation}));
}

const aligned = productPlugins.filter((descriptor) => !HOST_ADAPTERS.has(descriptor.id));

describe("内置插件的代码定义与清单格式对齐", () => {
    it("覆盖产品清单里除宿主适配器之外的每个内置插件", () => {
        expect(aligned.length).toBe(productPlugins.length - HOST_ADAPTERS.size);
    });

    for (const descriptor of aligned) {
        it(`${descriptor.id}：转成清单通过校验，转回后除运行期钩子外相同`, () => {
            expect(descriptor.version).toBe(PRODUCT_VERSION);
            const located = locatedDefinitions(descriptor);
            const result = readPluginManifest(manifestJson(descriptor, located), {builtin: true});
            if (result.status !== "valid") throw new Error(`${descriptor.id} 的清单无效：${JSON.stringify(result.problems)}`);
            const {manifest} = result;

            const back = descriptorOf(manifest);
            expect({id: back.id, version: back.version, contributions: back.contributions ?? []}).toEqual({
                id: descriptor.id,
                version: descriptor.version,
                contributions: descriptor.contributions ?? [],
            });
            // 清单的运行位置来自入口；描述多出来的位置只能是没有入口、只承载贡献点的（例如项目实例里的方言贡献点）。
            for (const {location, entries} of located) {
                expect(back.locations.includes(location)).toBe(entries.length > 0);
            }

            const contracts = new Map<string, RemoteContract>();
            for (const {entries} of located) {
                for (const entry of entries) {
                    for (const contract of [...(entry.remoteProvides ?? []), ...(entry.remoteDelegates ?? [])]) contracts.set(contract.id, contract);
                }
            }
            for (const {location, definition, entries} of located) {
                // 插件一级的顶层贡献写在描述里，宿主经 `definitionAt` 并进各位置的定义。
                expect(definition.contributions ?? []).toEqual([]);
                const rebuilt = definitionOf(manifest, location, {contractOf: (id) => contracts.get(id)!});
                expect(rebuilt.entries.map(comparableEntry)).toEqual(entries.map(comparableEntry));
                for (const entry of rebuilt.entries) {
                    const original = entries.find((candidate) => candidate.id === entry.id)!;
                    // 合同按 id 映射回同一个合同对象。
                    expect(entry.remoteProvides ?? []).toEqual(original.remoteProvides ?? []);
                    expect(entry.remoteDelegates ?? []).toEqual(original.remoteDelegates ?? []);
                }
                // 本位置定义的贡献点与前缀都在插件一级的清单里。
                expect(comparablePoints(manifest.contributionPoints)).toEqual(expect.arrayContaining(comparablePoints(definition.contributionPoints) as unknown[]));
                expect(manifest.activationEventPrefixes).toEqual(expect.arrayContaining([...(definition.activationEventPrefixes ?? [])]));
            }
        });
    }
});
