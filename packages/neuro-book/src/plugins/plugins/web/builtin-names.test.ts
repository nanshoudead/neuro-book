/** 插件页的内置插件名称表与产品清单对得上：新加的内置插件有名称，改名、删掉的不留在表里。 */

import {describe, expect, it} from "bun:test";

import {productPlugins} from "nbook/manifest";

import {BUILTIN_PLUGIN_NAMES} from "./builtin-names";

describe("内置插件的名称表", () => {
    it("产品清单里每个插件都有中英两种名称与说明，表里没有清单之外的 id", () => {
        const ids = productPlugins.map((plugin) => plugin.id).sort();
        expect(Object.keys(BUILTIN_PLUGIN_NAMES).sort()).toEqual(ids);
        for (const entry of Object.values(BUILTIN_PLUGIN_NAMES)) {
            for (const text of [entry.name, entry.description]) expect(text["zh-CN"] !== "" && text["en-US"] !== "").toBe(true);
        }
    });
});
