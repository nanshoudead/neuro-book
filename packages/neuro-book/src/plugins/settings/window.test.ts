/**
 * 设置窗口的模型（docs/specs/settings/settings-window.md 输出 1–8、12–16）：左栏与配置项的落位、标签下的可用性、打开命令的
 * 参数、尺寸、通用列表的写入与 page 分区的加载。
 *
 * 两种场地：落位、命令与 page 用真实内核的浏览器实例装产品的 `nbook.settings`（不连远程，层不可达，只看声明），宿主能力
 * `window.plugins` 用产品的实现；写入与层的说明用多实例场地（`testing/world.ts`），层的拥有者读写真实文件。窗口模型由一个
 * 同属 `nbook.settings` 的探针入口取得数据来源与配置服务后创建（产品里是设置窗口的入口），通知与尺寸由测试记下。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {ref} from "@vue/reactivity";
import {defineComponent} from "vue";
import type {Component} from "vue";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Type} from "typebox";

import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import {descriptor as workbenchDescriptor} from "nbook/plugins/workbench/plugin";
import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineSetting} from "nbook/shared/settings";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {createWindowPlugins} from "nbook/web/host/window-plugins";

import {RELOAD_DELAY_MS} from "./backend/layer-owner";
import {descriptor} from "./plugin";
import {SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, settingsKey} from "./shared/contracts";
import type {SettingsPageDeclaration, SettingsSectionDeclaration} from "./shared/contracts";
import {settingsWorld} from "./testing/world";
import type {SettingsWorld} from "./testing/world";
import type {SettingsPageImplementation} from "./web/contracts";
import {settingsBrowserCore} from "./web/plugin";
import {createSettingsWindow, DEFAULT_SETTINGS_WINDOW_SIZE, MIN_SETTINGS_WINDOW_SIZE, OTHER_SECTION_ID} from "./web/settings-window";
import type {SettingsWindow, SettingsWindowSize} from "./web/settings-window";
import {settingsWindowSourceKey} from "./web/window-source";
import type {SettingsWindowSource, WindowSetting} from "./web/window-source";

const silent = {error: () => undefined};
/** 工作台描述里的配置项（主题、明暗），不装它的浏览器入口：外观分区里的两项要有人声明。 */
const workbenchDeclarations: PluginDefinition = {id: workbenchDescriptor.id, entries: [], contributions: workbenchDescriptor.contributions ?? []};
const title = (zh: string) => ({"zh-CN": zh, "en-US": zh});

interface Recorder {
    readonly notices: NotificationInput[];
    readonly reports: string[];
    readonly size: {value: SettingsWindowSize | null};
}

interface Probe {
    source: SettingsWindowSource | null;
    settings: SettingsService | null;
}

/** 同属 `nbook.settings` 的探针入口：取窗口的数据来源与 nbook.settings 自己的配置服务（产品里是设置窗口的入口）。 */
function probeEntry(probe: Probe): PluginEntryDefinition {
    return defineEntry({
        id: "test-window",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsWindowSourceKey}, {key: settingsKey}],
        activate: (context) => {
            probe.source = context.services.require(settingsWindowSourceKey);
            probe.settings = context.services.require(settingsKey);
            return {};
        },
    });
}

function windowFor(probe: Probe, bound: boolean): {readonly window: SettingsWindow; readonly recorder: Recorder} {
    if (probe.source === null || probe.settings === null) throw new Error("探针入口没有拿到数据来源");
    const size = ref<SettingsWindowSize | null>(null);
    const recorder: Recorder = {notices: [], reports: [], size};
    const window = createSettingsWindow({
        source: probe.source,
        settings: probe.settings,
        bound,
        projectTitle: bound ? "雾港" : null,
        locale: ref("zh-CN"),
        size: {remembered: size, remember: (next) => {
            size.value = next;
        }},
        notify: (input) => recorder.notices.push(input),
        report: (message) => recorder.reports.push(message),
    });
    disposers.push(() => window.dispose());
    return {window, recorder};
}

const disposers: Array<() => void> = [];
const started: Application[] = [];
const worlds: SettingsWorld[] = [];
let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "settings-window");
});

afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const application of started.splice(0)) expect((await application.stop()).status).toBe("closed");
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    // 只读的设置文件也要能删掉。
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

// ── 落位、命令与 page：真实内核，不连远程 ──────────────────────────────────

interface Toggle {
    fail: boolean;
    context: ActivationContext | null;
    implementation: SettingsPageImplementation;
}

function toggle(overrides: Partial<Toggle> = {}): Toggle {
    return {fail: false, context: null, implementation: {load: async () => ({render: () => null})}, ...overrides};
}

type SectionSpec =
    | {readonly kind: "list"; readonly declaration: SettingsSectionDeclaration}
    | {readonly kind: "page"; readonly declaration: SettingsPageDeclaration};

/**
 * 贡献分区的测试插件，同产品的写法：配置项与 list 分区是插件顶层的声明，page 分区是浏览器入口的贡献。有分区就有入口，
 * list 分区不看这个入口的状态。
 */
function contributor(id: string, sections: Readonly<Record<string, SectionSpec>>, control: Toggle, settings: ReadonlyArray<SettingDefinition<unknown>> = [], extra: Partial<PluginEntryDefinition> = {}): PluginDefinition {
    const all = Object.entries(sections);
    const pages = all.filter(([, spec]) => spec.kind === "page");
    return {
        id,
        contributions: [
            ...settings.map((setting) => setting.contribution),
            ...all.filter(([, spec]) => spec.kind === "list").map(([section, spec]) => ({capability: SETTINGS_SECTIONS_POINT, id: section, declaration: spec.declaration})),
        ],
        entries: all.length === 0 ? [] : [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: pages.map(([section, spec]) => ({capability: SETTINGS_PAGES_POINT, id: section, declaration: spec.declaration})),
            activate: (context) => {
                if (control.fail) throw new Error("样例入口按开关激活失败");
                control.context = context;
                return {contributions: {[SETTINGS_PAGES_POINT]: Object.fromEntries(pages.map(([section]) => [section, control.implementation]))}};
            },
            ...extra,
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>, bound = false): Promise<{readonly application: Application; readonly probe: Probe; readonly diagnostics: DiagnosticsStore}> {
    const probe: Probe = {source: null, settings: null};
    const settings = definitionAt("browser", descriptor, {...settingsBrowserCore, entries: [...settingsBrowserCore.entries, probeEntry(probe)]});
    const identity = {location: "browser" as const, instanceId: "settings-window"};
    const store = createDiagnosticsStore({identity});
    let application: Application | null = null;
    const feed = createWindowPlugins(() => application?.plugins ?? null, (error) => {
        throw error;
    });
    application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "clock", key: clockKey, create: () => systemClock},
                {id: "window.connection", key: windowConnectionKey, create: () => ({state: () => "offline" as const, onChange: () => () => undefined})},
                {id: "window.project", key: windowProjectKey, create: () => ({project: bound ? {id: "P", name: "雾港", generation: 1} : null})},
                {id: "window.plugins", key: windowPluginsKey, create: () => feed.capability},
            ],
            plugins: [createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}), settings, workbenchDeclarations, ...plugins],
            gates: [],
            observers: {plugins: feed},
        },
    );
    started.push(application);
    await application.startup;
    return {application, probe, diagnostics: store};
}

const list = (overrides: Partial<SettingsSectionDeclaration> = {}): SectionSpec => ({kind: "list", declaration: {title: title("列表"), icon: "i-lucide-square", category: "plugins", ...overrides}});
const pageSection = (overrides: Partial<SettingsPageDeclaration> = {}): SectionSpec & {readonly kind: "page"} => ({kind: "page", declaration: {title: title("页面"), icon: "i-lucide-square", category: "plugins", ...overrides}});

const notes = {
    alpha: defineSetting({plugin: "x.notes", name: "alpha", schema: Type.Boolean(), default: false, title: title("甲"), section: "x.notes.main", group: "basics", order: 2}),
    beta: defineSetting({plugin: "x.notes", name: "beta", schema: Type.Boolean(), default: false, title: title("乙"), section: "x.notes.main", group: "basics", order: 1}),
    gamma: defineSetting({plugin: "x.notes", name: "gamma", schema: Type.Boolean(), default: false, title: title("丙"), section: "x.notes.main"}),
    delta: defineSetting({plugin: "x.notes", name: "delta", schema: Type.Boolean(), default: false, title: title("丁"), section: "x.notes.main", group: "missing"}),
    userOnly: defineSetting({plugin: "x.notes", name: "userOnly", schema: Type.Boolean(), default: false, title: title("戊"), section: "x.notes.main", group: "advanced", layers: ["user"]}),
    orphan: defineSetting({plugin: "x.notes", name: "orphan", schema: Type.Boolean(), default: false, title: title("己"), section: "x.notes.nowhere"}),
    loose: defineSetting({plugin: "x.notes", name: "loose", schema: Type.Boolean(), default: false, title: title("庚")}),
    paged: defineSetting({plugin: "x.notes", name: "paged", schema: Type.Boolean(), default: false, title: title("辛"), section: "x.notes.page"}),
    lonely: defineSetting({plugin: "x.notes", name: "lonely", schema: Type.Boolean(), default: false, title: title("壬"), section: "x.notes.user", layers: ["user"]}),
};
const misc = defineSetting({plugin: "x.misc", name: "flag", schema: Type.Boolean(), default: false, title: title("癸")});

const keysOf = (settings: ReadonlyArray<WindowSetting>): string[] => settings.map((setting) => setting.definition.key);

describe("左栏与配置项的落位（输出 1、2、8、12）", () => {
    async function catalog(bound = false) {
        const sections = {
            "x.notes.main": list({groups: [{id: "basics", title: title("基础")}, {id: "advanced", title: title("高级")}]}),
            "x.notes.page": pageSection({category: "ai", layers: ["user"]}),
            "x.notes.user": list(),
            "x.notes.first": list({category: "app", order: -5, title: title("最先")}),
        };
        const started = await start([contributor("x.notes", sections, toggle(), Object.values(notes)), contributor("x.misc", {}, toggle(), [misc])], bound);
        return {...started, ...windowFor(started.probe, bound)};
    }

    it("三组自上而下应用、AI、插件，组内按 order、同值按 id；“其它”排在插件组最后", async () => {
        const {window} = await catalog();
        expect(window.nav.value.map((group) => [group.category, group.items.map((item) => item.id)])).toEqual([
            ["app", ["x.notes.first", "nbook.appearance"]],
            ["ai", ["x.notes.page"]],
            ["plugins", ["x.notes.main", "x.notes.user", OTHER_SECTION_ID]],
        ]);
        // 刷新后回到第一个分区。
        expect(window.section.value).toBe("x.notes.first");
        // 没有可列的项的 list 分区停用，以原因作提示。
        expect(window.nav.value.flatMap((group) => group.items).find((item) => item.id === "x.notes.first")?.unavailable).toBe("这个分区还没有设置项");
    });

    it("分区里先列没写小组的项，再按声明的顺序列小组；组内按 order、同值按键；指向没有声明的小组按没写处理并记诊断", async () => {
        const {window, recorder} = await catalog();
        window.select("x.notes.main");
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("x.notes.main 应是 list 分区");
        expect(view.groups.map((group) => [group.id, group.title, keysOf(group.settings)])).toEqual([
            [null, null, ["x.notes/delta", "x.notes/gamma"]],
            ["basics", "基础", ["x.notes/beta", "x.notes/alpha"]],
            ["advanced", "高级", ["x.notes/userOnly"]],
        ]);
        expect(recorder.reports).toContain("配置项 x.notes/delta 指向分区 x.notes.main 没有声明的小组 missing，排在分区最前");
    });

    it("没写分区与指向不存在的分区的项进“其它”，按声明者插件分小组（后者记诊断）；指向 page 分区的项不在任何列表里", async () => {
        const {window, recorder} = await catalog();
        window.select(OTHER_SECTION_ID);
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("“其它”应是 list 分区");
        expect(view.title).toBe("其它");
        expect(view.groups.map((group) => [group.title, keysOf(group.settings)])).toEqual([
            ["x.misc", ["x.misc/flag"]],
            ["x.notes", ["x.notes/loose", "x.notes/orphan"]],
        ]);
        expect(recorder.reports).toContain("配置项 x.notes/orphan 指向不存在的分区 x.notes.nowhere，归入“其它”");
        const listed = window.nav.value.flatMap((group) => group.items).flatMap((item) => {
            window.select(item.id);
            const current = window.current.value;
            return current?.kind === "list" ? current.groups.flatMap((group) => keysOf(group.settings)) : [];
        });
        expect(listed).not.toContain("x.notes/paged");
    });

    it("没有落到“其它”的项时不出现“其它”", async () => {
        const {probe} = await start([contributor("x.notes", {"x.notes.main": list()}, toggle(), [notes.gamma])]);
        const {window} = windowFor(probe, false);
        expect(window.nav.value.flatMap((group) => group.items).map((item) => item.id)).not.toContain(OTHER_SECTION_ID);
    });

    it("本作品标签：只允许用户层的项不列出、分区末尾列出它们；全是这样的 list 分区与 layers 不含本作品的 page 分区停用并给原因", async () => {
        const {window} = await catalog(true);
        window.setLayer("project");
        const items = new Map(window.nav.value.flatMap((group) => group.items).map((item) => [item.id, item.unavailable]));
        expect(items.get("x.notes.main")).toBeNull();
        expect(items.get("x.notes.user")).toBe("这个分区的设置只能在用户设置里改");
        expect(items.get("x.notes.page")).toBe("这个分区的设置只能在用户设置里改");
        window.select("x.notes.main");
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("x.notes.main 应是 list 分区");
        expect(view.groups.flatMap((group) => keysOf(group.settings))).not.toContain("x.notes/userOnly");
        expect(view.excluded).toEqual(["戊"]);
        // 当前分区在新标签下不可用：右边原位给原因（输出 8）。
        window.select("x.notes.user");
        expect(window.current.value?.unavailable).toBe("这个分区的设置只能在用户设置里改");
        window.setLayer("user");
        expect(window.current.value?.unavailable).toBeNull();
    });
});

describe("打开窗口（输出 15、16）", () => {
    async function plain(bound = false) {
        const started = await start([contributor("x.notes", {"x.notes.main": list()}, toggle(), [notes.gamma])], bound);
        return windowFor(started.probe, bound);
    }

    it("分区不在左栏里为 invalid-args，未绑定作品却要本作品标签为 unavailable：两种都不打开、不改变窗口", async () => {
        const {window} = await plain();
        expect(window.openWindow({section: "x.notes.nowhere"})).toEqual({ok: false, code: "invalid-args", reason: "设置里没有分区 x.notes.nowhere"});
        expect(window.openWindow({layer: "project"})).toMatchObject({ok: false, code: "unavailable"});
        expect(window.open.value).toBe(false);
        expect(window.section.value).toBe("nbook.appearance");
        // “其它”没有项时也不在左栏里。
        expect(window.openWindow({section: OTHER_SECTION_ID})).toMatchObject({ok: false, code: "invalid-args"});
    });

    it("打开跳到给的分区与标签；已开着时只聚焦；关掉再开回到上次的分区与标签", async () => {
        const {window} = await plain(true);
        expect(window.openWindow({section: "x.notes.main", layer: "project"})).toEqual({ok: true, value: null});
        expect([window.open.value, window.section.value, window.layer.value, window.focusRequest.value]).toEqual([true, "x.notes.main", "project", 0]);
        expect(window.openWindow({})).toEqual({ok: true, value: null});
        expect(window.focusRequest.value).toBe(1);
        window.close();
        expect(window.open.value).toBe(false);
        window.openWindow({});
        expect([window.open.value, window.section.value, window.layer.value]).toEqual([true, "x.notes.main", "project"]);
    });

    it("尺寸缺省 960×640；调整后记住（不小于下限），没变不重复记", async () => {
        const started = await start([]);
        const {window, recorder} = windowFor(started.probe, false);
        expect(window.size.value).toEqual(DEFAULT_SETTINGS_WINDOW_SIZE);
        window.resize({width: 1100.4});
        expect(recorder.size.value).toEqual({width: 1100, height: 640});
        window.resize({height: 10});
        expect(window.size.value).toEqual({width: 1100, height: MIN_SETTINGS_WINDOW_SIZE.height});
        const remembered = recorder.size.value;
        window.resize({width: 1100});
        expect(recorder.size.value).toBe(remembered);
    });
});

describe("page 分区的加载（输出 4–6）", () => {
    const Page = defineComponent({name: "PageV1", render: () => null});

    it("窗口开着、分区是当前分区才加载一次；切换标签时上下文是同一个对象，层跟着变，页面不重建", async () => {
        let loads = 0;
        const control = toggle({implementation: {load: async () => {
            loads += 1;
            return Page;
        }}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)], true);
        const {window} = windowFor(started.probe, true);
        expect(window.page("x.notes.page").status).toBe("waiting");
        window.select("x.notes.page");
        expect(loads).toBe(0);
        window.openWindow({});
        await waitUntil("页面加载完", () => window.page("x.notes.page").status === "ready");
        const first = window.page("x.notes.page");
        expect([loads, first.component]).toEqual([1, Page]);
        window.setLayer("project");
        const after = window.page("x.notes.page");
        expect(after.context).toBe(first.context);
        expect(after.context.layer.value).toBe("project");
        expect(after.generation).toBe(first.generation);
        // 离开再回来：组件定义不重新加载（句柄没变）。
        window.select("nbook.appearance");
        window.select("x.notes.page");
        expect(loads).toBe(1);
    });

    it("加载结果回来时窗口已关闭：丢弃结果，不挂组件、不记为加载失败；重开时重新加载", async () => {
        const loads: Array<{readonly resolve: (component: Component) => void; readonly reject: (error: Error) => void}> = [];
        const control = toggle({implementation: {load: () => new Promise<Component>((resolve, reject) => {
            loads.push({resolve, reject});
        })}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        // 结果经注册表与窗口两层 await 才回到实例：让出一轮事件循环，等它们都结算。
        const settled = () => new Promise((resolve) => setImmediate(resolve));

        window.openWindow({section: "x.notes.page"});
        await waitUntil("开始加载", () => loads.length === 1);
        window.close();
        loads[0]?.resolve(Page);
        await settled();
        expect(window.page("x.notes.page")).toMatchObject({status: "waiting", component: null, error: null});

        window.openWindow({});
        await waitUntil("重开后再次加载", () => loads.length === 2);
        window.close();
        loads[1]?.reject(new Error("页面模块下载失败"));
        await settled();
        expect(window.page("x.notes.page")).toMatchObject({status: "waiting", component: null, error: null});

        window.openWindow({});
        await waitUntil("再次重开后又加载", () => loads.length === 3);
        loads[2]?.resolve(Page);
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        expect(window.page("x.notes.page").component).toBe(Page);
    });

    it("入口激活失败：原位给原因，“重试”恢复并激活后交付并加载；“重试”进行中时 busy", async () => {
        const control = toggle({fail: true, implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control, [], {activationEvents: []})]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        expect((await started.application.plugins.activate({plugin: "x.notes", entry: "browser"})).status).toBe("failed");
        expect(window.page("x.notes.page").delivery).toEqual({kind: "entry-failed", reason: "样例入口按开关激活失败"});
        control.fail = false;
        const retry = window.retryPageEntry("x.notes.page");
        expect(window.page("x.notes.page").busy).toBe(true);
        await retry;
        await waitUntil("重试后加载完", () => window.page("x.notes.page").status === "ready");
        expect(window.page("x.notes.page").busy).toBe(false);
    });

    it("load() 失败给“重新加载”，进行中再点不发起第二次，再加载成功；渲染出错给“重试”，新代际重建；过期代际的报告丢弃", async () => {
        let broken = true;
        let loads = 0;
        const control = toggle({implementation: {load: async () => {
            loads += 1;
            if (broken) throw new Error("页面模块下载失败");
            return Page;
        }}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("加载失败", () => window.page("x.notes.page").status === "load-failed");
        expect(window.page("x.notes.page").error).toBe("页面模块下载失败");
        broken = false;
        window.reloadPage("x.notes.page");
        window.reloadPage("x.notes.page");
        await waitUntil("重新加载完", () => window.page("x.notes.page").status === "ready");
        expect(loads).toBe(2);
        const generation = window.page("x.notes.page").generation;
        window.pageRenderFailed("x.notes.page", generation - 1, "旧实例的错误");
        expect(window.page("x.notes.page").status).toBe("ready");
        window.pageRenderFailed("x.notes.page", generation, "页面出错");
        expect(window.page("x.notes.page")).toMatchObject({status: "render-failed", error: "页面出错"});
        window.retryPageRender("x.notes.page");
        expect(window.page("x.notes.page")).toMatchObject({status: "ready", error: null, generation: generation + 1});
    });

    it("入口停止：卸掉组件、显示停止原因", async () => {
        const control = toggle({implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        expect((await control.context?.scope.parent?.close())?.status).toBe("closed");
        expect(window.page("x.notes.page")).toMatchObject({delivery: {kind: "entry-stopped", reason: "scope-closed"}, status: "waiting", component: null});
    });

    /**
     * 停止的入口再次交付要等热插拔（内核现在不能重新激活已关闭的入口），这里用设置场景的局部宿主按句柄撤回、发布：撤回与
     * 再次发布挨在同一轮里，窗口也要丢掉旧的组件定义、用新句柄重新加载。
     */
    it("撤回后同一分区再次交付：新句柄，重新加载；撤回与发布挨在一起也不沿用旧组件", async () => {
        const Second = defineComponent({name: "PageV2", render: () => null});
        const host = createSettingsHost({settings: [], sections: [{id: "x.notes.page", plugin: "x.notes", ...pageSection()}], notify: () => undefined, report: () => undefined});
        disposers.push(() => host.dispose());
        host.publish("x.notes.page", async () => Page);
        host.window.openWindow({section: "x.notes.page"});
        await waitUntil("加载完", () => host.window.page("x.notes.page").status === "ready");
        host.revoke("x.notes.page", "scope-closed");
        expect(host.window.page("x.notes.page")).toMatchObject({delivery: {kind: "entry-stopped", reason: "scope-closed"}, component: null});
        host.publish("x.notes.page", async () => Second);
        await waitUntil("再次交付后加载完", () => host.window.page("x.notes.page").component === Second);
        // 发布时先撤回旧句柄（同一轮）：结果仍是新组件。
        const Third = defineComponent({name: "PageV3", render: () => null});
        host.publish("x.notes.page", async () => Third);
        await waitUntil("换代后加载完", () => host.window.page("x.notes.page").component === Third);
    });
});

// ── 写入与层的说明：多实例场地，真实文件 ─────────────────────────────────

async function world(files: {readonly user?: string; readonly project?: string} = {}): Promise<{readonly world: SettingsWorld; readonly window: SettingsWindow; readonly recorder: Recorder; readonly root: string}> {
    counter += 1;
    const root = join(tmp, `world-${String(counter)}`);
    for (const [path, text] of [[join(root, "state", "settings.json"), files.user], [join(root, "Book", ".nbook", "settings.json"), files.project]] as const) {
        if (text === undefined) continue;
        await mkdir(join(path, ".."), {recursive: true});
        await writeFile(path, text);
    }
    await mkdir(join(root, "Book"), {recursive: true});
    const created = await settingsWorld(root, [definitionAt("server", workbenchDescriptor, undefined)]);
    worlds.push(created);
    await created.project(1, [definitionAt("project", workbenchDescriptor, undefined)]);
    const probe: Probe = {source: null, settings: null};
    await created.window("w-settings", [workbenchDeclarations], {bound: true, settingsEntries: [probeEntry(probe)]});
    return {world: created, root, ...windowFor(probe, true)};
}

const themeOf = (window: SettingsWindow): WindowSetting => {
    const appearance = window.current.value;
    if (appearance?.kind !== "list") throw new Error("当前分区应是外观");
    const found = appearance.groups.flatMap((group) => group.settings).find((entry) => entry.definition.key === themeSetting.key);
    if (found === undefined) throw new Error("外观分区里没有主题");
    return found;
};

describe("通用列表的写入（输出 10、12、14）", () => {
    it("改值经用户编辑写当前标签那一层：结算前显示这次的值，返回时本窗口已是新值；恢复默认删掉键、其余内容不变", async () => {
        const {world: created, window, recorder} = await world({user: "{\n    // 我的主题\n    \"nbook.workbench/appearance\": \"dark\"\n}\n"});
        window.openWindow({section: "nbook.appearance"});
        const theme = themeOf(window);
        const writing = window.write(theme, "macos");
        expect(window.pending(themeSetting.key)).toEqual({value: "macos"});
        await writing;
        expect(window.pending(themeSetting.key)).toBeUndefined();
        expect(window.editing.get(themeSetting)).toBe("macos");
        expect(await readFile(created.userFile, "utf8")).toContain("\"nbook.workbench/theme\": \"macos\"");
        expect(recorder.notices).toEqual([]);

        expect(await window.editing.update(appearanceSetting, undefined, {layer: "user"})).toEqual({ok: true});
        const text = await readFile(created.userFile, "utf8");
        expect(text).toContain("// 我的主题");
        expect(text).not.toContain("nbook.workbench/appearance");
        expect(window.editing.inspect(appearanceSetting).user).toEqual({status: "ok"});
    });

    it("本作品标签写项目层，用户层不变", async () => {
        const {world: created, window} = await world();
        window.openWindow({section: "nbook.appearance", layer: "project"});
        await window.write(themeOf(window), "macos");
        expect(JSON.parse(await readFile(created.projectFile, "utf8"))).toEqual({"nbook.workbench/theme": "macos"});
        expect(window.editing.inspect(themeSetting).user).toEqual({status: "ok"});
    });

    it("写入失败：发通知（哪一项、为什么），控件回到层里的实际值；值不合 schema 同样", async () => {
        const {world: created, window, recorder} = await world({user: "{\"nbook.workbench/theme\": \"nbook\"}"});
        window.openWindow({section: "nbook.appearance"});
        await chmod(created.userFile, 0o444);
        try {
            await window.write(themeOf(window), "macos");
        } finally {
            await chmod(created.userFile, 0o644);
        }
        expect(window.pending(themeSetting.key)).toBeUndefined();
        expect(window.editing.get(themeSetting)).toBe("nbook");
        expect(recorder.notices).toHaveLength(1);
        expect(recorder.notices[0]).toMatchObject({tone: "warning", title: "设置没有保存"});
        expect(recorder.notices[0]?.message).toStartWith("主题：写不进设置文件");

        await window.write(themeOf(window), "solarized");
        expect(recorder.notices[1]?.message).toStartWith("主题：这个值不能用");
    });
});

describe("层的说明（输出 13）", () => {
    it("用户层文件无效：说明不带路径（状态根不发给浏览器）；修好后自动消失", async () => {
        const {world: created, window} = await world({user: "{\"nbook.workbench/theme\": "});
        window.openWindow({section: "nbook.appearance"});
        expect(window.layerNotice.value).toMatchObject({kind: "invalid", path: null});
        await writeFile(created.userFile, "{}");
        await waitUntil("文件修好后说明消失", () => {
            created.clock.advance(RELOAD_DELAY_MS);
            return window.layerNotice.value === null;
        });
    });

    it("项目层文件无效：本作品标签的说明带项目层文件的路径；用户标签不受影响", async () => {
        const {world: created, window} = await world({project: "{\"nbook.workbench/theme\": "});
        window.openWindow({section: "nbook.appearance", layer: "project"});
        expect(window.layerNotice.value).toEqual({kind: "invalid", path: created.projectFile, detail: expect.any(String)});
        window.setLayer("user");
        expect(window.layerNotice.value).toBeNull();
    });
});
