/**
 * SDK 的导出面（docs/specs/runtime/plugin-api.md 的“SDK”“边界与兼容”）：每导出一项都进入 `engines.neurobook` 的兼容
 * 范围，这里把运行时导出的名字钉住，增删都要显式改这份清单。类型导出的名字由 `build:sdk` 生成的声明文件另行核对。
 */

import {describe, expect, it} from "bun:test";

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
});
