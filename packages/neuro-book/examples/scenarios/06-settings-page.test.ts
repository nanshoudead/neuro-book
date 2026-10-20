/**
 * 场景 6：设置的 page 分区（`snippets` 的浏览器入口与它的配置项）。
 *
 * 要说明的事：
 * - 配置项写在插件描述里，宿主把它登记进服务端、项目实例与窗口；page 分区的声明写在浏览器入口上，内核校验通过后进入
 *   设置窗口的左栏。入口不启动即激活：设置窗口显示这个分区时触发 `onSettingsPage:<分区 id>`，入口这时激活，实现
 *   （`load()`）交给设置窗口；入口停止时内核撤回。
 * - 页面按层写：带 `{layer}` 分别写用户层与本作品层，`inspect` 读回各层自己的值，`get` 读有效值（本作品层写了就用
 *   它，没写就沿用用户层）；不带 `{layer}` 时按 `"auto"` 选层，这正是页面要避开的。删掉本作品层的键就回到沿用。
 * - 插件只能写自己声明的项：写别人的项为 `denied`；值不合 schema 为 `invalid-value`，页面把它写在状态行里。
 *
 * 阅读顺序：`plugins/snippets/plugin.ts` → `plugins/snippets/shared/contracts.ts` → `plugins/snippets/web/plugin.ts` →
 * `plugins/snippets/web/snippets.ts` → `plugins/snippets/web/SnippetsPage.vue`（与 `SnippetsEditor.vue`）→ 这里。页面
 * 组件在 Bun 里不能渲染，场景直接调用页面用的 `snippets.ts`，以插件自己的身份读写。
 *
 * 行为合同：docs/specs/settings/settings-window.md（“分区声明”、输出第 1、4、6、9 条）、docs/specs/settings/
 * configuration.md（输出第 3、6、11、12 条）、docs/specs/runtime/plugins.md 输出第 15–18 条。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt} from "nbook/manifest";
import {localeSetting, SETTINGS_PAGES_POINT, SETTINGS_POINT, settingsKey, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
import type {SettingsService} from "nbook/shared/settings";

import {descriptor} from "../plugins/snippets/plugin";
import {itemsSetting, SNIPPETS_SECTION} from "../plugins/snippets/shared/contracts";
import {snippetsBrowserPlugin} from "../plugins/snippets/web/plugin";
import {addSnippet, moveSnippet, saveSnippets} from "../plugins/snippets/web/snippets";
import {Stage} from "../testing/stage";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 6：设置的 page 分区");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 给片段插件的浏览器定义另加一个探针入口，交出**这个插件自己的**配置服务：页面用的就是它（`web/plugin.ts` 在激活时
 * 取得、交给页面），场景以同一个身份读写。探针不能另起一个插件：配置服务按调用方插件核对声明者，换个插件 id 就写不了
 * 片段了。
 */
function withSettingsProbe(definition: PluginDefinition, probe: {settings: SettingsService | null}): PluginDefinition {
    const entry = defineEntry({
        id: "probe",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsKey}],
        activate: (context) => {
            probe.settings = context.services.require(settingsKey);
            return {};
        },
    });
    return {...definition, entries: [...definition.entries, entry]};
}

/**
 * 服务端、项目 `book` 与绑定它的窗口。三处都要登记片段的配置项：`definitionAt` 是产品宿主装配插件的写法，本位置没有
 * 入口时只登记描述里的顶层声明（服务端与项目实例是配置文件的拥有者，不认识这一项就不收它）。窗口里另有探针入口。
 */
async function world() {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`);
    const stage = new Stage(root);
    stages.push(stage);
    const {app: server, router} = await stage.server({plugins: [definitionAt("server", descriptor, undefined)]});
    const project = await stage.project(router, "book", {plugins: [definitionAt("project", descriptor, undefined)]});
    const probe: {settings: SettingsService | null} = {settings: null};
    const window = await stage.window(router, "w1", {project: "book", plugins: [definitionAt("browser", descriptor, withSettingsProbe(snippetsBrowserPlugin, probe))]});
    if (probe.settings === null) throw new Error("探针入口没有拿到配置服务");
    return {
        stage,
        server,
        project,
        window,
        settings: probe.settings,
        userFile: join(root, "state", "settings.json"),
        projectFile: join(root, "projects", "book", ".nbook", "settings.json"),
    };
}

/**
 * 用户在设置窗口里打开片段分区：窗口（`nbook.settings` 的入口）这时触发 `onSettingsPage:<分区 id>`。场景的窗口里没有
 * 设置窗口的界面，这里以 `nbook.settings` 的身份触发同一个事件；窗口本身怎样在显示分区时触发，见
 * `src/plugins/settings/window.test.ts`。前缀归 `nbook.settings`，别的插件触发会被拒。
 */
async function openSection(window: Awaited<ReturnType<typeof world>>["window"]): Promise<void> {
    const result = await window.plugins.triggerActivationEvent(settingsPageEvent(SNIPPETS_SECTION), {requester: "nbook.settings"});
    expect(result).toMatchObject({status: "triggered", results: [{status: "activated", plugin: "example.snippets", entry: "browser"}]});
}

describe("场景 6：设置的 page 分区", () => {
    it("配置项在三处都被接受；分区声明被接受；打开分区时入口才激活，实现交给设置窗口", async () => {
        const {server, project, window} = await world();
        for (const app of [server, project, window]) {
            expect(app.plugins.contribution(SETTINGS_POINT, itemsSetting.key)[0]?.validation).toEqual({status: "accepted"});
        }
        // 启动后入口没有激活：分区在左栏里，显示为“正在等待……启动”。
        expect(window.plugins.entryState({plugin: "example.snippets", entry: "browser"})?.status).toBe("registered");
        await openSection(window);

        // 接收者是 `nbook.settings` 的浏览器入口（设置窗口的数据在它那里）。实现只有 `load()`：页面组件到第一次显示这个分区
        // 时才加载，这里不调用它（Bun 不能加载 `.vue`）。
        const section = window.plugins.contribution(SETTINGS_PAGES_POINT, SNIPPETS_SECTION)[0];
        expect(section?.validation).toEqual({status: "accepted"});
        expect(section).toMatchObject({status: "available", delivery: {status: "delivered", receiver: {plugin: "nbook.settings", entry: "browser"}}});
        expect(section?.status === "available" && typeof (section.implementation as {readonly load?: unknown}).load).toBe("function");
    });

    it("入口停止后撤回：停用片段插件，它交出的分区实现随之撤回，配置项留在别的实例里", async () => {
        cases += 1;
        const stage = new Stage(join(tmp, `case-${String(cases)}`));
        stages.push(stage);
        const {app: server, router} = await stage.server({plugins: [definitionAt("server", descriptor, undefined)]});
        const window = await stage.window(router, "w1", {plugins: []});
        // 把片段插件装进可以单独停止的作用域（产品里对应停用插件）。
        const snippets = await stage.attach(window, definitionAt("browser", descriptor, snippetsBrowserPlugin), "browser");
        await openSection(window);
        expect(window.plugins.contribution(SETTINGS_PAGES_POINT, SNIPPETS_SECTION)[0]).toMatchObject({status: "available"});

        expect((await snippets.stop()).status).toBe("closed");
        // 内核撤回实现（原因 `scope-closed`），设置窗口随之把这个分区显示为已停止、写出原因（settings-window.md 输出第 4 条）。
        expect(window.plugins.contribution(SETTINGS_PAGES_POINT, SNIPPETS_SECTION)[0]).toMatchObject({status: "revoked", reason: "scope-closed"});
        expect(server.plugins.contribution(SETTINGS_POINT, itemsSetting.key)[0]?.validation).toEqual({status: "accepted"});
    });

    it("按层写：用户层与本作品层各写一份，inspect 读回各层、get 读有效值；删掉本作品层回到沿用；不带 layer 时按 auto 选层", async () => {
        const {settings, userFile, projectFile} = await world();
        const defaults = settings.get(itemsSetting);
        expect(defaults.map((item) => item.name)).toEqual(["开场白", "场景转换", "章末钩子"]);
        // 两层都还没写：各层没有这个键，有效值是默认值。
        expect(settings.inspect(itemsSetting)).toMatchObject({source: "default", user: {status: "ok"}, project: {status: "ok"}});

        // “用户”标签下加一条：页面带 {layer: "user"} 写整份列表。本作品没写，有效值跟着用户层。
        expect(await saveSnippets(settings, "user", addSnippet(defaults, "落款"))).toEqual({ok: true});
        expect(settings.inspect(itemsSetting).user).toMatchObject({status: "ok", value: [{name: "开场白"}, {name: "场景转换"}, {name: "章末钩子"}, {name: "落款", text: ""}]});
        expect(settings.inspect(itemsSetting).source).toBe("user");

        // “本作品”标签下单独设置：写本作品层。用户层不变，有效值整个换成本作品的列表（层之间不合并）。
        const own = moveSnippet([{name: "旁白", text: "雾从港口漫上来。"}, {name: "落款", text: "——写于雾港"}], 1, -1);
        expect(await saveSnippets(settings, "project", own)).toEqual({ok: true});
        const inspected = settings.inspect(itemsSetting);
        expect(inspected.project).toEqual({status: "ok", value: [{name: "落款", text: "——写于雾港"}, {name: "旁白", text: "雾从港口漫上来。"}]});
        expect(inspected.user).toMatchObject({value: [{name: "开场白"}, {name: "场景转换"}, {name: "章末钩子"}, {name: "落款"}]});
        expect(settings.get(itemsSetting).map((item) => item.name)).toEqual(["落款", "旁白"]);
        // 两层各落在自己的文件里。
        expect(JSON.parse(await readFile(userFile, "utf8"))[itemsSetting.key]).toHaveLength(4);
        expect(JSON.parse(await readFile(projectFile, "utf8"))[itemsSetting.key]).toHaveLength(2);

        // 页面要避开的写法：不带 layer 时是 "auto"，本作品层有这个键就写本作品层——在“用户”标签下改，结果写进了本作品。
        expect(await settings.update(itemsSetting, [])).toEqual({ok: true});
        expect(settings.inspect(itemsSetting).project).toEqual({status: "ok", value: []});
        expect(settings.inspect(itemsSetting).user).toMatchObject({value: [{name: "开场白"}, {name: "场景转换"}, {name: "章末钩子"}, {name: "落款"}]});

        // “移除本作品的设置”：删掉本作品层的键，回到沿用用户设置。
        expect(await settings.update(itemsSetting, undefined, {layer: "project"})).toEqual({ok: true});
        expect(settings.inspect(itemsSetting).project).toEqual({status: "ok"});
        expect(settings.get(itemsSetting).map((item) => item.name)).toEqual(["开场白", "场景转换", "章末钩子", "落款"]);
    });

    it("只能写自己声明的项：写界面语言为 denied；值不合 schema 为 invalid-value；两种都不改文件", async () => {
        const {settings, userFile} = await world();
        expect(await settings.update(localeSetting, "en-US", {layer: "user"})).toMatchObject({ok: false, code: "denied"});
        // 片段的名字至少一个字：页面把这个失败写在列表下面的状态行里，输入框回到层里的值。
        expect(await saveSnippets(settings, "user", [{name: "", text: "没有名字"}])).toMatchObject({ok: false, code: "invalid-value"});
        await expect(readFile(userFile, "utf8")).rejects.toThrow();
        expect(settings.get(localeSetting)).toBe("zh-CN");
    });
});
