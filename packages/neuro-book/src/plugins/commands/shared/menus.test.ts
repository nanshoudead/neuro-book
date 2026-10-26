/**
 * 菜单项的共同合同（docs/specs/workbench/menus.md）：真实的命令注册表与上下文键，测显示、可用、排序与分隔、勾选、后缀匹配，
 * 以及各位置的登记校验。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {contextTable} from "./context-keys";
import type {ContextValues} from "./context-keys";
import {arrangeMenu, matchesExtensions, MENU_BUTTON, MENU_EXTENSIONS, menuItemValidator, menuLocation} from "./menus";
import type {MenuFacts, MenuItemDeclaration} from "./menus";
import {createCommandRegistry} from "./registry";

/** 测试命令的 id：注册表要求 `nbook.<已登记的域>.<动作>`，借用 `view` 域。 */
const cmd = (name: string): string => `nbook.view.${name}`;

function registry(ids: ReadonlyArray<string>, options: {keybindings?: Readonly<Record<string, string>>; gated?: ReadonlyArray<string>} = {}) {
    let context: ContextValues = {};
    const commands = createCommandRegistry({contextKeys: contextTable({"editor-active": "没有活动的编辑器"}, () => context), report: () => undefined});
    for (const name of ids) {
        const registered = commands.register({
            id: cmd(name),
            source: "nbook.test",
            declaration: {
                title: {"zh-CN": `标题 ${name}`, "en-US": `Title ${name}`},
                description: "test command",
                args: Type.Object({part: Type.Optional(Type.String())}, {additionalProperties: false}),
                effect: "read",
                keybinding: options.keybindings?.[name],
                when: options.gated?.includes(name) === true ? {requires: ["editor-active"]} : undefined,
            },
            run: () => ({ok: true, value: null}),
        });
        if (!registered.ok) throw new Error(registered.reason);
    }
    return {commands, setContext: (values: ContextValues) => {
        context = values;
    }};
}

function facts(commands: ReturnType<typeof registry>["commands"], overrides: Partial<MenuFacts> = {}): MenuFacts {
    return {
        command: (id) => {
            const found = commands.get(id);
            return found.ok ? found.value : null;
        },
        isEnabled: (id) => commands.isEnabled(id),
        isOn: () => false,
        locale: "zh-CN",
        platform: "other",
        current: null,
        contexts: new Set(),
        ...overrides,
    };
}

const item = (id: string, declaration: Partial<MenuItemDeclaration> & {readonly command: string}): {readonly id: string; readonly declaration: MenuItemDeclaration} => ({id, declaration: {section: "1", ...declaration}});
const ids = (sections: ReturnType<typeof arrangeMenu>) => sections.map((section) => section.map((entry) => entry.id));

describe("显示与排序（输出 1、4）", () => {
    it("节按名字的码元顺序、节内按 order 再按 id；命令不在目录里的项不显示，空节不出现", () => {
        const {commands} = registry(["a", "b", "c", "d"]);
        const items = [
            item("t.c", {command: cmd("c"), section: "2_edit"}),
            item("t.b2", {command: cmd("b"), section: "1_open", order: 2}),
            item("t.a", {command: cmd("a"), section: "1_open", order: 2}),
            item("t.d", {command: cmd("d"), section: "1_open", order: 1}),
            item("t.gone", {command: cmd("missing"), section: "0_first"}),
            item("t.alone-gone", {command: cmd("missing"), section: "3_last"}),
        ];
        expect(ids(arrangeMenu(items, facts(commands)))).toEqual([["t.d", "t.a", "t.b2"], ["t.c"]]);
    });

    it("when 的键全部就绪且为真才显示；不满足是隐藏，不是禁用", () => {
        const {commands} = registry(["a"]);
        const items = [item("t.a", {command: cmd("a"), when: {requires: ["x/one", "x/two"]}})];
        expect(ids(arrangeMenu(items, facts(commands, {isOn: (key) => key === "x/one"})))).toEqual([]);
        expect(ids(arrangeMenu(items, facts(commands, {isOn: () => true})))).toEqual([["t.a"]]);
    });

    it("带 extensions 的项要有当前文件且后缀匹配；带 context 的项要位置此刻给得出这个参数", () => {
        const {commands} = registry(["a", "b", "c"]);
        const items = [
            item("t.md", {command: cmd("a"), extensions: [".md"]}),
            item("t.ctx", {command: cmd("b"), context: "resource"}),
            item("t.plain", {command: cmd("c")}),
        ];
        expect(ids(arrangeMenu(items, facts(commands)))).toEqual([["t.plain"]]);
        const withFile = (current: ReadonlyArray<string>) => facts(commands, {current, contexts: new Set(["resource"])});
        expect(ids(arrangeMenu(items, withFile(["notes.txt"])))).toEqual([["t.ctx", "t.plain"]]);
        expect(ids(arrangeMenu(items, withFile(["第一章.md"])))).toEqual([["t.ctx", "t.md", "t.plain"]]);
        // 有当前文件但位置此刻给不出这个参数名：带 context 的项不显示。
        expect(ids(arrangeMenu(items, facts(commands, {current: ["第一章.md"]})))).toEqual([["t.md", "t.plain"]]);
    });
});

describe("可用、文字与勾选（输出 2、5）", () => {
    it("可用与原因取命令自己的 when；上下文变了重新求值就可用", () => {
        const {commands, setContext} = registry(["undo"], {gated: ["undo"]});
        const items = [item("t.undo", {command: cmd("undo")})];
        const disabled = arrangeMenu(items, facts(commands))[0]![0]!;
        expect([disabled.enabled, disabled.reason]).toEqual([false, "没有活动的编辑器"]);
        setContext({"editor-active": true});
        const enabled = arrangeMenu(items, facts(commands))[0]![0]!;
        expect([enabled.enabled, enabled.reason]).toEqual([true, null]);
    });

    it("标题缺省取命令的、写了 label 用 label；快捷键按平台写；声明了 toggled 的是勾选项", () => {
        const {commands} = registry(["toggle", "plain"], {keybindings: {toggle: "Mod+B"}});
        const items = [
            item("t.toggle", {command: cmd("toggle"), label: {"zh-CN": "侧栏", "en-US": "Sidebar"}, toggled: "x/sidebar", args: {part: "sidebar"}}),
            item("t.plain", {command: cmd("plain")}),
        ];
        const byId = (menu: ReturnType<typeof arrangeMenu>) => new Map(menu.flat().map((entry) => [entry.id, entry]));
        const mac = byId(arrangeMenu(items, facts(commands, {platform: "mac", isOn: (key) => key === "x/sidebar"})));
        expect(mac.get("t.toggle")).toMatchObject({label: "侧栏", shortcut: "⌘B", checked: true, args: {part: "sidebar"}, context: null});
        expect(mac.get("t.plain")).toMatchObject({label: "标题 plain", shortcut: null, checked: null, args: {}});
        const english = byId(arrangeMenu(items, facts(commands, {locale: "en-US"}))).get("t.toggle")!;
        expect([english.label, english.shortcut, english.checked]).toEqual(["Sidebar", "Ctrl+B", false]);
    });
});

describe("后缀匹配（输出 3）", () => {
    it("不分大小写、可多段；多个当前文件全部匹配才算；文件夹不匹配", () => {
        expect(matchesExtensions([".md"], ["README.MD"])).toBe(true);
        expect(matchesExtensions([".nb.json", ".json"], ["a.nb.json"])).toBe(true);
        expect(matchesExtensions([".md"], ["a.md", "b.txt"])).toBe(false);
        expect(matchesExtensions([".md"], ["a.md", "b.md"])).toBe(true);
        expect(matchesExtensions([".md"], ["a.md", null])).toBe(false);
        expect(matchesExtensions([".md"], [])).toBe(false);
    });
});

describe("登记校验（规则表）", () => {
    const titlebar = menuLocation("test.titlebar", {group: Type.Union([Type.Literal("file"), Type.Literal("view")])});
    const editor = menuLocation("test.editor", {...MENU_BUTTON, ...MENU_EXTENSIONS}, {contexts: ["resource"], buttons: true});
    const descriptor = (id: string, plugin: string, declaration: unknown): ContributionDescriptor => ({capability: "test", id, declaration, plugin, entry: null, location: "browser"});

    // id 的前缀由内核按贡献点的 idPrefix 核对（runtime/plugins.md），校验器只看形状与声明。
    it("合格的声明通过；id 格式不对的拒绝", () => {
        expect(menuItemValidator(titlebar)(descriptor("nbook.editor.save-in-file", "nbook.editor", {command: "nbook.editor.save", section: "2_save", group: "file"}))).toBeNull();
        expect(menuItemValidator(titlebar)(descriptor("acme.export.menu", "acme.export", {command: "acme.export.run", section: "9", group: "file"}))).toBeNull();
        expect(menuItemValidator(titlebar)(descriptor("Nbook.Bad", "nbook.editor", {command: "x", section: "1", group: "file"}))).toContain("点分的小写段");
    });

    it("位置没有的字段、缺必填字段、空节名、order 越界、args 与 context 同时写、不合格的后缀都拒绝", () => {
        const check = (location: typeof titlebar, declaration: unknown) => menuItemValidator(location)(descriptor("nbook.test.item", "nbook.test", declaration));
        expect(check(titlebar, {command: "c", section: "1", group: "file", extensions: [".md"]})).toContain("声明不合格");
        expect(check(titlebar, {command: "c", section: "1", group: "file", context: "resource"})).toContain("声明不合格");
        expect(check(titlebar, {command: "c", section: "1"})).toContain("声明不合格");
        expect(check(titlebar, {command: "c", section: " ", group: "file"})).toContain("声明不合格");
        expect(check(titlebar, {command: "c", section: "1", group: "file", order: 2_000_000})).toContain("声明不合格");
        expect(check(editor, {command: "c", section: "1", icon: "i-x", context: "resource", args: {a: 1}})).toContain("不能同时写 args 与 context");
        expect(check(editor, {command: "c", section: "1", icon: "i-x", context: "selection"})).toContain("声明不合格");
        expect(check(editor, {command: "c", section: "1", icon: "i-x", extensions: ["md"]})).toContain("声明不合格");
        expect(check(editor, {command: "c", section: "1", icon: "i-x", extensions: [".a b"]})).toContain("声明不合格");
        expect(check(editor, {command: "c", section: "1", icon: "i-x", extensions: []})).toContain("声明不合格");
    });

    it("画成按钮的位置：inline（缺省）要有图标，收进“⋯”的不要", () => {
        const check = (declaration: unknown) => menuItemValidator(editor)(descriptor("nbook.test.item", "nbook.test", declaration));
        expect(check({command: "c", section: "1"})).toContain("要有 icon");
        expect(check({command: "c", section: "1", placement: "inline"})).toContain("要有 icon");
        expect(check({command: "c", section: "1", placement: "menu"})).toBeNull();
        expect(check({command: "c", section: "1", icon: "i-lucide-eye", extensions: [".md"], context: "resource"})).toBeNull();
    });
});
