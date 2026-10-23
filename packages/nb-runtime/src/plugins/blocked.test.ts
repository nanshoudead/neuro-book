import {describe, expect, it} from "bun:test";

import {defineServiceKey} from "../services/services";
import {deriveBlocked, previewBlocked} from "./blocked";
import type {EntrySnapshot} from "./blocked";
import type {EntryBlocked} from "./contracts";

const a = defineServiceKey("a/service");
const b = defineServiceKey("b/service");
const c = defineServiceKey("c/service");
const missing = defineServiceKey("missing/service");

function entry(plugin: string, provides: EntrySnapshot["provides"], dependencies: EntrySnapshot["dependencies"] = [], status: EntrySnapshot["status"] = "registered"): EntrySnapshot {
    return {plugin, entry: "main", location: "server", pluginVersion: null, pluginVersions: {}, provides, dependencies, status};
}

/** 只认“x.y.z 的主版本等于 ^x 的 x”：够测推导，不引入 semver。 */
const caret = (version: string, range: string): boolean => range.startsWith("^") && version.split(".")[0] === range.slice(1).split(".")[0];

describe("入口受阻纯推导", () => {
    it("只检查本位置必需依赖，并报告声明顺序中第一个缺失键", () => {
        const entries = [entry("a", [a], [{key: b, required: false}, {key: missing}, {key: c}]), {...entry("b", [b], [{key: missing}]), location: "browser" as const}];
        expect([...deriveBlocked(entries, "server", new Set())]).toEqual([
            ["a/main", {reason: "missing-service", key: missing.name, path: ["a/main"]}], ["b/main", null],
        ]);
        expect(deriveBlocked(entries, "server", new Set([missing.name, c.name])).get("a/main")).toBeNull();
    });

    it("跨位置提供方为位置不匹配，提供方失败独立于其缺失依赖", () => {
        const entries = [entry("a", [a], [{key: b}]), {...entry("b", [b]), location: "browser" as const}];
        expect(deriveBlocked(entries, "server", new Set()).get("a/main")).toEqual({reason: "location-mismatch", key: b.name, path: ["a/main"]});
        entries[1] = entry("b", [b], [{key: missing}], "failed");
        expect(deriveBlocked(entries, "server", new Set()).get("a/main")).toEqual({reason: "provider-failed", key: b.name, path: ["a/main", "b/main"]});
    });

    it("传递受阻路径连接全部入口，重复推导和三种登记顺序得到同样结果", () => {
        const entries = [entry("a", [a], [{key: b}]), entry("b", [b], [{key: c}]), entry("c", [c], [{key: missing}])];
        const expected: EntryBlocked = {reason: "provider-blocked", key: b.name, path: ["a/main", "b/main", "c/main"]};
        for (const order of [entries, [...entries].reverse(), [entries[1]!, entries[0]!, entries[2]!]]) {
            expect(deriveBlocked(order, "server", new Set()).get("a/main")).toEqual(expected);
            expect(deriveBlocked(order, "server", new Set()).get("a/main")).toEqual(expected);
        }
    });

    it("依赖环只标记环成员，环外依赖方受提供方受阻，无关入口不受影响", () => {
        const entries = [entry("a", [a], [{key: b}]), entry("b", [b], [{key: a}]), entry("c", [c], [{key: a}]), entry("other", [])];
        const blocked = deriveBlocked(entries, "server", new Set());
        expect(blocked.get("a/main")).toEqual({reason: "dependency-cycle", key: b.name, path: ["a/main", "b/main", "a/main"]});
        expect(blocked.get("b/main")).toEqual({reason: "dependency-cycle", key: a.name, path: ["b/main", "a/main", "b/main"]});
        expect(blocked.get("c/main")).toEqual({reason: "provider-blocked", key: a.name, path: ["c/main", "a/main", "b/main", "a/main"]});
        expect(blocked.get("other/main")).toBeNull();
    });

    it("必需依赖的提供方版本不在要求的范围内时受阻，依赖它的入口传递受阻；同插件、没写范围与可选依赖不核对", () => {
        const consumer = {...entry("a", [a], [{key: b}]), pluginVersions: {b: "^2.0.0"}};
        const provider = {...entry("b", [b]), pluginVersion: "1.4.0"};
        const downstream = entry("c", [c], [{key: a}]);
        const blocked = deriveBlocked([consumer, provider, downstream], "server", new Set(), caret);
        expect(blocked.get("a/main")).toEqual({reason: "version-mismatch", key: b.name, path: ["a/main", "b/main"], version: "1.4.0", range: "^2.0.0"});
        expect(blocked.get("c/main")).toEqual({reason: "provider-blocked", key: a.name, path: ["c/main", "a/main", "b/main"]});
        expect(deriveBlocked([consumer, {...provider, pluginVersion: "2.1.0"}], "server", new Set(), caret).get("a/main")).toBeNull();
        expect(deriveBlocked([{...consumer, dependencies: [{key: b, required: false}]}, provider], "server", new Set(), caret).get("a/main")).toBeNull();
        expect(deriveBlocked([{...consumer, pluginVersions: {}}, provider], "server", new Set(), caret).get("a/main")).toBeNull();
    });

    it("按定义预览：定义之外的服务当作在场；只推出版本不符与经它传递的受阻", () => {
        const tts = {id: "x.tts", version: "2.0.0", entries: [{id: "main", location: "server" as const, provides: [b], activate: () => ({})}]};
        const reader = {id: "x.reader", pluginVersions: {"x.tts": "^1.0.0"}, entries: [{id: "main", location: "server" as const, provides: [a], dependencies: [{key: b}, {key: missing}], activate: () => ({})}]};
        const panel = {id: "x.panel", entries: [{id: "main", location: "server" as const, dependencies: [{key: a}], activate: () => ({})}]};
        const blocked = previewBlocked([tts, reader, panel], "server", caret);
        expect(blocked.get("x.reader/main")).toMatchObject({reason: "version-mismatch", version: "2.0.0", range: "^1.0.0"});
        expect(blocked.get("x.panel/main")).toMatchObject({reason: "provider-blocked", path: ["x.panel/main", "x.reader/main", "x.tts/main"]});
        expect(previewBlocked([{...tts, version: "1.5.0"}, reader, panel], "server", caret).get("x.reader/main")).toBeNull();
    });
});

