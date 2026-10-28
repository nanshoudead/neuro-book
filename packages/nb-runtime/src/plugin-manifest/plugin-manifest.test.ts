/**
 * 清单解析（runtime.plugin-manifest）：结构与语义校验、描述与定义的映射。清单字段的精确规则见
 * docs/specs/runtime/plugin-manifest.md 的输入表与“失败与恢复”。
 */

import {describe, expect, it} from "bun:test";

import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import semver from "semver";
import {Type} from "typebox";

import type {PluginDefinition} from "../plugins/plugins";
import {portabilityProblems} from "../plugins/plugins";
import {defineRemoteService} from "../remote/remote";
import {catalogFile, catalogProblems, createManifestFormat, definitionOf, descriptorOf, parseCatalog} from "./plugin-manifest";
import type {ManifestSource, VersionSyntax} from "./plugin-manifest";

/** 调用方注入的写法校验，这里用 npm 的 semver（测试依赖，内核运行时不依赖它）；应用侧另外只接受规范写法。 */
const versions: VersionSyntax = {isVersion: (value) => semver.valid(value) !== null, isRange: (value) => semver.validRange(value) !== null};

/** 测试用的平台：引擎键与保留发布者都叫 acme，内核里没有任何应用的名字。 */
const format = createManifestFormat({engine: "acme", reservedPublishers: ["acme"]}, versions);

function readPluginManifest(value: unknown, options: {readonly builtin?: boolean} = {}) {
    return format.read(value, options);
}

function build(source: ManifestSource, options: {readonly builtin?: boolean} = {}) {
    return format.build(source, options);
}

const base = {
    name: "notes",
    publisher: "example",
    version: "1.0.0",
    engines: {acme: ">=0.1.0"},
};

const indexContractJson = {
    id: "example.notes/index",
    version: 2,
    provider: "server",
    callers: ["browser"],
    methods: {list: {input: {type: "object", properties: {}, additionalProperties: false}, output: {type: "array", items: {type: "string"}}, effect: "read"}},
    events: {},
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

describe("读清单", () => {
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
                    requires: ["acme.settings/settings"],
                    optional: ["acme.editor/document"],
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
            ["acme.settings/settings", true],
            ["acme.editor/document", false],
        ]);
        expect(entry.provides?.map((key) => key.name)).toEqual(["example.notes/view"]);
        expect(entry.receives).toEqual(["example.notes.items"]);
        expect(entry.contributions).toEqual([{capability: "example.notes.items", id: "main", declaration: {}}]);
        expect(definitionOf(manifest, "server").entries).toEqual([]);
    });

    it("清单里的合同由 definitionOf 还原，同一位置同一 id 是同一个对象；内置合同经调用方的映射；没有映射时明确失败", () => {
        const manifest = manifestOf({
            ...base,
            entries: {
                s: {location: "server", main: "s.js", remoteProvides: ["example.notes/index"], remoteDelegates: ["acme.storage/records"]},
                t: {location: "server", main: "t.js", remoteDelegates: ["example.notes/index"]},
            },
            contracts: {"example.notes/index": indexContractJson},
        });
        const records = {id: "acme.storage/records", version: 1, provider: "server", callers: ["server"], methods: {}, events: {}} as const;
        const [s, t] = definitionOf(manifest, "server", {contractOf: () => records}).entries;
        const restored = s!.remoteProvides![0]!;
        expect(restored).toMatchObject({id: "example.notes/index", version: 2, provider: "server", callers: ["browser"]});
        expect(t!.remoteDelegates![0]).toBe(restored);
        expect(s!.remoteDelegates).toEqual([records]);
        expect(() => definitionOf(manifest, "server")).toThrow("没有提供合同映射");
    });

    it("显示名与说明原样保留（去掉首尾空白），没写或是空串为 null", () => {
        expect(manifestOf({...base, displayName: " Daily Goal ", description: "每天写多少字"})).toMatchObject({displayName: "Daily Goal", description: "每天写多少字"});
        expect(manifestOf({...base, description: ""})).toMatchObject({displayName: null, description: null});
    });

    it("样式表路径原样保留，没写为 null", () => {
        expect(manifestOf({...base, style: "dist/style.css"}).style).toBe("dist/style.css");
        expect(manifestOf(base).style).toBeNull();
    });

    it("贡献点带 schema 时映射进定义；插件版本与版本要求也进定义", () => {
        const manifest = manifestOf({
            ...base,
            pluginVersions: {"example.tts": "^1.0.0"},
            contributionPoints: [{id: "example.notes.kinds", implementation: "none", schema: {type: "object", properties: {label: {type: "string"}}, required: ["label"]}}],
        });
        const definition = definitionOf(manifest, "server");
        expect(definition.version).toBe("1.0.0");
        expect(definition.pluginVersions).toEqual({"example.tts": "^1.0.0"});
        expect(definition.contributionPoints).toEqual([{id: "example.notes.kinds", implementation: "none", schema: {type: "object", properties: {label: {type: "string"}}, required: ["label"]}}]);
    });

    it("没有代码装载时，入口激活明确失败", () => {
        const entry = definitionOf(manifestOf({...base, entries: {ui: {location: "browser", main: "main.js"}}}), "browser").entries[0]!;
        expect(() => entry.activate({} as never)).toThrow("还没有装载代码");
    });

    it("任何插件都可以声明 remoteDelegates（ADR 0027）", () => {
        expect(readPluginManifest({...base, entries: {s: {location: "server", main: "s.js", remoteDelegates: ["acme.storage/records"]}}}).status).toBe("valid");
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

    it("内置插件可以用 acme. 前缀并约束内置插件版本", () => {
        expect(readPluginManifest({...base, publisher: "acme", pluginVersions: {"acme.editor": "^0.1.0"}}, {builtin: true}).status).toBe("valid");
    });

    // 每一行是一种使整份清单无效的原因，以及报告的字段路径。
    const invalid: ReadonlyArray<readonly [string, unknown, string]> = [
        ["缺少必需字段", {name: "notes"}, ""],
        ["缺少 engines.acme", {...base, engines: {}}, "engines"],
        ["publisher 不是单个 id 段", {...base, publisher: "@scope/x"}, "publisher"],
        ["name 含大写", {...base, name: "Notes"}, "name"],
        ["name 以数字开头（派生的视图、条目 id 每段要字母开头）", {...base, name: "2fa"}, "name"],
        ["contributionPoints 的 idPrefix 只能是 plugin", {...base, contributionPoints: [{id: "example.notes.kinds", implementation: "none", idPrefix: "publisher"}]}, "contributionPoints.0.idPrefix"],
        ["version 不是 semver", {...base, version: "1.0"}, "version"],
        ["第三方用 acme. 前缀", {...base, publisher: "acme"}, "publisher"],
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
        ["约束内置插件版本", {...base, pluginVersions: {"acme.editor": "^1.0.0"}}, "pluginVersions.acme.editor"],
        ["pluginVersions 的键不是插件 id", {...base, pluginVersions: {editor: "^1.0.0"}}, "pluginVersions.editor"],
        ["pluginVersions 的值不是版本范围", {...base, pluginVersions: {"example.tts": "latest"}}, "pluginVersions.example.tts"],
        ["engines.acme 不是版本范围", {...base, engines: {acme: "not a range"}}, "engines.acme"],
        ["贡献缺少字段", {...base, contributes: [{capability: "settings.properties"}]}, "contributes.0"],
        ["贡献点 implementation 不合法", {...base, contributionPoints: [{id: "x", implementation: "maybe"}]}, "contributionPoints.0.implementation"],
        ["贡献点 id 重复", {...base, contributionPoints: [{id: "x", implementation: "none"}, {id: "x", implementation: "none"}]}, "contributionPoints.1.id"],
        ["贡献点 schema 用了非标准 format", {...base, contributionPoints: [{id: "x", implementation: "none", schema: {type: "string", format: "my-format"}}]}, "contributionPoints.0.schema"],
        ["引用的合同不在 contracts 里", {...base, entries: {s: {location: "server", main: "s.js", remoteProvides: ["example.notes/index"]}}}, "entries.s.remoteProvides"],
        ["代理的合同不在 contracts 里", {...base, entries: {s: {location: "server", main: "s.js", remoteDelegates: ["other.x/y"]}}}, "entries.s.remoteDelegates"],
        ["合同的键与 id 不一致", {...base, contracts: {"example.notes/other": indexContractJson}}, "contracts.example.notes/other.id"],
        ["清单写了内置合同", {...base, contracts: {"acme.storage/records": {...indexContractJson, id: "acme.storage/records"}}}, "contracts.acme.storage/records"],
        // 结构问题与语义问题对同一合同用同一种路径：合同 id 原样一段。
        ["合同缺字段", {...base, contracts: {"example.notes/index": {id: "example.notes/index", version: 1}}}, "contracts.example.notes/index"],
        ["合同的入参允许多余字段", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, input: {type: "object", additionalProperties: true}}}}}}, "contracts.example.notes/index"],
        ["合同 schema 的 type 不是 JSON 类型", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {type: "nonsense"}}}}}}, "contracts.example.notes/index.methods.list.output"],
        ["合同 schema 引用外部 URI", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {$ref: "https://example.com/schema"}}}}}}, "contracts.example.notes/index.methods.list.output"],
        ["合同 schema 的本地引用解析不到", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {$defs: {A: {type: "string"}}, $ref: "#/$defs/B"}}}}}}, "contracts.example.notes/index.methods.list.output"],
        ["合同 schema 的引用百分号编码写坏", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {$defs: {a: {type: "string"}}, $ref: "#/$defs/a%"}}}}}}, "contracts.example.notes/index.methods.list.output"],
        ["合同 schema 的 draft-07 dependencies 里 type 写错", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {type: "object", dependencies: {a: {type: "nope"}}}}}}}}, "contracts.example.notes/index.methods.list.output.dependencies.a"],
        ["入口 id 含路径分隔符", {...base, entries: {"a/b": {location: "server", main: "s.js"}}}, "entries.a/b"],
        ["入口 id 是 ..", {...base, entries: {"..": {location: "server", main: "s.js"}}}, "entries..."],
        ["样式越出插件目录", {...base, style: "../style.css"}, "style"],
        ["合同 schema 里有坏的正则", {...base, contracts: {"example.notes/index": {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output: {type: "string", pattern: "("}}}}}}, "contracts.example.notes/index.methods.list.output"],
    ];

    for (const [name, value, path] of invalid) {
        it(`清单无效：${name}`, () => {
            expect(problemsOf(value)).toContain(path);
        });
    }

    it("schema 按关键字的语义检查：名为 type、format 的属性与 default、const 里的数据不算 schema；同一份 schema 里的引用可以用", () => {
        const output = Type.Object({
            type: Type.Literal("add"),
            format: Type.String(),
            options: Type.Object({format: Type.String()}, {default: {format: "markdown", type: "nope"}}),
            kind: Type.Unsafe({const: {type: "nope"}}),
        });
        const node = Type.Cyclic({Node: Type.Object({next: Type.Optional(Type.Ref("Node"))})}, "Node");
        const pointer = {$defs: {A: {type: "string"}}, type: "object", properties: {a: {$ref: "#/$defs/A"}}};
        const anchored = {$defs: {A: {$anchor: "item", type: "string"}}, type: "array", items: {$ref: "#item"}};
        const contract = {...indexContractJson, methods: {list: {...indexContractJson.methods.list, output}, tree: {...indexContractJson.methods.list, output: node}, pick: {...indexContractJson.methods.list, output: pointer}, anchor: {...indexContractJson.methods.list, output: anchored}}};
        const manifest = manifestOf(JSON.parse(JSON.stringify({...base, contracts: {"example.notes/index": contract}})));
        expect(Object.keys(manifest.contracts["example.notes/index"]!.methods).sort()).toEqual(["anchor", "list", "pick", "tree"]);
    });

    it("数据位置只接受 JSON 值：undefined、BigInt、Date、非有限数字都报出，manifestOf 不抛错", () => {
        for (const schema of [{enum: ["a", undefined]}, {type: "integer", default: 10n}, {type: "string", default: new Date(0)}, {type: "number", maximum: Number.POSITIVE_INFINITY}]) {
            expect(portabilityProblems(schema).length, JSON.stringify(schema, (_key, value: unknown) => (typeof value === "bigint" ? `${String(value)}n` : value))).toBeGreaterThan(0);
        }
        const result = build({descriptor: {id: "example.notes", version: "1.0.0", locations: ["server"]}, definitions: [{id: "example.notes", contributionPoints: [{id: "example.notes.kinds", implementation: "none", schema: {type: "integer", default: 10n} as never}], entries: []}], engine: "^0.1.0"});
        expect(result.status === "invalid" ? result.problems.map((problem) => problem.path) : []).toContain("contributionPoints.0.schema.default");
    });

    it("版本与范围按调用方给的 npm 写法校验：非法的预发布标识、写错的范围都无效", () => {
        expect(problemsOf({...base, version: "1.0.0-01"})).toContain("version");
        expect(problemsOf({...base, engines: {acme: ">=0.0.0-01"}})).toContain("engines.acme");
    });

    it("接受 npm 的常见范围写法", () => {
        for (const range of ["*", "0.1.0", ">=0.1.0", "^0.1", "~1.x", ">=0.1.0 <0.2.0", "1.0.0 - 2.0.0", "^0.1.0 || ^1.0.0", "0.1.0-beta.1", "=0.1.0", "1.0.0 ||"]) {
            expect(readPluginManifest({...base, engines: {acme: range}}).status, range).toBe("valid");
        }
    });

    it("问题按字段路径排序，同一输入总是同一结果", () => {
        const value = {...base, name: "Notes", publisher: "Bad", version: "x"};
        expect(problemsOf(value)).toEqual(["name", "publisher", "version"]);
    });
});

describe("生成清单：代码定义写成清单", () => {
    const index = defineRemoteService({
        id: "example.notes/index",
        version: 2,
        provider: "server",
        callers: ["browser"],
        methods: {list: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(Type.String()), effect: "read"}},
    });
    const descriptor = {id: "example.notes", version: "1.0.0", locations: ["server", "browser"]} as const;
    const kinds = {id: "example.notes.kinds", implementation: "none", schema: Type.Object({label: Type.String()})} as const;
    const server: PluginDefinition = {
        id: "example.notes",
        contributionPoints: [kinds],
        entries: [{id: "server", location: "server", remoteProvides: [index], activate: () => ({})}],
    };
    const browser: PluginDefinition = {id: "example.notes", entries: [{id: "browser", location: "browser", remoteDelegates: [index], activate: () => ({})}]};

    function built(definitions: ReadonlyArray<PluginDefinition>, options: {readonly builtin?: boolean} = {}): Record<string, unknown> {
        const result = build({descriptor, definitions, engine: "^0.1.0", pluginVersions: {"example.tts": "^1.0.0"}}, options);
        if (result.status !== "valid") throw new Error(`期望能写成清单：${JSON.stringify(result.problems)}`);
        return result.json;
    }

    it("写出的清单读得回来（生成结果直接带着读出的清单），再经 definitionOf 还原出同样的入口、合同与贡献点", () => {
        const manifest = manifestOf(built([server, browser, server]));
        expect(Object.keys(manifest.contracts)).toEqual(["example.notes/index"]);
        const back = definitionOf(manifest, "server");
        const contract = back.entries[0]!.remoteProvides![0]!;
        expect(JSON.parse(JSON.stringify(contract))).toEqual(JSON.parse(JSON.stringify(index)));
        expect(back.contributionPoints).toEqual([{id: "example.notes.kinds", implementation: "none", schema: JSON.parse(JSON.stringify(Type.Object({label: Type.String()})))}]);
        expect(back.pluginVersions).toEqual({"example.tts": "^1.0.0"});
        expect(definitionOf(manifest, "browser").entries[0]!.remoteDelegates![0]!.id).toBe("example.notes/index");
    });

    it("贡献点的 idPrefix 进清单，经 definitionOf 还原；两份定义各写一份相同的贡献点照常", () => {
        const prefixed = {...kinds, idPrefix: "plugin"} as const;
        const manifest = manifestOf(built([{...server, contributionPoints: [prefixed]}, {...browser, contributionPoints: [{...prefixed, schema: Type.Object({label: Type.String()})}]}]));
        expect(manifest.contributionPoints).toEqual([{id: "example.notes.kinds", implementation: "none", schema: JSON.parse(JSON.stringify(kinds.schema)), idPrefix: "plugin"}]);
        expect(definitionOf(manifest, "server").contributionPoints?.[0]?.idPrefix).toBe("plugin");
    });

    it("清单表达不了的代码定义报出问题：入口 id 重复、schema 进不了 JSON、同 id 两份不同的合同、贡献点写了 validate、几份定义的贡献点不一致", () => {
        const refined = defineRemoteService({...index, methods: {list: {...index.methods.list, output: Type.Refine(Type.String(), (value) => value.length > 0)}}});
        const changed = defineRemoteService({...index, callers: ["server"]});
        const cases: ReadonlyArray<readonly [string, ReadonlyArray<PluginDefinition>, string]> = [
            ["入口 id 重复", [server, {...browser, entries: [{...browser.entries[0]!, id: "server"}]}], "entries.server"],
            ["合同用了 Refine", [{...server, entries: [{...server.entries[0]!, remoteProvides: [refined]}]}], "contracts.example.notes/index.methods.list.output"],
            ["同一 id 两份不同的合同", [server, {...browser, entries: [{...browser.entries[0]!, remoteDelegates: [changed]}]}], "contracts.example.notes/index"],
            ["入口 id 含路径分隔符", [{...server, entries: [{...server.entries[0]!, id: "a/b"}]}], "entries.a/b"],
            ["贡献点只写了 validate", [{...server, contributionPoints: [{id: "example.notes.kinds", implementation: "none", validate: () => null}]}], "contributionPoints.0"],
            ["贡献点同时写了 schema 与 validate", [{...server, contributionPoints: [{...kinds, validate: () => null}]}], "contributionPoints.0"],
            // 同一个贡献点在两个运行位置的定义里各写一份：后一份的问题同样报出，不随定义的先后漏掉。
            ["后一份定义的贡献点写了 validate", [server, {...browser, contributionPoints: [{...kinds, validate: () => null}]}], "contributionPoints.0"],
            ["前一份定义的贡献点写了 validate", [{...browser, contributionPoints: [{...kinds, validate: () => null}]}, server], "contributionPoints.0"],
            ["两份定义的 idPrefix 不同", [server, {...browser, contributionPoints: [{...kinds, idPrefix: "plugin"}]}], "contributionPoints.0"],
            ["两份定义的 schema 不同", [server, {...browser, contributionPoints: [{...kinds, schema: Type.Object({label: Type.Number()})}]}], "contributionPoints.0"],
        ];
        for (const [name, definitions, path] of cases) {
            const result = build({descriptor, definitions, engine: "^0.1.0"});
            expect(result.status === "invalid" ? result.problems.map((problem) => problem.path) : [], name).toContain(path);
        }
    
        // 两份定义各写一个对象、带着同样的问题：同一条问题只报一次。
        const unportable = () => ({id: "example.notes.kinds", implementation: "none", schema: Type.Object({label: Type.Refine(Type.String(), (value) => value.length > 0)}), validate: () => null} as const);
        const twice = build({descriptor, definitions: [{...server, contributionPoints: [unportable()]}, {...browser, contributionPoints: [unportable()]}], engine: "^0.1.0"});
        const paths = twice.status === "invalid" ? twice.problems.map((problem) => problem.path) : [];
        expect(paths.filter((path) => path === "contributionPoints.0")).toHaveLength(1);
        expect(paths.filter((path) => path.startsWith("contributionPoints.0.schema"))).toHaveLength(1);
    });

    it("生成结果带着读出的清单；description 与 license 由内核写进清单", () => {
        const result = build({descriptor, definitions: [server], engine: "^0.1.0", description: "笔记", license: "MIT"});
        if (result.status !== "valid") throw new Error(JSON.stringify(result.problems));
        expect(result.json).toMatchObject({description: "笔记", license: "MIT", engines: {acme: "^0.1.0"}});
        expect(result.manifest).toMatchObject({id: "example.notes", engine: "^0.1.0"});
    });

    it("生成的清单读不回来时给出读清单的问题：第三方插件用了保留发布者", () => {
        const reserved = {id: "acme.notes", version: "1.0.0", locations: []} as const;
        const result = build({descriptor: reserved, definitions: [], engine: "^0.1.0"});
        expect(result.status === "invalid" ? result.problems.map((problem) => problem.path) : []).toContain("publisher");
        expect(build({descriptor: reserved, definitions: [], engine: "^0.1.0"}, {builtin: true}).status).toBe("valid");
    });

    it("内置插件的贡献点可以只写 validate：随产品代码装配，不经清单登记", () => {
        expect(built([{...server, contributionPoints: [{id: "example.notes.kinds", implementation: "none", validate: () => null}]}], {builtin: true}).contributionPoints).toEqual([{id: "example.notes.kinds", implementation: "none"}]);
    });
});

describe("平台档案", () => {
    it("引擎键与保留发布者随平台：同一份清单在另一个平台上要写那个平台的引擎键，acme 在那里只是普通发布者", () => {
        const other = createManifestFormat({engine: "other", reservedPublishers: ["other"]}, versions);
        const manifest = {...base, publisher: "acme", engines: {other: "^1.0.0"}};
        const read = other.read(manifest);
        expect(read.status === "valid" ? read.manifest.engine : read.problems).toBe("^1.0.0");
        expect(problemsOf(manifest)).toContain("engines");
        const reserved = other.read({...manifest, publisher: "other"});
        expect(reserved.status === "invalid" ? reserved.problems.map((problem) => problem.path) : []).toContain("publisher");
    });

    it("内核的 runtime 命名空间在任何平台上都保留：第三方插件不能用，内置判断认它", () => {
        expect(problemsOf({...base, publisher: "runtime"})).toContain("publisher");
        expect(format.isBuiltinId("runtime.diagnostics")).toBe(true);
        expect(format.isBuiltinId("acme.files/files")).toBe(true);
        expect(format.isBuiltinId("example.notes")).toBe(false);
        expect(format.isReservedPublisher("acme")).toBe(true);
    });
});

describe("消息目录（l10n 与目录内容）", () => {
    it("l10n 读成源语言与语言列表；没写为 null；生成清单原样写出", () => {
        expect(manifestOf({...base, l10n: {source: "zh-CN", locales: ["zh-CN", "en-US"]}}).l10n).toEqual({source: "zh-CN", locales: ["zh-CN", "en-US"]});
        expect(manifestOf(base).l10n).toBeNull();
        const built = build({descriptor: {id: "example.notes", version: "1.0.0", locations: []}, definitions: [], engine: "^0.1.0", l10n: {source: "en-US", locales: ["en-US"]}});
        expect(built.status === "valid" ? [built.json.l10n, built.manifest.l10n] : built.problems).toEqual([{source: "en-US", locales: ["en-US"]}, {source: "en-US", locales: ["en-US"]}]);
    });

    it("形状不对时整份清单无效：源语言不在列表里、语言重复、不是规范写法、不是语言标签、空列表、多出字段", () => {
        expect(problemsOf({...base, l10n: {source: "fr", locales: ["zh-CN"]}})).toEqual(["l10n.source"]);
        expect(problemsOf({...base, l10n: {source: "zh-CN", locales: ["zh-CN", "zh-CN"]}})).toEqual(["l10n.locales.1"]);
        // zh-cn 是合法标签，但登记进引擎的标签与界面语言 zh-CN 对不上：要求规范写法。
        expect(problemsOf({...base, l10n: {source: "zh-cn", locales: ["zh-cn"]}})).toEqual(["l10n.locales.0", "l10n.source"]);
        expect(problemsOf({...base, l10n: {source: "zh-CN", locales: ["zh-CN", "not a tag"]}})).toEqual(["l10n.locales.1"]);
        expect(problemsOf({...base, l10n: {source: "zh-CN", locales: []}})).toEqual(["l10n.locales"]);
        expect(problemsOf({...base, l10n: {source: "zh-CN", locales: ["zh-CN"], fallback: "en-US"}})).toEqual(["l10n"]);
    });

    it("目录内容：叶子是字符串或嵌套对象，键不含冒号，值不含 $t(；问题的路径是点号键路径", () => {
        expect(catalogProblems({manifest: {displayName: "笔记"}, errors: {"not-found": "没有 {{name}}"}})).toEqual([]);
        expect(catalogProblems({a: 1, b: {c: null, d: ["x"]}, "ns:key": "x", e: {f: "见 $t(other.key)"}}).map((problem) => problem.path)).toEqual(["a", "ns:key", "b.c", "b.d", "e.f"]);
        expect(catalogProblems(["x"])).toEqual([{path: "", message: expect.stringContaining("数组")}]);
        expect(catalogProblems("x")).toEqual([{path: "", message: expect.stringContaining("string")}]);
    });

    it("目录文件：不是 JSON 时报解析错误；嵌套极深也只得到问题，不抛栈溢出", () => {
        expect(parseCatalog("{")).toMatchObject({ok: false, problems: [{path: "", message: expect.stringContaining("JSON")}]});
        expect(parseCatalog(JSON.stringify({a: "x"}))).toEqual({ok: true, catalog: {a: "x"}});
        const deep = `${"{\"a\":".repeat(20_000)}1${"}".repeat(20_000)}`;
        const result = parseCatalog(deep);
        expect(result.ok ? [] : result.problems.map((problem) => problem.message)).toEqual([expect.stringContaining("number")]);
        expect(catalogFile("zh-CN")).toBe("locales/zh-CN.json");
    });
});

describe("runtime plugin-manifest 模块边界", () => {
    it("源码只导入本目录、TypeBox 与 lifecycle、services、plugins、remote 的公开入口", async () => {
        const moduleDir = dirname(fileURLToPath(import.meta.url));
        const sources = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
        expect(sources).toContain("plugin-manifest.ts");
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
            for (const specifier of specifiers) {
                const allowed = /^\.\/[^/]+$/u.test(specifier) || /^(?:typebox|typebox\/value|\.\.\/lifecycle\/lifecycle|\.\.\/services\/services|\.\.\/plugins\/plugins|\.\.\/remote\/remote)$/u.test(specifier);
                expect(allowed, `${name} 导入了 ${specifier}`).toBe(true);
            }
            expect(code, `${name} 不得引用宿主全局对象`).not.toMatch(/\b(?:process|window|document)\./u);
        }
    });
});
