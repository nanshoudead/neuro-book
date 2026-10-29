/**
 * docs/specs/settings/configuration.md 的界面语言：取值、设置窗口的选项与“切换界面语言”命令的参数都由宿主的语言集合生成，
 * 加一种语言时三者一起变。设置的写入（`settings/shared/layers.ts`）与文件读取（`settings/shared/layer-text.ts`）都用
 * `Value.Check(declaration.schema, value)` 校验值，这里按同样的方式核对。
 */

import {describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {portabilityProblems} from "@notnotype/nb-runtime/plugins";

import {localeSettingFor, localeSetting} from "nbook/plugins/settings/shared/contracts";
import {SWITCH_LOCALE_DECLARATION} from "nbook/plugins/settings/web/plugin";

import {HOST_LOCALES, hostLocaleSchema} from "./host-locales";
import type {HostLocale} from "./host-locales";

const THREE: readonly HostLocale[] = [...HOST_LOCALES, {tag: "ja-JP", name: "日本語"}];

describe("界面语言由宿主的语言集合生成", () => {
    it("设置值接受集合里的语言，拒绝集合外的", () => {
        const setting = localeSettingFor(THREE);
        for (const locale of THREE) expect(Value.Check(setting.declaration.schema, locale.tag)).toBe(true);
        expect(Value.Check(setting.declaration.schema, "fr-FR")).toBe(false);
        expect(Value.Check(localeSetting.declaration.schema, "ja-JP")).toBe(false);
    });

    it("设置窗口的选项与集合一一对应，语言名用它自己的语言写", () => {
        const choices = localeSettingFor(THREE).declaration.choices;
        expect(Array.isArray(choices) ? choices.map((choice) => choice.value) : null).toEqual(["zh-CN", "en-US", "ja-JP"]);
        expect(Array.isArray(choices) ? choices[2]?.title : null).toEqual({"zh-CN": "日本語", "en-US": "日本語"});
    });

    it("切换界面语言命令的参数与设置接受同一组语言", () => {
        const args = SWITCH_LOCALE_DECLARATION.args;
        for (const locale of HOST_LOCALES) expect(Value.Check(args, {locale: locale.tag})).toBe(true);
        expect(Value.Check(args, {locale: "ja-JP"})).toBe(false);
    });

    it("schema 是纯 JSON Schema，序列化后仍是常量的 anyOf", () => {
        expect(portabilityProblems(hostLocaleSchema(THREE))).toEqual([]);
        expect(JSON.parse(JSON.stringify(hostLocaleSchema(THREE)))).toEqual({anyOf: THREE.map((locale) => ({type: "string", const: locale.tag}))});
    });
});
