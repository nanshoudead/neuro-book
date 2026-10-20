/**
 * 清单解析（runtime.plugin-manifest）：结构与语义校验、描述与定义的映射。清单字段的精确规则见
 * docs/specs/runtime/plugin-manifest.md 的输入表与“失败与恢复”。
 */

import {describe, expect, it} from "bun:test";

import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import semver from "semver";

import {definitionOf, descriptorOf, readPluginManifest as read} from "./plugin-manifest";
import type {ReadManifestOptions} from "./plugin-manifest";

/** 调用方注入的写法校验，这里用 npm 的 semver（测试依赖，内核运行时不依赖它）；应用侧另外只接受规范写法。 */
const versions: ReadManifestOptions["versions"] = {isVersion: (value) => semver.valid(value) !== null, isRange: (value) => semver.validRange(value) !== null};

function readPluginManifest(value: unknown, options: {readonly builtin?: boolean} = {}) {
    return read(value, {...options, versions});
}

const base = {
    name: "notes",
    publisher: "example",
    version: "1.0.0",
    engines: {neurobook: ">=0.1.0"},
};

function problemsOf(value: unknown): ReadonlyArray<string> {
    const result = readPluginManifest(value);
    if (result.status !== "invalid") throw new Error("期望清单无效");
    return result.problems.map((problem) => problem.path);
}

function manifestOf(value: unknown): Extract<ReturnType<typeof readPluginManifest>, {status: "valid"}>["manifest"] {
    const result = readPluginManifest(value);
    if (result.status !== "valid") throw new Error(`期望清单有效：${JSON.stringify(result.problems)}`);
    return result.manifest;
}

describe("readPluginManifest", () => {
    it("只有顶层声明的清单：位置为空、贡献保留", () => {
        const manifest = manifestOf({
            ...base,
            contributes: [{capability: "settings.properties", id: "example.notes/items", declaration: {default: []}}],
        });
        expect(manifest.id).toBe("example.notes");
        expect(descriptorOf(manifest)).toEqual({
            id: "example.notes",
            version: "1.0.0",
            locations: [],
            contributions: [{capability: "settings.properties", id: "example.notes/items", declaration: {default: []}}],
        });
    });

    it("入口映射为定义：位置、必需与可选依赖、提供项、激活事件、接收的贡献点与贡献", () => {
        const manifest = manifestOf({
            ...base,
            activationEventPrefixes: ["onNotes"],
            contributionPoints: [{id: "example.notes.items", implementation: "required"}],
            entries: {
                ui: {
                    location: "browser",
                    main: "dist/browser.js",
                    requires: ["nbook.settings/settings"],
                    optional: ["nbook.editor/document"],
                    provides: ["example.notes/view"],
                    receives: ["example.notes.items"],
                    activationEvents: ["onStartup", "onNotes:open"],
                    contributes: [{capability: "example.notes.items", id: "main", declaration: {}}],
                },
            },
        });
        expect(descriptorOf(manifest).locations).toEqual(["browser"]);
        const definition = definitionOf(manifest, "browser");
        expect(definition.id).toBe("example.notes");
        expect(definition.activationEventPrefixes).toEqual(["onNotes"]);
        expect(definition.contributionPoints).toEqual([{id: "example.notes.items", implementation: "required"}]);
        expect(definition.entries).toHaveLength(1);
        const entry = definition.entries[0]!;
        expect(entry.id).toBe("ui");
        expect(entry.location).toBe("browser");
        expect(entry.activationEvents).toEqual(["onStartup", "onNotes:open"]);
        expect(entry.dependencies?.map((dependency) => [dependency.key.name, dependency.required ?? true])).toEqual([
            ["nbook.settings/settings", true],
            ["nbook.editor/document", false],
        ]);
        expect(entry.provides?.map((key) => key.name)).toEqual(["example.notes/view"]);
        expect(entry.receives).toEqual(["example.notes.items"]);
        expect(entry.contributions).toEqual([{capability: "example.notes.items", id: "main", declaration: {}}]);
        expect(definitionOf(manifest, "server").entries).toEqual([]);
    });

    it("远程合同 id 经调用方给的映射换成合同对象；没有映射时明确失败", () => {
        const manifest = manifestOf({...base, entries: {s: {location: "server", main: "s.js", remoteProvides: ["example.notes/index"], remoteDelegates: ["nbook.storage/records"]}}});
        const contracts = new Map([
            ["example.notes/index", {id: "example.notes/index", version: 1, provider: "server", callers: ["browser"], methods: {}, events: {}}],
            ["nbook.storage/records", {id: "nbook.storage/records", version: 1, provider: "server", callers: ["server"], methods: {}, events: {}}],
        ] as const);
        const entry = definitionOf(manifest, "server", {contractOf: (id) => contracts.get(id as never)!}).entries[0]!;
        expect(entry.remoteProvides?.map((contract) => contract.id)).toEqual(["example.notes/index"]);
        expect(entry.remoteDelegates?.map((contract) => contract.id)).toEqual(["nbook.storage/records"]);
        expect(() => definitionOf(manifest, "server")).toThrow("没有提供合同映射");
    });

    it("没有代码装载时，入口激活明确失败", () => {
        const entry = definitionOf(manifestOf({...base, entries: {ui: {location: "browser", main: "main.js"}}}), "browser").entries[0]!;
        expect(() => entry.activate({} as never)).toThrow("还没有装载代码");
    });

    it("任何插件都可以声明 remoteDelegates（ADR 0027）", () => {
        expect(readPluginManifest({...base, entries: {s: {location: "server", main: "s.js", remoteDelegates: ["nbook.storage/records"]}}}).status).toBe("valid");
    });

    it("不同位置的入口可以提供同一服务", () => {
        expect(readPluginManifest({
            ...base,
            entries: {
                s: {location: "server", main: "s.js", provides: ["example.notes/clock"]},
                b: {location: "browser", main: "b.js", provides: ["example.notes/clock"]},
            },
        }).status).toBe("valid");
    });

    it("内置插件可以用 nbook. 前缀并约束内置插件版本", () => {
        expect(readPluginManifest({...base, publisher: "nbook", pluginVersions: {"nbook.editor": "^0.1.0"}}, {builtin: true}).status).toBe("valid");
    });

    // 每一行是一种使整份清单无效的原因，以及报告的字段路径。
    const invalid: ReadonlyArray<readonly [string, unknown, string]> = [
        ["缺少必需字段", {name: "notes"}, ""],
        ["缺少 engines.neurobook", {...base, engines: {}}, "engines"],
        ["publisher 不是单个 id 段", {...base, publisher: "@scope/x"}, "publisher"],
        ["name 含大写", {...base, name: "Notes"}, "name"],
        ["version 不是 semver", {...base, version: "1.0"}, "version"],
        ["第三方用 nbook. 前缀", {...base, publisher: "nbook"}, "publisher"],
        ["入口缺少 main（缺字段报在所在对象上）", {...base, entries: {b: {location: "browser"}}}, "entries.b"],
        ["main 是绝对路径", {...base, entries: {b: {location: "browser", main: "/abs.js"}}}, "entries.b.main"],
        ["main 越出插件目录", {...base, entries: {b: {location: "browser", main: "dist/../../x.js"}}}, "entries.b.main"],
        ["main 用反斜杠", {...base, entries: {b: {location: "browser", main: "dist\\x.js"}}}, "entries.b.main"],
        ["location 为空", {...base, entries: {b: {location: "", main: "b.js"}}}, "entries.b.location"],
        ["入口有未知字段", {...base, entries: {b: {location: "browser", main: "b.js", extra: 1}}}, "entries.b"],
        ["服务 id 不以插件 id 开头", {...base, entries: {s: {location: "server", main: "s.js", provides: ["other.x/y"]}}}, "entries.s.provides"],
        ["占用保留服务名 channel", {...base, entries: {s: {location: "server", main: "s.js", provides: ["example.notes/channel"]}}}, "entries.s.provides"],
        ["同一入口重复提供", {...base, entries: {s: {location: "server", main: "s.js", provides: ["example.notes/a", "example.notes/a"]}}}, "entries.s.provides"],
        ["同一位置两个入口提供同一服务", {...base, entries: {a: {location: "server", main: "a.js", provides: ["example.notes/a"]}, b: {location: "server", main: "b.js", provides: ["example.notes/a"]}}}, "entries.b.provides"],
        ["合同 id 不以插件 id 开头", {...base, entries: {s: {location: "server", main: "s.js", remoteProvides: ["x.y/z"]}}}, "entries.s.remoteProvides"],
        ["合同 id 重复", {...base, entries: {s: {location: "server", main: "s.js", remoteProvides: ["example.notes/a", "example.notes/a"]}}}, "entries.s.remoteProvides"],
        ["接收别人的贡献点", {...base, entries: {s: {location: "server", main: "s.js", receives: ["settings.properties"]}}}, "entries.s.receives"],
        ["声明内核保留前缀 onRemote", {...base, activationEventPrefixes: ["onRemote"]}, "activationEventPrefixes.0"],
        ["声明 onStartup 为前缀", {...base, activationEventPrefixes: ["onStartup"]}, "activationEventPrefixes.0"],
        ["前缀含冒号", {...base, activationEventPrefixes: ["a:b"]}, "activationEventPrefixes.0"],
        ["前缀重复", {...base, activationEventPrefixes: ["a", "a"]}, "activationEventPrefixes.1"],
        ["约束内置插件版本", {...base, pluginVersions: {"nbook.editor": "^1.0.0"}}, "pluginVersions.nbook.editor"],
        ["pluginVersions 的键不是插件 id", {...base, pluginVersions: {editor: "^1.0.0"}}, "pluginVersions.editor"],
        ["pluginVersions 的值不是版本范围", {...base, pluginVersions: {"example.tts": "latest"}}, "pluginVersions.example.tts"],
        ["engines.neurobook 不是版本范围", {...base, engines: {neurobook: "not a range"}}, "engines.neurobook"],
        ["贡献缺少字段", {...base, contributes: [{capability: "settings.properties"}]}, "contributes.0"],
        ["贡献点 implementation 不合法", {...base, contributionPoints: [{id: "x", implementation: "maybe"}]}, "contributionPoints.0.implementation"],
        ["贡献点 id 重复", {...base, contributionPoints: [{id: "x", implementation: "none"}, {id: "x", implementation: "none"}]}, "contributionPoints.1.id"],
    ];

    for (const [name, value, path] of invalid) {
        it(`清单无效：${name}`, () => {
            expect(problemsOf(value)).toContain(path);
        });
    }

    it("版本与范围按调用方给的 npm 写法校验：非法的预发布标识、写错的范围都无效", () => {
        expect(problemsOf({...base, version: "1.0.0-01"})).toContain("version");
        expect(problemsOf({...base, engines: {neurobook: ">=0.0.0-01"}})).toContain("engines.neurobook");
    });

    it("接受 npm 的常见范围写法", () => {
        for (const range of ["*", "0.1.0", ">=0.1.0", "^0.1", "~1.x", ">=0.1.0 <0.2.0", "1.0.0 - 2.0.0", "^0.1.0 || ^1.0.0", "0.1.0-beta.1", "=0.1.0", "1.0.0 ||"]) {
            expect(readPluginManifest({...base, engines: {neurobook: range}}).status, range).toBe("valid");
        }
    });

    it("问题按字段路径排序，同一输入总是同一结果", () => {
        const value = {...base, name: "Notes", publisher: "Bad", version: "x"};
        expect(problemsOf(value)).toEqual(["name", "publisher", "version"]);
    });
});

describe("runtime plugin-manifest 模块边界", () => {
    it("源码只导入本目录、TypeBox 与 lifecycle、services、plugins 的公开入口", async () => {
        const moduleDir = dirname(fileURLToPath(import.meta.url));
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
        expect(sources).toContain("plugin-manifest.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
            for (const specifier of specifiers) {
                const allowed = /^\.\/[^/]+$/u.test(specifier) || /^(?:typebox|typebox\/value|\.\.\/lifecycle\/lifecycle|\.\.\/services\/services|\.\.\/plugins\/plugins)$/u.test(specifier);
                expect(allowed, `${name} 导入了 ${specifier}`).toBe(true);
            }
            expect(code, `${name} 不得引用宿主全局对象`).not.toMatch(/\b(?:process|window|document)\./u);
        }
    });
});
