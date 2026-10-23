/**
 * 场景 7：完整示例“专注计时”（`plugins/focus`）。
 *
 * 要说明的事：
 * - 设置项、命令、状态栏条目、服务端远程服务与私有存储连在一起：命令开始一次专注，时长取设置项，服务端到点结算并推送，
 *   状态栏的文字跟着变。
 * - 计时的权威在服务端，而且不靠计时器：服务端停着的时候到点的那次，之后第一次读写时记上；同一状态根上的两个服务端
 *   各自结算，只记一次。没有窗口在走表时，服务端的计时器到点结算并推送。
 * - 记录坏了（例如插件升过记录的 `version` 又降回来）不让入口从此不可用：换成空记录重来。
 * - 窗口只在有进行中的一次时走表；入口停止、空闲之后不占计时器。断线重连后窗口重取一次，断开期间别处的变化补得上。
 *
 * 阅读顺序：`plugins/focus/shared/contracts.ts` → `plugins/focus/backend/plugin.ts` → `plugins/focus/web/focus-store.ts`
 * → `plugins/focus/web/plugin.ts` → 这里。
 *
 * 行为合同：docs/specs/runtime/plugin-api.md、docs/specs/storage/persistence.md 的条件保存、docs/specs/runtime/plugin-channel.md
 * 的订阅与重连、docs/specs/ui/workbench-shell.md 的状态栏条目。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry, defineRecord, storageKey} from "@notnotype/nb-plugin-sdk";
import type {PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

import type {PluginRemoteAccess} from "@notnotype/nb-runtime/plugins";
import type {RemoteRouter} from "@notnotype/nb-runtime/remote";
import type {Application} from "@notnotype/nb-runtime/application";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";

import {focusBackendPlugin} from "../plugins/focus/backend/plugin";
import {descriptor} from "../plugins/focus/plugin";
import {sessionsContract, START_COMMAND, TOGGLE_COMMAND} from "../plugins/focus/shared/contracts";
import type {Today} from "../plugins/focus/shared/contracts";
import {FOCUS_ITEM, focusBrowserPlugin} from "../plugins/focus/web/plugin";
import {remoteProbe, serviceProbe} from "../testing/probes";
import {Stage} from "../testing/stage";
import {workbenchStandIn} from "../testing/workbench";
import type {WorkbenchStandIn} from "../testing/workbench";

const MINUTE = 60_000;
let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 7：专注计时");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 新场地；给了 `root` 时与别的场地共用同一个状态根（同一状态根上跑着几个服务端）。 */
function newStage(root?: string): Stage {
    cases += 1;
    const stage = new Stage(root ?? join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    return stage;
}

const server = (stage: Stage) => stage.server({plugins: [definitionAt("server", descriptor, focusBackendPlugin)]});

/** 一个窗口：工作台替身、focus 的浏览器入口，以及一个拿命令服务与远程访问的探针。 */
async function windowOf(stage: Stage, router: RemoteRouter, id = "w1"): Promise<{readonly app: Application; readonly workbench: WorkbenchStandIn; readonly commands: CommandService; readonly remote: PluginRemoteAccess}> {
    const workbench = workbenchStandIn();
    const shell = serviceProbe("example.shell", "browser", [commandServiceKey]);
    const caller = remoteProbe("example.caller", "browser");
    const app = await stage.window(router, id, {plugins: [workbench.definition, definitionAt("browser", descriptor, focusBrowserPlugin), shell.definition, caller.definition]});
    return {app, workbench, commands: shell.get(commandServiceKey), remote: caller.remote()};
}

/**
 * 场地上的计时器都走完：一秒一秒推进，直到没有登记着的计时器。focus 只在有进行中的一次时占计时器，空闲之后应当很快走完；
 * 设置服务看到配置文件变动时会排一个很短的去抖计时器，所以不直接断言 `pending()` 为 0。
 */
async function idle(stage: Stage): Promise<void> {
    await waitUntil("场地上没有计时器", () => {
        stage.clock.advance(1000);
        return stage.clock.pending() === 0;
    });
}

/** 状态栏条目此刻的文字；条目还没交到时为 null。 */
const status = (workbench: WorkbenchStandIn): string | null => workbench.item(FOCUS_ITEM)?.text() ?? null;

describe("场景 7：专注计时", () => {
    it("命令开始一次专注，时长取设置项；到点服务端结算并推送，状态栏从剩余时间变成今天的个数；之后不再占计时器", async () => {
        const stage = newStage();
        const {router} = await server(stage);
        const {workbench, commands} = await windowOf(stage, router);
        // 拿到第一份“今天”之前条目显示“…”，之后是今天的个数。
        expect(await waitUntil("状态栏显示今天的个数", () => status(workbench) === "今天 0 个番茄")).toBe(true);

        expect(await commands.execute(START_COMMAND, {})).toEqual({ok: true, value: null});
        expect(status(workbench)).toBe("专注 25:00");
        stage.clock.advance(10 * MINUTE);
        expect(status(workbench)).toBe("专注 15:00");

        stage.clock.advance(15 * MINUTE);
        expect(await waitUntil("到点后状态栏显示完成了一个", () => status(workbench) === "今天 1 个番茄")).toBe(true);
        await idle(stage);
    });

    it("已经在计时再开始为 already-running，空闲时放弃为 not-running；放弃不算完成", async () => {
        const stage = newStage();
        const {router} = await server(stage);
        const {remote} = await windowOf(stage, router);
        const sessions = remote.use(sessionsContract);
        expect(await sessions.cancel({})).toMatchObject({ok: false, code: "not-running"});
        expect(await sessions.start({})).toMatchObject({ok: true, value: {running: {startedAt: 0, endsAt: 25 * MINUTE}, completed: 0}});
        expect(await sessions.start({})).toMatchObject({ok: false, code: "already-running"});
        expect(await sessions.cancel({})).toMatchObject({ok: true, value: {running: null, completed: 0}});
    });

    it("没有窗口在走表：服务端的计时器到点结算并推送 changed", async () => {
        const stage = newStage();
        const {router} = await server(stage);
        // 只有一个远程探针订阅 `changed`，没有 focus 的浏览器入口：到点之后的推送只能来自服务端自己的计时器。
        const caller = remoteProbe("example.caller", "browser");
        await stage.window(router, "w1", {plugins: [caller.definition]});
        const sessions = caller.remote().use(sessionsContract);
        const pushed: Today[] = [];
        expect(await sessions.events.changed.subscribe({}, (today) => void pushed.push(today))).toMatchObject({ok: true});
        expect(await waitUntil("订阅的首推", () => pushed.length === 1)).toBe(true);

        expect(await sessions.start({})).toMatchObject({ok: true});
        stage.clock.advance(25 * MINUTE);
        expect(await waitUntil("到点推来完成的一次", () => pushed.at(-1)?.completed === 1)).toBe(true);
        expect(pushed.at(-1)).toMatchObject({running: null, completed: 1, minutes: 25});
    });

    it("服务端入口停掉再启动：停止时它的计时器跟着取消；停着时到点的那次之后第一次读时记上，没到点的照常到点结束", async () => {
        const stage = newStage();
        const {app, router} = await stage.server({plugins: []});
        const caller = remoteProbe("example.caller", "browser");
        await stage.window(router, "w1", {plugins: [caller.definition]});
        const sessions = caller.remote().use(sessionsContract);

        let focus = await stage.attach(app, definitionAt("server", descriptor, focusBackendPlugin), "server");
        expect(await sessions.start({})).toMatchObject({ok: true});
        expect((await focus.stop()).status).toBe("closed");
        // 入口停了，它为进行中的那次排的计时器也取消了：场地上很快没有计时器，不必等到 25 分钟之后。
        await idle(stage);
        stage.clock.advance(30 * MINUTE);
        focus = await stage.attach(app, definitionAt("server", descriptor, focusBackendPlugin), "server");
        expect(await sessions.today({})).toMatchObject({ok: true, value: {running: null, completed: 1, minutes: 25}});

        expect(await sessions.start({})).toMatchObject({ok: true});
        expect((await focus.stop()).status).toBe("closed");
        stage.clock.advance(5 * MINUTE);
        await stage.attach(app, definitionAt("server", descriptor, focusBackendPlugin), "server");
        stage.clock.advance(20 * MINUTE);
        expect(await sessions.today({})).toMatchObject({ok: true, value: {running: null, completed: 2}});
    });

    it("同一状态根上的两个服务端都到点结算，只记一次", async () => {
        const root = join(tmp, "shared-root");
        const first = newStage(root);
        const second = newStage(root);
        const {router: firstRouter} = await server(first);
        const {router: secondRouter} = await server(second);
        const one = (await windowOf(first, firstRouter)).remote.use(sessionsContract);
        const two = (await windowOf(second, secondRouter)).remote.use(sessionsContract);

        expect(await one.start({})).toMatchObject({ok: true});
        // 第二个服务端在第一个开始之后才读到这次专注：它的计时器是读的时候排上的。
        expect(await two.today({})).toMatchObject({ok: true, value: {running: {endsAt: 25 * MINUTE}}});
        first.clock.advance(25 * MINUTE);
        second.clock.advance(25 * MINUTE);
        expect(await one.today({})).toMatchObject({ok: true, value: {running: null, completed: 1}});
        expect(await two.today({})).toMatchObject({ok: true, value: {running: null, completed: 1}});
    });

    it("记录的版本与入口不同（插件升过记录又降回来）：读写换成空记录，入口照常可用", async () => {
        const root = join(tmp, "newer-root");
        // 同一个插件 id 的“新版本”：同一条记录升到 version 2、换了形状。它跑在另一个服务端上：同一次运行里以不同的定义
        // 打开同一条记录是 `definition-conflict`，换版本总伴随着重启。
        const newer: PluginDefinition = {id: descriptor.id, entries: [defineEntry({
            id: "server",
            location: "server",
            dependencies: [{key: storageKey}],
            activate: async (context) => {
                const opened = await context.services.require(storageKey).open(defineRecord({key: "focus", scope: "user", locality: "shared", version: 2, schema: Type.Object({sessions: Type.Array(Type.Number())}, {additionalProperties: false})}));
                if (!opened.ok) throw new Error(opened.code);
                expect(await opened.handle.save({sessions: [1]}, {expect: null})).toMatchObject({ok: true});
                return {};
            },
        })]};
        const older = newStage(root);
        const {app} = await older.server({plugins: []});
        await older.attach(app, newer, "server");

        const current = newStage(root);
        const {router} = await server(current);
        const sessions = (await windowOf(current, router)).remote.use(sessionsContract);
        expect(await sessions.today({})).toMatchObject({ok: true, value: {running: null, completed: 0, minutes: 0}});
        expect(await sessions.start({})).toMatchObject({ok: true, value: {running: {endsAt: 25 * MINUTE}}});
    });

    it("跨零点的一次算在结束那天；第二天的汇总从零开始", async () => {
        const stage = newStage();
        const now = new Date(stage.clock.now());
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
        stage.clock.advance(midnight - 10 * MINUTE - stage.clock.now());
        const {router} = await server(stage);
        const sessions = (await windowOf(stage, router)).remote.use(sessionsContract);

        expect(await sessions.start({})).toMatchObject({ok: true});
        stage.clock.advance(25 * MINUTE);
        expect(await sessions.today({})).toMatchObject({ok: true, value: {running: null, completed: 1, minutes: 25}});
        stage.clock.advance(24 * 60 * MINUTE);
        expect(await sessions.today({})).toMatchObject({ok: true, value: {completed: 0, minutes: 0}});
    });

    it("断线重连后窗口重取一次：断开期间另一个服务端开始的那次补得上；浏览器入口停止后不再占计时器", async () => {
        const root = join(tmp, "resync-root");
        const first = newStage(root);
        const second = newStage(root);
        const {router} = await server(first);
        const {router: otherRouter} = await server(second);
        const workbench = workbenchStandIn();
        const shell = serviceProbe("example.shell", "browser", [commandServiceKey]);
        const app = await first.window(router, "w1", {plugins: [workbench.definition, shell.definition]});
        // focus 的浏览器入口单独装在一个子作用域里，后面要单独停掉它。
        const focus = await first.attach(app, definitionAt("browser", descriptor, focusBrowserPlugin), "browser");
        const commands = shell.get(commandServiceKey);
        expect(await waitUntil("状态栏显示今天的个数", () => status(workbench) === "今天 0 个番茄")).toBe(true);

        // 另一个服务端的写入不会推到这个窗口（推送只看本服务端自己的写入）。
        const other = (await windowOf(second, otherRouter, "w2")).remote.use(sessionsContract);
        expect(await other.start({})).toMatchObject({ok: true});
        expect(status(workbench)).toBe("今天 0 个番茄");

        expect(await first.reconnect(router, "w1")).toMatchObject({ok: true});
        expect(await waitUntil("重连后状态栏显示进行中的一次", () => status(workbench) === "专注 25:00")).toBe(true);
        expect(first.clock.pending()).toBeGreaterThan(0);

        // 窗口在走表。停掉窗口里的 focus：走表跟着停；切换命令随之不可用。
        expect((await focus.stop()).status).toBe("closed");
        expect(status(workbench)).toBeNull();
        expect(await commands.execute(TOGGLE_COMMAND, {})).toMatchObject({ok: false, code: "unknown-command"});
        // 第一个服务端也在为这一次计时（重连时它读到了），放弃它，场地上就不再有计时器。
        expect(await other.cancel({})).toMatchObject({ok: true});
        expect(await (await windowOf(first, router, "w3")).remote.use(sessionsContract).today({})).toMatchObject({ok: true, value: {running: null}});
        await idle(first);
    });
});
