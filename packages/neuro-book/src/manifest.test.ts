/**
 * 各运行位置登记哪些插件、登记什么定义（runtime/plugin-manifest.md 输出 11）：三个宿主与浏览器引导共用的两条规则。
 */

import {describe, expect, it} from "bun:test";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt, pluginsAt} from "./manifest";
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
