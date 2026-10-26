/**
 * 各运行位置登记哪些插件、登记什么定义（runtime/plugin-manifest.md 输出 11）：三个宿主与浏览器引导共用的两条规则。
 */

import {describe, expect, it} from "bun:test";

import type {HostContext} from "@notnotype/nb-runtime/application";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {ActivationOutput, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineRemoteService, provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import {createApplication} from "nbook/application";
import {manifestFormat} from "nbook/plugin-platform-profile";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";

import {definitionAt, pluginsAt, thirdPartyDefinitionAt} from "./manifest";
import type {PluginDescriptor} from "./manifest";

const setting = {capability: "settings.properties", id: "x.panel/theme", declaration: {}};
const browserOnly: PluginDescriptor = {id: "x.panel", version: "1.0.0", locations: ["browser"], contributions: [setting]};
const serverOnly: PluginDescriptor = {id: "x.job", version: "1.0.0", locations: ["server"]};
const browserDefinition: PluginDefinition = {id: "x.panel", entries: [{id: "browser", location: "browser", activate: () => ({})}]};

describe("pluginsAt", () => {
    it("本位置有入口的插件，加上有顶层声明式贡献的插件；其它位置的、没有声明的不在其中", () => {
        expect(pluginsAt("server", [browserOnly, serverOnly]).map((plugin) => plugin.id)).toEqual(["x.panel", "x.job"]);
        expect(pluginsAt("browser", [browserOnly, serverOnly]).map((plugin) => plugin.id)).toEqual(["x.panel"]);
        expect(pluginsAt("project", [browserOnly, serverOnly]).map((plugin) => plugin.id)).toEqual(["x.panel"]);
    });
});

describe("definitionAt", () => {
    it("本位置有入口：定义并上描述的版本与顶层贡献；没有入口：只含版本与顶层贡献、入口为空", () => {
        expect(definitionAt("browser", browserOnly, browserDefinition)).toEqual({...browserDefinition, version: "1.0.0", contributions: [setting]});
        expect(definitionAt("server", browserOnly, undefined)).toEqual({id: "x.panel", version: "1.0.0", entries: [], contributions: [setting]});
        const job: PluginDefinition = {id: "x.job", entries: [{id: "server", location: "server", activate: () => ({})}]};
        expect(definitionAt("server", serverOnly, job)).toEqual({...job, version: "1.0.0"});
    });

    it("描述写了本位置却没有定义，或定义的 id 不符：直接失败，指名插件", () => {
        expect(() => definitionAt("browser", browserOnly, undefined)).toThrow("x.panel");
        expect(() => definitionAt("browser", browserOnly, {...browserDefinition, id: "x.rogue"})).toThrow("x.rogue");
    });
});

describe("thirdPartyDefinitionAt：插件代码产出的合同换成清单登记的那份", () => {
    const contract = (callers: ReadonlyArray<"browser" | "server">, name = "list"): RemoteContract => defineRemoteService({
        id: "x.notes/index",
        version: 1,
        provider: "server",
        callers,
        methods: {[name]: {
            input: Type.Object({filter: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("open")]))}, {additionalProperties: false}),
            output: Type.Array(Type.Object({at: Type.String({format: "date-time"})})),
            effect: "read",
            errors: {gone: Type.Object({id: Type.String()})},
        }},
    });
    const other = defineRemoteService({id: "x.notes/other", version: 1, provider: "server", callers: ["browser"], methods: {ping: {input: Type.Object({}, {additionalProperties: false}), output: Type.Null(), effect: "read"}}});
    const cacheKey = defineServiceKey<{readonly n: number}>("x.notes/cache");

    /** 插件构建时的代码定义写成清单、经 JSON 交给宿主：宿主手里的合同是 `definitionOf` 从清单还原的另一份对象。 */
    function installed(): PluginManifest {
        const built = manifestFormat.build({
            descriptor: {id: "x.notes", version: "1.0.0", locations: ["server"]},
            definitions: [{id: "x.notes", entries: [{id: "server", location: "server", provides: [cacheKey], remoteProvides: [contract(["browser"]), other], activate: () => ({})}]}],
            engine: "^0.1.0",
        });
        if (built.status !== "valid") throw new Error(JSON.stringify(built.problems));
        const read = manifestFormat.read(JSON.parse(JSON.stringify(built.json)));
        if (read.status !== "valid") throw new Error(JSON.stringify(read.problems));
        return read.manifest;
    }

    async function activate(output: () => ActivationOutput) {
        const definition = thirdPartyDefinitionAt("server", installed(), {load: async () => () => output()});
        const context: HostContext = {identity: {location: "server", instanceId: `settle-${String(Math.random())}`}, stopSignal: new AbortController().signal, emergency: () => undefined};
        const app = createApplication(context, {plugins: [definition], gates: [], satisfies: pluginVersionSatisfies});
        await app.startup;
        const result = await app.plugins.activate({plugin: "x.notes", entry: "server"});
        await app.stop();
        return result;
    }

    const handlers = {methods: {list: async () => ({ok: true as const, value: []})}};
    const ping = provideRemote(other, () => ({methods: {ping: async () => ({ok: true as const, value: null})}}));

    it("内容相同（键的先后、Optional、Union、format、errors 都一样）：每个合同都换成登记的那份，入口激活", async () => {
        const result = await activate(() => ({services: [{key: cacheKey, instance: {n: 1}}], remote: [provideRemote(contract(["browser"]), () => handlers), ping]}));
        expect(result).toMatchObject({status: "activated"});
    });

    it("内容不同（调用方种类不同）：内核以 remote-contract-mismatch 拒绝，已产出的服务释放恰好一次", async () => {
        let released = 0;
        const result = await activate(() => ({services: [{key: cacheKey, instance: {n: 1}, release: () => void (released += 1)}], remote: [provideRemote(contract(["browser", "server"]), () => handlers), ping]}));
        expect(result).toMatchObject({status: "failed", stage: "output", reason: "remote-contract-mismatch", key: "x.notes/index"});
        expect(released).toBe(1);
    });

    it("合同里有 JSON 表达不了的值（BigInt）：按内容不同处理，不抛错，释放照常", async () => {
        let released = 0;
        const odd = {...contract(["browser"]), extra: 1n} as unknown as RemoteContract;
        const result = await activate(() => ({services: [{key: cacheKey, instance: {n: 1}, release: () => void (released += 1)}], remote: [provideRemote(odd, () => handlers), ping]}));
        expect(result).toMatchObject({status: "failed", stage: "output", reason: "remote-contract-mismatch", key: "x.notes/index"});
        expect(released).toBe(1);
    });
});
