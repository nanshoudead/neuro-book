/**
 * SDK 的导出面（docs/specs/runtime/plugin-api.md 的“SDK”“边界与兼容”）：每导出一项都进入 `engines.neurobook` 的兼容
 * 范围，这里把运行时导出的名字钉住，增删都要显式改这份清单。类型导出的名字由 `build:sdk` 生成的声明文件另行核对。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {SDK_ENTRIES} from "./entries";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");

/** 一份 tsconfig 里 SDK 包名的路径别名（tsconfig 允许注释与尾逗号，这里的两份没有，按 JSON 读）。 */
function sdkPaths(file: string): Record<string, ReadonlyArray<string>> {
    const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, file), "utf8")) as {compilerOptions: {paths: Record<string, ReadonlyArray<string>>}};
    return Object.fromEntries(Object.entries(config.compilerOptions.paths).filter(([name]) => name.startsWith("@notnotype/nb-plugin-sdk")));
}

describe("SDK 的导出面", () => {
    it("各运行位置通用的部分", async () => {
        expect(Object.keys(await import("./index")).sort()).toEqual([
            "COMMANDS_POINT",
            "SETTINGS_CHOICES_POINT",
            "SETTINGS_PAGES_POINT",
            "SETTINGS_SECTIONS_POINT",
            "WORKBENCH_STATUSBAR_ITEMS_POINT",
            "WORKBENCH_VIEWS_POINT",
            "defineEntry",
            "definePublicState",
            "defineRecord",
            "defineRemoteService",
            "defineServiceKey",
            "defineSetting",
            "defineStore",
            "diagnosticsKey",
            "displayLocale",
            "formatText",
            "hostClockKey",
            "hostStateRootKey",
            "localize",
            "orThrow",
            "provide",
            "providePerConsumer",
            "provideRemote",
            "settingsChoicesEvent",
            "settingsKey",
            "storageKey",
        ]);
    });

    it("只在浏览器入口里用的部分", async () => {
        expect(Object.keys(await import("./browser")).sort()).toEqual([
            "SettingsPageActions",
            "SettingsPageList",
            "SettingsRow",
            "SettingsSaveBar",
            "settingsPageContribution",
            "viewContribution",
        ]);
    });

    it("组件子路径逐个列名：nb-ui 入口里给工作台用的内部件不对外（Bun 加载不了单文件组件，按源码核对名单）", () => {
        const source = readFileSync(join(import.meta.dir, "components.ts"), "utf8");
        expect(source).not.toMatch(/export \*/u);
        const names = [...source.matchAll(/export (?:type )?\{([^}]+)\}/gu)].flatMap((match) => match[1]!.split(",").map((name) => name.trim()).filter((name) => name !== ""));
        expect(names).toContain("Button");
        expect(names.filter((name) => /^(?:createGrid|Grid|NB_FIELD|useFieldContext|suggestionMenuOptions|Splitter(?:Gesture))/u.test(name))).toEqual([]);
    });
});

describe("SDK 的子路径表", () => {
    it("两份 tsconfig 的 SDK 别名与子路径表一致：新增子路径漏改一处时这里失败", () => {
        const expected = Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.specifier, [`./src/sdk/${entry.file}`]]));
        expect(sdkPaths("tsconfig.json")).toEqual(expected);
        expect(sdkPaths("tsconfig.web.json")).toEqual(expected);
    });
});
