/**
 * 设置窗口的模型（docs/specs/settings/settings-window.md）：左栏、当前分区与标签、尺寸、通用列表的写入与 page 分区的加载。
 * `SettingsWindow.vue` 只呈现这里的状态、把动作交回来；命令 `nbook.settings.open` 与公开键 `nbook.settings/windowOpen`
 * 也读写这里。由 `nbook.settings` 的窗口入口按激活创建，随入口这一代释放。
 *
 * 左栏与配置项的落位在第一次用到时（打开窗口、读左栏）算一次：分区目录与已接受的配置项声明在入口的一生里不变（插件
 * 集合不变）。窗口入口在每个页面启动即激活，没打开过设置的页面不必为它排序，指向不存在的分区的诊断也在那时才记。
 *
 * page 分区的实例在这里而不在组件里：离开分区时页面卸载，回到分区时用缓存的组件定义重新创建（输出 6），缓存要比页面活得
 * 久。交付撤回时同步作废缓存：撤回与再次交付可能挨在同一轮里发生，等到界面刷新再看就分不出句柄换过。
 */

import {computed, effectScope, markRaw, readonly, ref, shallowReactive, watch} from "@vue/reactivity";
import type {ComputedRef, Ref} from "@vue/reactivity";
import type {Component} from "vue";

import type {CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {formatText, localize, textOf} from "nbook/shared/localized-text";
import type {DisplayLocale, DisplayText, LocalizedText} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService, SettingUpdateOptions, SettingWriteResult} from "nbook/shared/settings";

import {SETTINGS_SECTION_CATEGORIES} from "../shared/contracts";
import type {SettingsSectionCategory} from "../shared/contracts";
import type {SettingsPageContext} from "./contracts";
import type {SettingsPageDelivery, SettingsSectionEntry} from "./sections";
import type {SettingsWindowSource, WindowSetting} from "./window-source";

/** “其它”分区的 id：不是贡献，取一个分区声明写不出来的 id（只有一段），不会与贡献撞名。 */
export const OTHER_SECTION_ID = "other";

export interface SettingsWindowSize {
    readonly width: number;
    readonly height: number;
}

export const DEFAULT_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 960, height: 640};
/** 拖动调整的下限：左栏加一列控件还放得下。 */
export const MIN_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 600, height: 400};

/** 窗口尺寸的记录（`nbook.settings` 的一条 user/local 记录，见 `window-size.ts`）。 */
export interface SettingsWindowSizeStore {
    /** 记住的尺寸；没记过、读不到或记录坏了为 null，窗口用缺省尺寸。 */
    readonly remembered: Readonly<Ref<SettingsWindowSize | null>>;
    remember(size: SettingsWindowSize): void;
}

export interface SettingsWindowOptions {
    readonly source: SettingsWindowSource;
    /** `nbook.settings` 自己的配置服务：读任何已声明项。 */
    readonly settings: SettingsService;
    readonly bound: boolean;
    /** 绑定作品的书名；没有绑定为 null。 */
    readonly projectTitle: string | null;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    readonly size: SettingsWindowSizeStore;
    /** 工作台的通知（写入失败、结果未知）。 */
    readonly notify: (input: NotificationInput) => void;
    /** 作者能修的问题：配置项指向不存在的分区或小组、page 入口重试失败。 */
    readonly report: (message: string) => void;
}

export interface SettingsNavItem {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    /** 当前标签下不可用的原因；可用为 null。 */
    readonly unavailable: string | null;
}

export interface SettingsNavGroup {
    readonly category: SettingsSectionCategory;
    readonly items: ReadonlyArray<SettingsNavItem>;
}

export interface SettingsListGroup {
    /** 小组 id；分区最前、没有小标题的一组为 null，“其它”里是声明者插件 id。 */
    readonly id: string | null;
    readonly title: string | null;
    readonly settings: ReadonlyArray<WindowSetting>;
}

interface SectionHeading {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    /** 当前标签下不可用的原因：右边原位显示它（输出 8）；可用为 null。 */
    readonly unavailable: string | null;
}

export type SettingsSectionView =
    /** `excluded`：当前标签的层不允许、因此没列出的项的标题（输出 12 的分区末尾说明）。 */
    | (SectionHeading & {readonly kind: "list"; readonly groups: ReadonlyArray<SettingsListGroup>; readonly excluded: ReadonlyArray<string>})
    | (SectionHeading & {readonly kind: "page"; readonly layout: "column" | "fill"});

/** 当前标签那一层的说明（输出 13）；层正常时为 null。 */
export type SettingsLayerNotice = {readonly kind: "invalid"; readonly path: string | null; readonly detail: string} | {readonly kind: "unavailable"};

export type SettingsPageStatus = "waiting" | "loading" | "ready" | "load-failed" | "render-failed";

export interface SettingsPageView {
    readonly delivery: SettingsPageDelivery;
    readonly status: SettingsPageStatus;
    readonly component: Component | null;
    readonly error: string | null;
    /** 每次加载与每次渲染重试加一：页面组件以它作 key，换了就重建。 */
    readonly generation: number;
    /** 一次“重试”“重新加载”进行中。 */
    readonly busy: boolean;
    readonly context: SettingsPageContext;
}

export interface SettingsWindowOpenArgs {
    readonly section?: string;
    readonly layer?: SettingLayer;
}

export interface SettingsWindow {
    /** 绑定了作品（有“本作品”标签）；在入口这一代里不变。 */
    readonly bound: Readonly<Ref<boolean>>;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    /** 绑定作品的书名；没有绑定为 null。 */
    readonly projectTitle: Readonly<Ref<string | null>>;
    readonly open: Readonly<Ref<boolean>>;
    /** 已开着时再打开加一：窗口据此把焦点拉回自己。 */
    readonly focusRequest: Readonly<Ref<number>>;
    readonly layer: Readonly<Ref<SettingLayer>>;
    /** 当前分区 id；没有任何分区时为 null。 */
    readonly section: Readonly<Ref<string | null>>;
    readonly size: ComputedRef<SettingsWindowSize>;
    readonly nav: ComputedRef<ReadonlyArray<SettingsNavGroup>>;
    readonly current: ComputedRef<SettingsSectionView | null>;
    readonly layerNotice: ComputedRef<SettingsLayerNotice | null>;
    /** 给通用列表的 `SettingsRow` 用的配置服务：读同 `settings`，写走用户编辑路径（configuration.md 输出 19）。 */
    readonly editing: SettingsService;
    /** 命令 `nbook.settings.open`（输出 15）：参数不对时不打开、不改变窗口。 */
    openWindow(args: SettingsWindowOpenArgs): CommandResult<null>;
    close(): void;
    select(sectionId: string): void;
    setLayer(layer: SettingLayer): void;
    resize(size: Partial<SettingsWindowSize>): void;
    /** 通用控件改值：写当前标签那一层；结算之前控件显示这次的值，失败后回到层里的实际值并发通知（输出 14）。写进了为 true。 */
    write(setting: WindowSetting, value: unknown): Promise<boolean>;
    /** 这一项在当前标签下正在写入的值；没有在写为 undefined。 */
    pending(key: string): {readonly value: unknown} | undefined;
    /** `SettingsRow` 自己的写入（恢复默认、单独设置、移除）没有成功。 */
    rowFailed(setting: WindowSetting, failure: {readonly code: SettingsFailure; readonly detail: string}): void;
    page(sectionId: string): SettingsPageView;
    reloadPage(sectionId: string): void;
    retryPageEntry(sectionId: string): Promise<void>;
    pageRenderFailed(sectionId: string, generation: number, message: string): void;
    retryPageRender(sectionId: string): void;
    /** 停止响应式计算并关闭窗口；入口这一代释放时调用。 */
    dispose(): void;
}

const TEXT = {
    otherTitle: {"zh-CN": "其它", "en-US": "Other"},
    otherDescription: {"zh-CN": "没有归入分区的设置，按声明它的插件分组", "en-US": "Settings that belong to no section, grouped by plugin"},
    userOnlySection: {"zh-CN": "这个分区的设置只能在用户设置里改", "en-US": "Settings in this section can only be changed in your settings"},
    projectOnlySection: {"zh-CN": "这个分区的设置只能在本作品里设置", "en-US": "Settings in this section can only be set for a book"},
    emptySection: {"zh-CN": "这个分区还没有设置项", "en-US": "This section has no settings yet"},
    unknownSection: {"zh-CN": "设置里没有分区 {section}", "en-US": "There is no settings section {section}"},
    noProject: {"zh-CN": "这个窗口没有打开作品，没有本作品的设置", "en-US": "No book is open in this window, so there are no book settings"},
    notSavedTitle: {"zh-CN": "设置没有保存", "en-US": "Setting not saved"},
    unknownTitle: {"zh-CN": "设置可能没有保存", "en-US": "Setting may not be saved"},
    notSaved: {"zh-CN": "{title}：{reason}", "en-US": "{title}: {reason}"},
    unknownOutcome: {"zh-CN": "{title}：可能没有保存，以设置文件为准", "en-US": "{title}: it may not have been saved; the settings file is authoritative"},
    layerInvalid: {"zh-CN": "设置文件有错误，修好之后才能保存", "en-US": "the settings file has errors; fix it first"},
    writeFailed: {"zh-CN": "写不进设置文件（{detail}）", "en-US": "could not write the settings file ({detail})"},
    unavailable: {"zh-CN": "暂时连不上，没有保存", "en-US": "temporarily unreachable; nothing was saved"},
    invalidValue: {"zh-CN": "这个值不能用（{detail}）", "en-US": "this value cannot be used ({detail})"},
    otherFailure: {"zh-CN": "{code}：{detail}", "en-US": "{code}: {detail}"},
} satisfies Record<string, LocalizedText>;

interface CatalogSection {
    readonly id: string;
    readonly title: LocalizedText;
    readonly description: LocalizedText | null;
    readonly icon: string;
    readonly category: SettingsSectionCategory;
    readonly order: number;
    readonly kind: "list" | "page";
    readonly layout: "column" | "fill";
    readonly layers: ReadonlyArray<SettingLayer>;
    readonly groups: ReadonlyArray<{readonly id: string | null; readonly title: DisplayText | null; readonly settings: ReadonlyArray<WindowSetting>}>;
}

interface PageInstance {
    status: SettingsPageStatus;
    component: Component | null;
    error: string | null;
    generation: number;
    busy: boolean;
}

const LAYERS: ReadonlyArray<SettingLayer> = ["user", "project"];

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const settingOrder = (left: WindowSetting, right: WindowSetting): number => (left.definition.declaration.order ?? 0) - (right.definition.declaration.order ?? 0) || byCodeUnit(left.definition.key, right.definition.key);

function placed(list: ReadonlyArray<CatalogSection>): {readonly list: ReadonlyArray<CatalogSection>; readonly byId: ReadonlyMap<string, CatalogSection>} {
    return {list, byId: new Map(list.map((section) => [section.id, section]))};
}

/** 左栏与配置项的落位（输出 1、2）：分区按组、`order`、id 排；配置项按 `section`、`group` 落位，落不进去的进“其它”。 */
function buildCatalog(source: SettingsWindowSource, report: (message: string) => void): ReadonlyArray<CatalogSection> {
    const declared = new Map(source.sections().map((entry) => [entry.id, entry]));
    const listed = new Map<string, Map<string | null, WindowSetting[]>>();
    const other = new Map<string, WindowSetting[]>();
    const place = (map: Map<string | null, WindowSetting[]>, group: string | null, setting: WindowSetting): void => {
        map.set(group, [...(map.get(group) ?? []), setting]);
    };
    for (const setting of source.settings()) {
        const {key, declaration} = setting.definition;
        const section = declaration.section === undefined ? undefined : declared.get(declaration.section);
        if (section === undefined) {
            if (declaration.section !== undefined) report(`配置项 ${key} 指向不存在的分区 ${declaration.section}，归入“其它”`);
            other.set(setting.plugin, [...(other.get(setting.plugin) ?? []), setting]);
            continue;
        }
        // 指向 page 分区的项由页面负责，不在列表里画。
        if (section.kind === "page") continue;
        const groups = listed.get(declaration.section!) ?? new Map<string | null, WindowSetting[]>();
        listed.set(declaration.section!, groups);
        const known = declaration.group !== undefined && (section.declaration.groups ?? []).some((group) => group.id === declaration.group);
        if (declaration.group !== undefined && !known) report(`配置项 ${key} 指向分区 ${declaration.section!} 没有声明的小组 ${declaration.group}，排在分区最前`);
        place(groups, known ? declaration.group! : null, setting);
    }

    const fromEntry = (entry: SettingsSectionEntry): CatalogSection => {
        const {id, declaration} = entry;
        const heading = {
            id,
            title: declaration.title,
            description: declaration.description ?? null,
            icon: declaration.icon,
            category: declaration.category,
            order: declaration.order ?? 0,
        };
        if (entry.kind === "page") return {...heading, kind: "page", layout: entry.declaration.layout ?? "column", layers: entry.declaration.layers ?? LAYERS, groups: []};
        const groups = listed.get(id) ?? new Map<string | null, WindowSetting[]>();
        return {
            ...heading,
            kind: "list",
            layout: "column",
            layers: LAYERS,
            groups: [
                {id: null, title: null, settings: [...(groups.get(null) ?? [])].sort(settingOrder)},
                ...(entry.declaration.groups ?? []).map((group) => ({id: group.id, title: group.title, settings: [...(groups.get(group.id) ?? [])].sort(settingOrder)})),
            ],
        };
    };
    const sections = [...declared.values()].map(fromEntry);
    const ordered = SETTINGS_SECTION_CATEGORIES.flatMap((category) => sections.filter((section) => section.category === category).sort((left, right) => left.order - right.order || byCodeUnit(left.id, right.id)));
    if (other.size === 0) return ordered;
    return [...ordered, {
        id: OTHER_SECTION_ID,
        title: TEXT.otherTitle,
        description: TEXT.otherDescription,
        icon: "i-lucide-ellipsis",
        category: "plugins",
        order: 0,
        kind: "list",
        layout: "column",
        layers: LAYERS,
        groups: [...other].sort(([left], [right]) => byCodeUnit(left, right)).map(([plugin, settings]) => ({id: plugin, title: plugin, settings: [...settings].sort(settingOrder)})),
    }];
}

export function createSettingsWindow(options: SettingsWindowOptions): SettingsWindow {
    const {source} = options;
    const scope = effectScope(true);
    let built: {readonly list: ReadonlyArray<CatalogSection>; readonly byId: ReadonlyMap<string, CatalogSection>} | null = null;
    const catalog = (): ReadonlyArray<CatalogSection> => (built ??= placed(buildCatalog(source, options.report))).list;
    const sectionOf = (id: string): CatalogSection | undefined => {
        catalog();
        return built?.byId.get(id);
    };
    const text = (template: LocalizedText, params: Readonly<Record<string, string | number>> = {}): string => localize(formatText(template, params), options.locale.value);

    const open = ref(false);
    const focusRequest = ref(0);
    const layer = ref<SettingLayer>("user");
    /** 用户或命令选过的分区；没选过时是左栏的第一个（刷新后回到第一个分区）。 */
    const chosen = ref<string | null>(null);
    const section = computed(() => chosen.value ?? catalog()[0]?.id ?? null);

    /** 分区在这个标签下不可用的原因（输出 8）；可用为 null。 */
    const unavailableIn = (entry: CatalogSection, tab: SettingLayer): string | null => {
        const reason = tab === "project" ? TEXT.userOnlySection : TEXT.projectOnlySection;
        if (entry.kind === "page") return entry.layers.includes(tab) ? null : text(reason);
        const all = entry.groups.flatMap((group) => group.settings);
        if (all.length === 0) return text(TEXT.emptySection);
        return all.some((setting) => setting.definition.declaration.layers.includes(tab)) ? null : text(reason);
    };

    const view = (entry: CatalogSection, tab: SettingLayer): SettingsSectionView => {
        const heading = {
            id: entry.id,
            title: localize(entry.title, options.locale.value),
            description: entry.description === null ? null : localize(entry.description, options.locale.value),
            unavailable: unavailableIn(entry, tab),
        };
        if (entry.kind === "page") return {...heading, kind: "page", layout: entry.layout};
        const allowed = (setting: WindowSetting): boolean => setting.definition.declaration.layers.includes(tab);
        return {
            ...heading,
            kind: "list",
            groups: entry.groups
                .map((group) => ({id: group.id, title: group.title === null ? null : textOf(group.title, options.locale.value), settings: group.settings.filter(allowed)}))
                .filter((group) => group.settings.length > 0),
            excluded: entry.groups.flatMap((group) => group.settings.filter((setting) => !allowed(setting))).map((setting) => localize(setting.definition.declaration.title, options.locale.value)),
        };
    };

    // ── 写入 ───────────────────────────────────────────────────────────────

    let writeToken = 0;
    const writes = shallowReactive(new Map<string, {readonly token: number; readonly value: unknown}>());
    const pendingKey = (tab: SettingLayer, key: string): string => `${tab}\n${key}`;

    const reasonOf = (code: SettingsFailure, detail: string): string => {
        switch (code) {
            case "layer-invalid": return text(TEXT.layerInvalid);
            case "write-failed": return text(TEXT.writeFailed, {detail});
            case "unavailable": return text(TEXT.unavailable);
            case "invalid-value": return text(TEXT.invalidValue, {detail});
            default: return text(TEXT.otherFailure, {code, detail});
        }
    };

    const notifyFailure = (setting: WindowSetting, code: SettingsFailure, detail: string): void => {
        const title = localize(setting.definition.declaration.title, options.locale.value);
        if (code === "unknown-outcome") {
            options.notify({tone: "warning", title: text(TEXT.unknownTitle), message: text(TEXT.unknownOutcome, {title})});
            return;
        }
        options.notify({tone: "warning", title: text(TEXT.notSavedTitle), message: text(TEXT.notSaved, {title, reason: reasonOf(code, detail)})});
    };

    const editing: SettingsService = {
        get: (setting) => options.settings.get(setting),
        inspect: (setting) => options.settings.inspect(setting),
        onDidChange: (listener) => options.settings.onDidChange(listener),
        // `SettingsRow` 总给出层；没给时写当前标签那一层，与通用控件一致。
        update: <T>(setting: SettingDefinition<T>, value: T | undefined, update: SettingUpdateOptions = {}): Promise<SettingWriteResult> => {
            const target = update.layer === undefined || update.layer === "auto" ? layer.value : update.layer;
            return value === undefined ? source.unset(setting.key, target) : source.edit(setting.key, target, value);
        },
    };

    // ── page 分区 ──────────────────────────────────────────────────────────

    /**
     * 实例表本身不是响应式的：界面渲染时第一次问到某个分区会建实例，在渲染里改响应式的表会让读它的组件再渲染一遍。
     * 每个实例是浅层响应式，界面读它的字段。
     */
    const pages = new Map<string, PageInstance>();
    /** 上下文在窗口的一生里每个分区一份：切换标签时页面拿到的是同一个对象，`layer` 跟着变（输出 6）。 */
    const contexts = new Map<string, SettingsPageContext>();
    const projectTitle = readonly(ref(options.projectTitle));
    const readonlyLayer = readonly(layer);

    const contextOf = (id: string): SettingsPageContext => {
        let context = contexts.get(id);
        if (context === undefined) {
            context = markRaw({id, layer: readonlyLayer as Readonly<Ref<SettingLayer>>, projectTitle: projectTitle as Readonly<Ref<string | null>>});
            contexts.set(id, context);
        }
        return context;
    };

    const instanceOf = (id: string): PageInstance => {
        let instance = pages.get(id);
        if (instance === undefined) {
            instance = shallowReactive<PageInstance>({status: "waiting", component: null, error: null, generation: 0, busy: false});
            pages.set(id, instance);
        }
        return instance;
    };

    const load = async (id: string): Promise<void> => {
        const instance = instanceOf(id);
        const generation = (instance.generation += 1);
        Object.assign(instance, {status: "loading", component: null, error: null});
        const result = await source.load(id);
        // 等待期间交付被撤回、窗口关闭（两者都让实例回到 waiting）或又发起了新加载：这次结果作废。
        if (instance.generation !== generation || instance.status !== "loading") return;
        if (result.status === "stale") instance.status = "waiting";
        else if (result.status === "failed") Object.assign(instance, {status: "load-failed", error: result.error instanceof Error ? result.error.message : String(result.error)});
        else Object.assign(instance, {status: "ready", component: markRaw(result.component)});
    };

    scope.run(() => {
        // 交付撤回：卸掉组件、丢弃已加载的定义（输出 4 的状态表）。同步执行，见模块头。
        for (const entry of source.sections()) {
            if (entry.kind !== "page") continue;
            watch(() => source.delivery(entry.id).kind === "available", (available) => {
                const instance = pages.get(entry.id);
                if (available || instance === undefined || instance.status === "waiting") return;
                instance.generation += 1;
                Object.assign(instance, {status: "waiting", component: null, error: null});
            });
        }
        // 按需激活（输出 4）：每次显示一个 page 分区（窗口开着、它是当前分区、当前标签下可用）都请注册表看一次；停在
        // 这个分区时交付状态变了（例如入口从受阻恢复成未激活）也再看一次。注册表只在入口未激活时触发。
        const shownPage = (): string | null => {
            if (!open.value) return null;
            const id = section.value;
            const entry = id === null ? undefined : sectionOf(id);
            return entry?.kind === "page" && entry.layers.includes(layer.value) ? entry.id : null;
        };
        watch([shownPage, () => {
            const id = shownPage();
            return id === null ? null : source.delivery(id).kind;
        }], ([id]) => {
            if (id !== null) source.activate(id);
        }, {immediate: true});
        // 第一次显示时加载（输出 5）：窗口开着、它是当前分区、当前标签下可用、句柄已发布。
        watch(() => {
            // 先看开着与否：关着时不读当前分区，落位不必提前算。
            if (!open.value) return null;
            const id = section.value;
            const entry = id === null ? undefined : sectionOf(id);
            if (entry?.kind !== "page" || !entry.layers.includes(layer.value)) return null;
            return source.delivery(entry.id).kind === "available" ? entry.id : null;
        }, (id) => {
            if (id !== null && instanceOf(id).status === "waiting") void load(id);
        }, {immediate: true});
    });

    // ── 窗口 ───────────────────────────────────────────────────────────────

    const size = computed(() => options.size.remembered.value ?? DEFAULT_SETTINGS_WINDOW_SIZE);
    const nav = computed(() => SETTINGS_SECTION_CATEGORIES
        .map((category) => ({
            category,
            items: catalog().filter((entry) => entry.category === category).map((entry) => ({id: entry.id, title: localize(entry.title, options.locale.value), icon: entry.icon, unavailable: unavailableIn(entry, layer.value)})),
        }))
        .filter((group) => group.items.length > 0));
    const current = computed(() => {
        const entry = section.value === null ? undefined : sectionOf(section.value);
        return entry === undefined ? null : view(entry, layer.value);
    });
    const layerNotice = computed<SettingsLayerNotice | null>(() => {
        const state = source.layer(layer.value);
        if (state.status === "invalid") return {kind: "invalid", path: state.path, detail: state.detail};
        if (state.status === "unavailable" || state.status === "pending") return {kind: "unavailable"};
        return null;
    });

    return {
        bound: readonly(ref(options.bound)),
        locale: options.locale,
        projectTitle,
        open: readonly(open),
        focusRequest: readonly(focusRequest),
        layer: readonlyLayer,
        section,
        size,
        nav,
        current,
        layerNotice,
        editing,
        openWindow: (args) => {
            if (args.section !== undefined && sectionOf(args.section) === undefined) return {ok: false, code: "invalid-args", reason: text(TEXT.unknownSection, {section: args.section})};
            if (args.layer === "project" && !options.bound) return {ok: false, code: "unavailable", reason: text(TEXT.noProject)};
            if (args.section !== undefined) chosen.value = args.section;
            if (args.layer !== undefined) layer.value = args.layer;
            if (open.value) focusRequest.value += 1;
            else open.value = true;
            return {ok: true, value: null};
        },
        close: () => {
            open.value = false;
            // 进行中的加载作废（输出 5）：结果回来时不挂组件、不记为失败；实例回到 waiting，重开时按当前句柄重新加载。
            for (const instance of pages.values()) {
                if (instance.status !== "loading") continue;
                instance.generation += 1;
                instance.status = "waiting";
            }
        },
        select: (id) => {
            if (sectionOf(id) !== undefined) chosen.value = id;
        },
        setLayer: (tab) => {
            if (tab === "user" || options.bound) layer.value = tab;
        },
        resize: (next) => {
            const width = Math.max(MIN_SETTINGS_WINDOW_SIZE.width, Math.round(next.width ?? size.value.width));
            const height = Math.max(MIN_SETTINGS_WINDOW_SIZE.height, Math.round(next.height ?? size.value.height));
            if (width === size.value.width && height === size.value.height) return;
            options.size.remember({width, height});
        },
        write: async (setting, value) => {
            const tab = layer.value;
            const key = pendingKey(tab, setting.definition.key);
            const token = (writeToken += 1);
            writes.set(key, {token, value});
            try {
                const result = await source.edit(setting.definition.key, tab, value);
                if (!result.ok) notifyFailure(setting, result.code, result.detail);
                return result.ok;
            } finally {
                // 期间同一项又写了一次：留着那一次的值，等它自己结算。
                if (writes.get(key)?.token === token) writes.delete(key);
            }
        },
        pending: (key) => {
            const entry = writes.get(pendingKey(layer.value, key));
            return entry === undefined ? undefined : {value: entry.value};
        },
        rowFailed: (setting, failure) => notifyFailure(setting, failure.code, failure.detail),
        page: (id) => {
            const instance = instanceOf(id);
            return {delivery: source.delivery(id), status: instance.status, component: instance.component, error: instance.error, generation: instance.generation, busy: instance.busy, context: contextOf(id)};
        },
        reloadPage: (id) => {
            if (instanceOf(id).status === "load-failed") void load(id);
        },
        retryPageEntry: async (id) => {
            const instance = instanceOf(id);
            if (instance.busy) return;
            instance.busy = true;
            try {
                const result = await source.retry(id);
                if (result.status === "failed") options.report(`重试 page 分区 ${id} 所属的入口没有成功：${result.reason}`);
            } finally {
                instance.busy = false;
            }
        },
        pageRenderFailed: (id, generation, message) => {
            const instance = instanceOf(id);
            if (instance.generation !== generation || instance.status !== "ready") return;
            Object.assign(instance, {status: "render-failed", error: message});
        },
        retryPageRender: (id) => {
            const instance = instanceOf(id);
            if (instance.status !== "render-failed" || instance.component === null) return;
            instance.generation += 1;
            Object.assign(instance, {status: "ready", error: null});
        },
        dispose: () => {
            open.value = false;
            scope.stop();
        },
    };
}
