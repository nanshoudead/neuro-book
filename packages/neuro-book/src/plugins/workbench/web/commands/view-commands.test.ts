/**
 * 移动视图命令（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md 外壳二输出 24，验收 27）：真实的
 * 布局 store（Storage 场地），命令实现直接调用；选择服务由测试按请求作答（产品里是命令面板，经面板执行的路径由
 * `e2e/workbench-views.e2e.ts` 覆盖）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {shallowRef} from "@vue/reactivity";

import type {ContextKeySource} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {textOf} from "nbook/shared/localized-text";

import type {QuickPick, QuickPickRequest, QuickPickResult} from "../../shared/contracts";
import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {LayoutStore} from "../state/layout-store";
import {workbenchStateBindings} from "../state/public-state";
import {openLayout} from "../testing/layout";
import {MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND, VIEW_COMMAND_DECLARATIONS, viewCommands} from "./view-commands";
import {completedCommand} from "../../testing/declarations";
import {failureText, workbenchTestText} from "../../testing/text";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "view-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, location, layout: "scroll", ...extra});

async function layout(): Promise<LayoutStore> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    const {store} = await openLayout(w, "w", "c");
    store.actions.acceptViewCatalog(new Map([["test.a", view("A", "sidebar")], ["test.b", view("B", "sidebar")], ["test.c", view("C", "panel")], ["test.d", view("D", "sidebar", {movable: false})]]));
    return store;
}

function picker(answer: (request: QuickPickRequest, index: number) => QuickPickResult | Promise<QuickPickResult>): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request, requests.length - 1);
    }};
}

const labels = (request: QuickPickRequest | undefined): string[] => (request?.items ?? []).map((item) => `${item.id}:${workbenchTestText("zh-CN").t(item.label)}${item.detail === undefined ? "" : `/${workbenchTestText("zh-CN").t(item.detail)}`}`);

const run = (store: LayoutStore, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick)[MOVE_VIEW_COMMAND].run(args);

describe("移动视图", () => {
    it("移动、打开视图经真实命令注册表登记：布局没打开时不可用，打开后可用；Agent 不能打开视图（not-exposed）", async () => {
        const store = await layout();
        const current = shallowRef<LayoutStore | null>(null);
        const bindings = workbenchStateBindings(current) as unknown as Readonly<Record<string, {readonly value: unknown}>>;
        const nameOf = (key: string): string => key.slice("nbook.workbench/".length);
        const contextKeys: ContextKeySource = {
            problem: (key) => (key.startsWith("nbook.workbench/") && nameOf(key) in bindings ? null : `${key} 不是工作台的公开键`),
            evaluate: (key) => (bindings[nameOf(key)]?.value === true ? {matches: true} : {matches: false, reason: key}),
        };
        const registry = createCommandRegistry({contextKeys, report: (error) => {
            throw error;
        }});
        const implementations = viewCommands(() => current.value, picker(() => ({kind: "cancelled"})));
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) {
            expect(registry.register({id, source: "nbook.workbench", declaration: completedCommand(id, VIEW_COMMAND_DECLARATIONS[id]), run: implementations[id].run}).ok).toBe(true);
            expect(registry.isEnabled(id)).toMatchObject({ok: false, code: "unavailable"});
        }
        current.value = store;
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) expect(registry.isEnabled(id)).toEqual({ok: true, value: true});
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"}, {source: "agent", callerId: "test.agent"})).toMatchObject({ok: false, code: "not-exposed"});
        expect(store.state.placement.selected.sidebar).not.toBe("view:test.b");
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.placement.selected.sidebar).toBe("view:test.b");
    });

    it("三项参数直接移动；只给一部分为 invalid-args；来源已变为 stale-target 且不写；不可移动、目标不存在为 invalid-args", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        const partial = await run(store, silent, {viewId: "test.b", targetContainerId: "view:test.a"});
        expect(partial).toMatchObject({ok: false, code: "invalid-args"});
        expect(failureText(partial, "zh-CN")).toBe("要么都不给，要么给 viewId、sourceContainerId 和 targetContainerId、newContainerIn 中的一个");
        expect(failureText(partial, "en-US")).toBe("Give nothing, or give viewId, sourceContainerId and one of targetContainerId and newContainerIn");
        expect(await run(store, silent, {viewId: "test.b", sourceContainerId: "view:test.b", targetContainerId: "view:test.a"})).toEqual({ok: true, value: null});
        expect(store.state.placement.views.get("test.b")?.container).toBe("view:test.a");
        expect(store.state.placement.selected.sidebar).toBe("view:test.a");
        await waitUntil("保存完成", () => store.state.customizations.queue === 0);
        const before = structuredClone(store.state.customizations.display);
        const stale = await run(store, silent, {viewId: "test.b", sourceContainerId: "view:test.b", targetContainerId: "view:test.c"});
        expect(stale).toMatchObject({ok: false, code: "stale-target"});
        expect(failureText(stale, "zh-CN")).toBe("视图已经不在发起时的容器里，没有移动");
        expect(failureText(stale, "en-US")).toBe("The view is no longer in the container it was in when the move started, so it was not moved");
        expect(await run(store, silent, {viewId: "test.d", sourceContainerId: "view:test.d", targetContainerId: "view:test.a"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:nope"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:test.a"})).toEqual({ok: true, value: null});
        expect(store.state.customizations.display).toEqual(before);
        expect(store.state.customizations.queue).toBe(0);
        expect(silent.requests).toEqual([]);
    });

    it("newContainerIn：建一个只装这个视图的自建容器放到 Part 末尾并选中；与 targetContainerId 同给为 invalid-args；来源过期为 stale-target", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:test.c", newContainerIn: "panel"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", newContainerIn: "panel"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(store.state.customizations.queue).toBe(0);
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", newContainerIn: "panel"})).toEqual({ok: true, value: null});
        const created = store.state.placement.views.get("test.a")?.container ?? "";
        expect(created).toMatch(/^custom:[0-9a-f-]{36}$/u);
        expect(store.state.placement.parts.panel).toEqual(["view:test.c", created]);
        expect(store.state.placement.selected.panel).toBe(created);
        expect(store.state.placement.containers.get(created)?.members).toEqual(["test.a"]);
        await waitUntil("保存完成", () => store.state.customizations.queue === 0);
        expect(store.state.customizations.display.containers?.[created]).toEqual({location: "panel", order: expect.any(Number), origin: "test.a"});
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", newContainerIn: "sidebar"})).toMatchObject({ok: false, code: "stale-target"});
        // 再新建一次：身份每次执行各生成一个，旧的自建容器搬空后连记录一起消失。
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: created, newContainerIn: "auxiliarybar"})).toEqual({ok: true, value: null});
        const second = store.state.placement.views.get("test.a")?.container ?? "";
        expect(second).not.toBe(created);
        expect(store.state.placement.parts.auxiliarybar).toEqual([second]);
        expect(store.state.placement.containers.has(created)).toBe(false);
        await waitUntil("保存完成", () => store.state.customizations.queue === 0);
        expect(store.state.customizations.display.containers?.[created]).toBeUndefined();
    });

    it("无参：先选视图、再选目标（含同一 Part 的容器与重置位置）；取消任一步成功且不写", async () => {
        const store = await layout();
        const cancelFirst = picker(() => ({kind: "cancelled"}));
        expect(await run(store, cancelFirst, {})).toEqual({ok: true, value: null});
        // 不可移动的 D 不在候选里。
        expect(labels(cancelFirst.requests[0])).toEqual(["test.a:A/A", "test.b:B/B", "test.c:C/C"]);

        const cancelSecond = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "cancelled"}));
        expect(await run(store, cancelSecond, {})).toEqual({ok: true, value: null});
        expect(labels(cancelSecond.requests[1])).toEqual(["view:test.b:B/侧栏", "view:test.d:D/侧栏", "new:sidebar:新建容器（在侧栏）", "new:auxiliarybar:新建容器（在右栏）", "view:test.c:C/面板", "new:panel:新建容器（在面板）"]);
        expect(store.state.customizations.queue).toBe(0);

        const move = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: "view:test.b"}));
        expect(await run(store, move, {})).toEqual({ok: true, value: null});
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.b");

        const reset = picker((request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: request.items.at(-1)!.id}));
        expect(await run(store, reset, {})).toEqual({ok: true, value: null});
        expect(labels(reset.requests[1]).at(-1)).toBe("reset::重置位置");
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.a");

        const create = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.c"} : {kind: "item", id: "new:sidebar"}));
        expect(await run(store, create, {})).toEqual({ok: true, value: null});
        const created = store.state.placement.views.get("test.c")?.container ?? "";
        expect(created.startsWith("custom:")).toBe(true);
        expect(store.state.placement.parts.sidebar.at(-1)).toBe(created);
    });

    it("两步选择之间视图被别处移走：按 stale-target 拒绝且不写", async () => {
        const store = await layout();
        const racing = picker((_request, index) => {
            if (index === 0) return {kind: "item", id: "test.a"};
            store.actions.applyView({kind: "move-view", viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
            return {kind: "item", id: "view:test.b"};
        });
        expect(await run(store, racing, {})).toMatchObject({ok: false, code: "stale-target"});
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.c");
    });

    it("选择服务不可用为 unavailable；外壳没打开为 unavailable", async () => {
        const store = await layout();
        expect(await run(store, picker(() => ({kind: "unavailable", reason: "没有命令面板"})), {})).toEqual({ok: false, code: "unavailable", reason: "没有命令面板"});
        expect(await viewCommands(() => null, picker(() => ({kind: "cancelled"})))[MOVE_VIEW_COMMAND].run({})).toMatchObject({ok: false, code: "unavailable"});
    });
});

describe("打开视图（docs/specs/workbench/views.md 输出 14）", () => {
    const open = (store: LayoutStore | null, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick)[OPEN_VIEW_COMMAND].run(args);
    const silent = picker(() => ({kind: "cancelled"}));

    it("侧栏、面板里的视图：选中所在容器，所在区域被隐藏、面板收起时一并显示", async () => {
        const store = await layout();
        store.actions.setPartHidden("sidebar", true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.placement.selected.sidebar).toBe("view:test.b");
        expect(store.state.hiddenParts).not.toContain("sidebar");

        store.actions.setPanelCollapsed(true);
        store.actions.setPanelHidden(true);
        expect(store.state.panel).toMatchObject({hidden: true, collapsed: true});
        expect(await open(store, silent, {viewId: "test.c"})).toEqual({ok: true, value: null});
        expect(store.state.placement.selected.panel).toBe("view:test.c");
        expect(store.state.panel).toMatchObject({hidden: false, collapsed: false});
    });

    it("多视图容器里收起的视图：展开它", async () => {
        const store = await layout();
        expect(await run(store, silent, {viewId: "test.b", sourceContainerId: "view:test.b", targetContainerId: "view:test.a"})).toEqual({ok: true, value: null});
        expect(store.actions.applyView({kind: "set-view-collapsed", viewId: "test.b", collapsed: true}).kind).toBe("patch");
        const collapsed = () => store.state.presentation.containers.get("view:test.a")?.views.find((item) => item.id === "test.b")?.collapsed;
        expect(collapsed()).toBe(true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(collapsed()).toBe(false);
        expect(store.state.placement.selected.sidebar).toBe("view:test.a");
    });

    it("没有这个视图为 invalid-args 且不写；外壳没打开为 unavailable", async () => {
        const store = await layout();
        const unknown = await open(store, silent, {viewId: "test.nowhere"});
        expect(unknown).toMatchObject({ok: false, code: "invalid-args"});
        expect(failureText(unknown, "zh-CN")).toBe("没有这个视图（没有已接受的声明）：test.nowhere");
        expect(failureText(unknown, "en-US")).toBe("No such view (no accepted declaration): test.nowhere");
        expect(store.state.customizations.queue).toBe(0);
        const detached = await open(null, silent, {viewId: "test.a"});
        expect(detached).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(detached, "zh-CN")).toBe("工作台布局没有打开（这个窗口没有显示外壳）");
        expect(failureText(detached, "en-US")).toBe("The workbench layout is not open (this window does not show the shell)");
    });

    it("不给 viewId：经选择挑一个（标签是视图标题、说明是所在容器）；取消时成功且不写", async () => {
        const store = await layout();
        const chooser = picker((request) => ({kind: "item", id: request.items.find((item) => item.id === "test.c")!.id}));
        expect(await open(store, chooser, {})).toEqual({ok: true, value: null});
        expect(labels(chooser.requests[0])).toContain("test.c:C/C");
        expect(store.state.placement.selected.panel).toBe("view:test.c");
        await waitUntil("保存完成", () => store.state.customizations.queue === 0);

        const before = JSON.stringify(store.state.customizations.display);
        expect(await open(store, silent, {})).toEqual({ok: true, value: null});
        expect(JSON.stringify(store.state.customizations.display)).toBe(before);
    });
});
