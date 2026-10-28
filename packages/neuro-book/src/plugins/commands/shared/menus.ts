/**
 * 菜单项的共同合同（docs/specs/workbench/menus.md）：声明的形状与登记校验、此刻显示什么与怎样排。四个菜单位置的拥有者
 * （工作台的标题栏菜单与视图标题、资源管理器右键、编辑区标题）各自用 `menuLocation` 定义自己的位置，在共同形状上加字段；
 * 画菜单、给参数、执行由拥有者做。纯模块，不碰 DOM 与运行时，前后端都能引用。
 */

import {shallowRef} from "@vue/reactivity";
import {Type} from "typebox";
import type {TObject, TProperties, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";
import type {LocalizedText, TextResolver} from "nbook/shared/localized-text";

import {formatKeybinding} from "./keybinding";
import type {KeyPlatform} from "./keybinding";
import type {CommandMetadata, CommandResult} from "./contracts";

/** 声明的全部字段；哪些可用由位置决定（`menuLocation` 的 schema 拒绝位置没有的字段）。 */
export interface MenuItemDeclaration {
    readonly command: string;
    readonly section: string;
    readonly order?: number;
    readonly label?: LocalizedText;
    readonly toggled?: string;
    readonly when?: {readonly requires: ReadonlyArray<string>};
    readonly args?: Readonly<Record<string, unknown>>;
    readonly context?: string;
    readonly extensions?: ReadonlyArray<string>;
    readonly icon?: string;
    readonly placement?: "inline" | "menu";
}

const Rank = Type.Integer({minimum: -1_000_000, maximum: 1_000_000});
const Key = Type.String({pattern: "\\S"});

const BASE = {
    command: Key,
    section: Type.String({pattern: "\\S", maxLength: 64}),
    order: Type.Optional(Rank),
    label: Type.Optional(TextSchema),
    toggled: Type.Optional(Key),
    when: Type.Optional(Type.Object({requires: Type.Array(Key)}, {additionalProperties: false})),
    args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
} satisfies TProperties;

/** 有“当前文件”的位置加 `extensions`。 */
export const MENU_EXTENSIONS = {extensions: Type.Optional(Type.Array(Type.String({pattern: "^\\.[^/\\\\\\s]+$"}), {minItems: 1, maxItems: 16}))} satisfies TProperties;

/** 画成按钮的位置加 `icon` 与 `placement`。 */
export const MENU_BUTTON = {
    icon: Type.Optional(Key),
    placement: Type.Optional(Type.Union([Type.Literal("inline"), Type.Literal("menu")])),
} satisfies TProperties;

export interface MenuLocation {
    readonly point: string;
    readonly schema: TObject;
    /** 位置规定的参数名（`context` 的取值）；没有时这个位置不接受 `context`。 */
    readonly contexts: ReadonlyArray<string>;
    /** 画成按钮的位置：`inline` 的项要有图标。 */
    readonly buttons: boolean;
}

/** 定义一个菜单位置：共同字段加位置自己的字段（`MENU_EXTENSIONS`、`MENU_BUTTON` 或别的必填字段）。 */
export function menuLocation(point: string, extra: TProperties, options: {readonly contexts?: ReadonlyArray<string>; readonly buttons?: boolean} = {}): MenuLocation {
    const contexts = options.contexts ?? [];
    const properties: Record<string, TSchema> = {...BASE, ...extra};
    if (contexts.length > 0) properties.context = Type.Optional(Type.Union(contexts.map((name) => Type.Literal(name))));
    return {point, schema: Type.Object(properties, {additionalProperties: false}), contexts, buttons: options.buttons ?? false};
}

const ITEM_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 菜单位置的补全：菜单项的 `label` 没有约定键（没写时显示命令的标题），只给文字引用补命名空间。 */
export const completeMenuItemDeclaration = conventionCompleter(null);

/**
 * 这个位置的登记校验（menus.md 的规则表）：只看这一条声明本身。id 规则与工作台的条目贡献点相同；同 id 的两条由内核一起
 * 拒绝。
 */
export function menuItemValidator(location: MenuLocation): (descriptor: ContributionDescriptor) => string | null {
    return (descriptor) => {
        if (descriptor.location !== "browser") return `${location.point} 只接受浏览器入口的贡献`;
        const id = descriptor.id;
        if (id.length > 128 || !ITEM_ID.test(id)) return `菜单项 id 必须是点分的小写段、至多 128 个字符：${id}`;
        const declaration = descriptor.declaration as MenuItemDeclaration;
        if (!Value.Check(location.schema, declaration)) {
            const first = [...Value.Errors(location.schema, declaration)][0];
            return `菜单项 ${id} 的声明不合格（${location.point}）：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
        }
        if (declaration.args !== undefined && declaration.context !== undefined) return `菜单项 ${id} 不能同时写 args 与 context`;
        if (location.buttons && declaration.placement !== "menu" && declaration.icon === undefined) return `菜单项 ${id} 画成按钮，要有 icon`;
        return null;
    };
}

/**
 * 菜单项只有声明，实现是这个空对象（menus.md 的“输入与前置条件”）：内核只能对整个贡献点规定要不要实现，菜单项又要随贡献方
 * 入口出现与消失，所以写在入口下、交空实现。
 */
export type MenuItemImplementation = Readonly<Record<string, never>>;

const NO_IMPLEMENTATION: MenuItemImplementation = Object.freeze({});

/** 贡献方在激活产出里交给某个菜单位置的实现：每条菜单项一个空对象。 */
export function menuImplementations(items: ReadonlyArray<{readonly id: string}>): Readonly<Record<string, MenuItemImplementation>> {
    return Object.fromEntries(items.map((item) => [item.id, NO_IMPLEMENTATION]));
}

type MenuHandle = ContributionHandle<MenuItemDeclaration, MenuItemImplementation>;

/**
 * 一个菜单位置的注册表，拥有者在入口激活时建：声明目录在那一刻取得、之后不变；交付句柄在 `published` 时记下、`revoke` 时
 * 去掉，入口开始停止时句柄先失去 `published`，从那一刻起这一项就不再给出（menus.md 的“时序与寿命”）。`items()` 是响应式的：
 * 在 computed 里读，交付与撤回时重算。
 */
export class MenuItemRegistry<Declaration extends MenuItemDeclaration = MenuItemDeclaration> {
    readonly #catalog: ReadonlyMap<string, Declaration>;
    readonly #handles = new Map<string, MenuHandle>();
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(declarations: ReadonlyArray<ContributionDescriptor<Declaration>>, signal: AbortSignal) {
        this.#catalog = new Map(declarations.map((descriptor) => [descriptor.id, descriptor.declaration]));
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            this.#version.value += 1;
        }, {once: true});
    }

    receiver(): ContributionReceiver<MenuItemDeclaration, MenuItemImplementation> {
        return {
            published: (handle) => {
                this.#handles.set(handle.id, handle);
                this.#version.value += 1;
            },
            revoke: (handle) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#version.value += 1;
            },
        };
    }

    /** 此刻已交付的菜单项，按 id 的码元顺序；`arrangeMenu` 再按节与顺序排。 */
    items(): Array<{readonly id: string; readonly declaration: Declaration}> {
        void this.#version.value;
        if (this.#stopped) return [];
        const items: Array<{readonly id: string; readonly declaration: Declaration}> = [];
        for (const [id, handle] of this.#handles) {
            const declaration = this.#catalog.get(id);
            if (declaration !== undefined && handle.published) items.push({id, declaration});
        }
        return items.sort((a, b) => compare(a.id, b.id));
    }
}

/** 位置此刻的当前文件：文件给名字（地址最后一段），文件夹给 null。 */
export type MenuCurrentFiles = ReadonlyArray<string | null>;

export interface MenuFacts {
    /** 命令目录里的这条命令；不在目录里为 null。 */
    readonly command: (id: string) => CommandMetadata | null;
    readonly isEnabled: (id: string) => CommandResult<boolean>;
    /** 布尔公开键已就绪且为真。 */
    readonly isOn: (key: string) => boolean;
    readonly text: TextResolver;
    readonly platform: KeyPlatform;
    /** 这个位置此刻没有当前文件（或位置根本没有当前文件）为 null。 */
    readonly current: MenuCurrentFiles | null;
    /** 位置此刻给得出的参数名（`context` 的取值）；给不出的项不显示。 */
    readonly contexts: ReadonlySet<string>;
}

/** 此刻要画的一项：文字已按语言取好。参数由拥有者按 `args` 或 `context` 给。 */
export interface MenuEntry {
    readonly id: string;
    readonly command: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly context: string | null;
    readonly label: string;
    readonly enabled: boolean;
    /** 不可用的原因；可用为 null。 */
    readonly reason: string | null;
    /** 按平台写好的快捷键；命令没有声明键位为 null。 */
    readonly shortcut: string | null;
    /** 勾选项的状态；不是勾选项为 null。 */
    readonly checked: boolean | null;
    readonly icon: string | null;
    readonly placement: "inline" | "menu";
}

/** 后缀匹配（menus.md 输出 3）：每个当前文件的名字都以某个后缀结尾（不分大小写）；有文件夹就不匹配。 */
export function matchesExtensions(extensions: ReadonlyArray<string>, current: MenuCurrentFiles): boolean {
    if (current.length === 0) return false;
    const suffixes = extensions.map((suffix) => suffix.toLowerCase());
    return current.every((name) => name !== null && suffixes.some((suffix) => name.toLowerCase().endsWith(suffix)));
}

/**
 * 此刻显示的菜单项，按节分好（menus.md 输出 1、2、4、5）：节按名字的码元顺序，节内按 order 再按 id；没有显示项的节不出现，
 * 所以分隔线不会落在两端或连着出现。
 */
export function arrangeMenu(items: ReadonlyArray<{readonly id: string; readonly declaration: MenuItemDeclaration}>, facts: MenuFacts): MenuEntry[][] {
    const shown: Array<{readonly section: string; readonly order: number; readonly entry: MenuEntry}> = [];
    for (const {id, declaration} of items) {
        const command = facts.command(declaration.command);
        if (command === null) continue;
        if (!(declaration.when?.requires ?? []).every((key) => facts.isOn(key))) continue;
        if (declaration.extensions !== undefined && (facts.current === null || !matchesExtensions(declaration.extensions, facts.current))) continue;
        if (declaration.context !== undefined && !facts.contexts.has(declaration.context)) continue;
        const enabled = facts.isEnabled(command.id);
        shown.push({section: declaration.section, order: declaration.order ?? 0, entry: {
            id,
            command: command.id,
            args: declaration.args ?? {},
            context: declaration.context ?? null,
            label: facts.text.t(declaration.label ?? command.title),
            enabled: enabled.ok && enabled.value,
            reason: enabled.ok ? null : enabled.reason,
            shortcut: command.keybinding === undefined ? null : formatKeybinding(command.keybinding, facts.platform),
            checked: declaration.toggled === undefined ? null : facts.isOn(declaration.toggled),
            icon: declaration.icon ?? null,
            placement: declaration.placement ?? "inline",
        }});
    }
    shown.sort((a, b) => compare(a.section, b.section) || a.order - b.order || compare(a.entry.id, b.entry.id));
    const sections: MenuEntry[][] = [];
    let current: string | null = null;
    for (const item of shown) {
        if (item.section !== current) {
            sections.push([]);
            current = item.section;
        }
        sections[sections.length - 1]!.push(item.entry);
    }
    return sections;
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
