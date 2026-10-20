/**
 * 配置项的定义与声明校验（docs/specs/settings/configuration.md 输入“声明”、输出 1、21）。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineSetting, defineSettings, SETTINGS_POINT, settingDeclarationProblem} from "./settings";
import type {SettingDeclaration, SettingDefinition, SettingsService} from "./settings";

const title = {"zh-CN": "主题", "en-US": "Theme"};
const theme = Type.Union([Type.Literal("nbook"), Type.Literal("macos")]);

function declaration(overrides: Partial<Record<keyof SettingDeclaration, unknown>> = {}): Record<string, unknown> {
    return {schema: theme, default: "nbook", title, layers: ["user", "project"], applies: "now", ...overrides};
}

describe("defineSetting", () => {
    it("键是 <插件 id>/<名>，缺省两层都允许、改动立即生效；贡献写到贡献点 settings.properties，id 就是键", () => {
        const setting = defineSetting({plugin: "nbook.workbench", name: "theme", schema: theme, default: "nbook", title});
        expect(setting.key).toBe("nbook.workbench/theme");
        expect(setting.declaration).toMatchObject({default: "nbook", layers: ["user", "project"], applies: "now"});
        expect(setting.contribution).toEqual({capability: SETTINGS_POINT, id: "nbook.workbench/theme", declaration: setting.declaration});
    });

    it("默认值复制后逐层冻结：改原对象不影响定义，定义里的值改不动", () => {
        const original = {size: 12, families: ["serif"]};
        const setting = defineSetting({plugin: "x.editor", name: "font", schema: Type.Object({size: Type.Number(), families: Type.Array(Type.String())}), default: original, title});
        original.families.push("mono");
        expect(setting.declaration.default).toEqual({size: 12, families: ["serif"]});
        expect(Object.isFrozen(setting.declaration.default)).toBe(true);
        expect(Object.isFrozen((setting.declaration.default as {families: string[]}).families)).toBe(true);
    });

    it("不合规则的定义在加载时抛 TypeError", () => {
        expect(() => defineSetting({plugin: "x.editor", name: "Font", schema: theme, default: "nbook", title})).toThrow(TypeError);
        expect(() => defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "solarized" as "nbook", title})).toThrow("不符合 schema");
    });
});

describe("defineSettings：一个插件的多条配置项", () => {
    const bundle = defineSettings("x.editor", {
        "code.fontSize": {schema: Type.Integer({minimum: 8, maximum: 40}), default: 14, title},
        "code.fontFamily": {schema: Type.String(), default: "", title},
        "code.margins": {schema: Type.Object({top: Type.Number(), bottom: Type.Number()}), default: {top: 1, bottom: 2}, title},
        contributions: {schema: theme, default: "nbook", title, choices: [{value: "nbook", title}, {value: "macos", title}]},
    });

    it("插件 id 只写一次；结果与逐条 defineSetting 相同，贡献按声明的顺序", () => {
        const single = defineSetting({plugin: "x.editor", name: "code.fontSize", schema: Type.Integer({minimum: 8, maximum: 40}), default: 14, title});
        expect(bundle.settings["code.fontSize"]).toEqual(single);
        expect(bundle.contributions.map((contribution) => contribution.id)).toEqual(["x.editor/code.fontSize", "x.editor/code.fontFamily", "x.editor/code.margins", "x.editor/contributions"]);
        // 名叫 contributions 的配置项不和结果撞。
        expect(bundle.settings.contributions.key).toBe("x.editor/contributions");
    });

    it("每项的值类型由自己的 schema 推出：错的默认值与写入编译不过", () => {
        const fontSize: SettingDefinition<number> = bundle.settings["code.fontSize"];
        const margins: SettingDefinition<{top: number; bottom: number}> = bundle.settings["code.margins"];
        const theme_: SettingDefinition<"nbook" | "macos"> = bundle.settings.contributions;
        // 只做类型检查，不执行。
        const typeOnly = (settings: SettingsService) => {
            void settings.update(fontSize, 12);
            // @ts-expect-error 字号是数
            void settings.update(bundle.settings["code.fontSize"], "12");
            // @ts-expect-error 字面量联合之外的值
            void settings.update(bundle.settings.contributions, "solarized");
            defineSettings("x.editor", {
                // @ts-expect-error 默认值不符合这一项的 schema
                size: {schema: Type.Integer(), default: "big", title},
            });
        };
        expect([typeof typeOnly, margins.key, theme_.key]).toEqual(["function", "x.editor/code.margins", "x.editor/contributions"]);
    });

    it("有一项不合规则时整体抛 TypeError，写明是哪一项", () => {
        expect(() => defineSettings("x.editor", {ok: {schema: Type.Boolean(), default: true, title}, Bad: {schema: Type.Boolean(), default: true, title}})).toThrow("Bad");
    });
});

describe("settingDeclarationProblem：只看这一条声明", () => {
    it("合格的声明没有问题；名字可以以点分段", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration())).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/editor.fontSize", declaration({schema: Type.Number(), default: 14}))).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: title, layers: ["user"], applies: "restart", secret: false}))).toBeNull();
    });

    it("键前缀不是贡献方插件、名字不合规则或超过 128 个字符", () => {
        expect(settingDeclarationProblem("x.editor", "x.other/theme", declaration())).toContain("x.editor/<名>");
        for (const name of ["Theme", "font-size", "editor..size", "1st", ".size", "size."]) {
            expect(settingDeclarationProblem("x.editor", `x.editor/${name}`, declaration()), name).toContain("不合规则");
        }
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(129)}`, declaration())).toContain("128");
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(128)}`, declaration())).toBeNull();
    });

    it("默认值必须是 JSON 能如实表示的值且符合 schema：undefined、NaN、Date、Map 都被拒", () => {
        const any = Type.Unknown();
        for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map(), () => 1]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: any, default: value})), String(value)).toContain("JSON");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({default: "solarized"}))).toContain("不符合 schema");
    });

    it("schema 不能 JSON 序列化、layers 为空或有未知层或重复、title 缺语言、有未知字段", () => {
        const schemaWithFunction = {...theme, check: () => true};
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: schemaWithFunction}))).toContain("schema");
        for (const layers of [[], ["machine"], ["user", "user"], "user"]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({layers})), JSON.stringify(layers)).toContain("layers");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({title: {"zh-CN": "主题"}}))).toContain("title");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: "主题"}))).toContain("description");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", {...declaration(), scope: "machine"})).toContain("scope");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", null)).toContain("对象");
    });

    it("声明 secret: true 被拒，原因写明密钥存储尚未实现", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/token", declaration({schema: Type.String(), default: "", secret: true}))).toContain("密钥存储尚未实现");
    });
});

describe("界面字段（输出 21）", () => {
    const choices = [{value: "nbook", title: {"zh-CN": "NeuroBook", "en-US": "NeuroBook"}}, {value: "macos", title: {"zh-CN": "macOS", "en-US": "macOS"}, description: title}];
    const check = (overrides: Partial<Record<keyof SettingDeclaration | "restart", unknown>>): string | null => settingDeclarationProblem("x.editor", "x.editor/theme", declaration(overrides));

    it("合格的界面字段：分区可以是别的插件的，小组随分区，order 在范围内，choices 与字面量一一对应（顺序不限），applies 取四个值之一", () => {
        expect(check({section: "nbook.appearance", group: "ui", order: 10, choices})).toBeNull();
        expect(check({section: "other.plugin.page", order: -1_000_000})).toBeNull();
        expect(check({choices: [...choices].reverse()})).toBeNull();
        for (const applies of ["now", "next-run", "next-session", "restart"]) expect(check({applies}), applies).toBeNull();
        // 数与布尔的字面量也行。
        const mixed = Type.Union([Type.Literal(1), Type.Literal(true)]);
        expect(check({schema: mixed, default: 1, choices: [{value: 1, title}, {value: true, title}]})).toBeNull();
    });

    it("defineSetting 带上界面字段，choices 复制后逐层冻结", () => {
        const options = [{value: "nbook" as const, title}, {value: "macos" as const, title}];
        const setting = defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "nbook", title, section: "x.editor.main", group: "look", order: 2, choices: options, applies: "next-run"});
        expect(setting.declaration).toMatchObject({section: "x.editor.main", group: "look", order: 2, choices: options, applies: "next-run"});
        expect(Object.isFrozen(setting.declaration.choices) && Object.isFrozen((setting.declaration.choices as ReadonlyArray<unknown>)[0])).toBe(true);
        expect(() => defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "nbook", title, choices: [options[0]!]})).toThrow("macos");
    });

    it("section 不是分区 id、group 不是小组 id 或没有 section、order 越界或不是有限数", () => {
        for (const section of ["appearance", "Nbook.appearance", "nbook..x", "nbook.", 3, `x.${"a".repeat(127)}`]) expect(check({section}), String(section)).toContain("section");
        expect(check({section: `x.${"a".repeat(126)}`})).toBeNull();
        for (const group of ["UI", "a.b", "", 1, "a".repeat(65)]) expect(check({section: "nbook.appearance", group}), String(group)).toContain("group");
        expect(check({group: "ui"})).toContain("没有 section");
        for (const order of [1_000_001, -1_000_001, Number.NaN, Number.POSITIVE_INFINITY, "1"]) expect(check({order}), String(order)).toContain("order");
    });

    it("choices 与字面量不一一对应：少一个、多一个、与字面量不符、重复、title 缺语言、有未知字段", () => {
        expect(check({choices: [choices[0]]})).toContain("缺少字面量 \"macos\"");
        expect(check({choices: [...choices, {value: "solarized", title}]})).toContain("\"solarized\" 不是 schema 的字面量");
        expect(check({choices: [choices[0], {value: "MacOS", title}]})).toContain("不是 schema 的字面量");
        expect(check({choices: [...choices, choices[0]]})).toContain("不止一次");
        expect(check({choices: [choices[0], {value: "macos", title: {"zh-CN": "macOS"}}]})).toContain("title");
        expect(check({choices: [choices[0], {value: "macos", title, icon: "x"}]})).toContain("icon");
        expect(check({choices: "nbook"})).toContain("数组");
    });

    it("schema 不是字面量联合却写了 choices", () => {
        expect(check({schema: Type.String(), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Literal("a"), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Union([Type.Literal("a"), Type.String()]), default: "a", choices: [{value: "a", title}]})).toContain("字面量联合");
        expect(check({schema: Type.Union([Type.Literal("a"), Type.Literal("b")]), default: "a"})).toBeNull();
    });

    it("applies 不在四个值里或缺失；restart 字段已删除，按未知字段被拒", () => {
        for (const applies of ["later", true, undefined]) expect(check({applies}), String(applies)).toContain("applies");
        expect(check({restart: true})).toContain("未知字段：restart");
        expect(check({restart: false})).toContain("未知字段：restart");
    });
});

describe("动态选项与界面提示（输出 21）", () => {
    const text = Type.String();

    it("choices 写 {from} 只能用在字符串上，提供者 id 的写法同分区 id", () => {
        expect(settingDeclarationProblem("x.ai", "x.ai/model", declaration({schema: text, default: "", choices: {from: "x.ai.models"}}))).toBeNull();
        expect(settingDeclarationProblem("x.ai", "x.ai/model", declaration({choices: {from: "x.ai.models"}}))).toContain("字符串");
        expect(settingDeclarationProblem("x.ai", "x.ai/model", declaration({schema: text, default: "", choices: {from: "Models"}}))).toContain("from");
        expect(settingDeclarationProblem("x.ai", "x.ai/model", declaration({schema: text, default: "", choices: {from: "x.ai.models", extra: 1}}))).toContain("extra");
    });

    it("ui 只收单个字段的提示，文字要中英两份；控件要能用在这种值上", () => {
        const note = declaration({schema: text, default: "", ui: {widget: "multiline", rows: 6, placeholder: {"zh-CN": "写点什么", "en-US": "Write something"}}});
        expect(settingDeclarationProblem("x.ai", "x.ai/note", note)).toBeNull();
        expect(settingDeclarationProblem("x.ai", "x.ai/note", declaration({schema: text, default: "", ui: {label: "x"}}))).toContain("形状");
        expect(settingDeclarationProblem("x.ai", "x.ai/note", declaration({schema: text, default: "", ui: {placeholder: "只有一种语言"}}))).toContain("形状");
        expect(settingDeclarationProblem("x.ai", "x.ai/size", declaration({schema: Type.Integer(), default: 1, ui: {widget: "multiline"}}))).toContain("multiline");
        const rows = Type.Array(Type.Object({name: Type.String()}));
        expect(settingDeclarationProblem("x.ai", "x.ai/rows", declaration({schema: rows, default: [], ui: {itemLabel: "name"}}))).toBeNull();
        expect(settingDeclarationProblem("x.ai", "x.ai/rows", declaration({schema: rows, default: [], ui: {itemLabel: "title"}}))).toContain("itemLabel");
    });

    it("defineSetting 带上 ui 后复制并冻结", () => {
        const setting = defineSetting({plugin: "x.ai", name: "note", schema: text, default: "", title, ui: {widget: "multiline"}});
        expect(setting.declaration.ui).toEqual({widget: "multiline"});
        expect(Object.isFrozen(setting.declaration.ui)).toBe(true);
    });
});
